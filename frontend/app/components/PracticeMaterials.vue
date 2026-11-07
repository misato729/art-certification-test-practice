<script setup lang="ts">
import type { LearningBlock, PassageReference } from '../../shared/types/learning'

type Material = { id: number; label: string; display_order?: number; content_blocks: LearningBlock[] }
const props = withDefaults(defineProps<{
  passages: Material[]
  references?: PassageReference[]
  scopeKey: string
  shared?: boolean
}>(), { references: () => [], shared: false })

const root = useTemplateRef<HTMLElement>('root')
const instanceId = useId().replace(/[^a-zA-Z0-9_-]/g, '-')
// Only expansion preferences are kept. No question, answer or image content is cached.
const expansion = useState<Record<string, boolean>>('art-practice-material-expansion', () => ({}))
const stateKey = (id: number) => `${props.scopeKey}:${id}`
const expanded = (id: number) => expansion.value[stateKey(id)] !== false
const rememberExpansion = (id: number, event: Event) => {
  expansion.value = { ...expansion.value, [stateKey(id)]: (event.target as HTMLDetailsElement).open }
}
const prefix = (id: number) => `art-material-${instanceId}-${id}`
const materials = computed(() => [...props.passages].sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0)))
const references = computed(() => {
  const seen = new Set<string>()
  return props.references.filter(reference => {
    const key = `${reference.passage_id}:${reference.anchor_id ?? ''}`
    if (seen.has(key) || !props.passages.some(passage => passage.id === reference.passage_id)) return false
    seen.add(key)
    return true
  })
})
const referenceLabel = (reference: PassageReference) => {
  const passage = props.passages.find(item => item.id === reference.passage_id)
  const inline = passage?.content_blocks.flatMap(block => 'inlines' in block ? block.inlines ?? [] : [])
    .find(part => part.type !== 'text' && part.id === reference.anchor_id)
  const detail = inline?.type === 'blank' ? ` 空欄${inline.label}`
    : inline?.type === 'anchor' ? ` 下線部(${inline.label})` : ''
  return `【${passage?.label || '資料'}】${detail}を確認`
}
const showReference = async (reference: PassageReference) => {
  const scope = props.scopeKey
  expansion.value = { ...expansion.value, [stateKey(reference.passage_id)]: true }
  await nextTick()
  if (scope !== props.scopeKey || !root.value) return
  const base = prefix(reference.passage_id)
  const target = (reference.anchor_id ? document.getElementById(`${base}-${reference.anchor_id}`) : null)
    ?? document.getElementById(base)
  if (!target || !root.value.contains(target)) return
  target.focus({ preventScroll: true })
  target.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
}
</script>

<template>
  <section v-if="materials.length" ref="root" class="practice-materials" :class="{ 'is-shared': shared }" :aria-label="shared ? '共通資料・図版' : 'この問題の資料'">
    <h2>{{ shared ? '共通資料・図版' : 'この問題の資料' }}</h2>
    <p v-if="shared" class="material-help">この設問に必要な資料を表示しています。資料を参照しながら回答してください。</p>
    <div v-if="references.length" class="material-references" aria-label="参照箇所">
      <button v-for="reference in references" :key="`${reference.passage_id}-${reference.anchor_id ?? 'all'}`" type="button" @click="showReference(reference)">{{ referenceLabel(reference) }}</button>
    </div>
    <details v-for="passage in materials" :key="`${scopeKey}:${passage.id}`" :open="expanded(passage.id)" @toggle="rememberExpansion(passage.id, $event)">
      <summary>【{{ passage.label || '資料' }}】</summary>
      <div :id="prefix(passage.id)" class="material-body" tabindex="-1">
        <QuestionContentBlocks :blocks="passage.content_blocks" :anchor-prefix="prefix(passage.id)" />
      </div>
    </details>
  </section>
</template>

<style scoped>
.practice-materials { min-width: 0; margin: 0 0 24px; padding: 18px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface, #fff); }
.practice-materials.is-shared { background: var(--surface-tint, #f3f7fa); }
h2 { margin: 0 0 12px; font-size: 1.125rem; line-height: 1.5; }
.material-help { margin: 0 0 16px; color: var(--muted); font-size: .875rem; line-height: 1.7; }
details + details { margin-top: 14px; }
summary { min-height: 44px; padding: 10px 0; font-weight: 700; cursor: pointer; overflow-wrap: anywhere; }
.material-body { min-width: 0; padding-top: 10px; }
.material-body, :deep([id]) { scroll-margin-top: calc(var(--site-navigation-height, var(--header-height)) + 24px); }
.material-body:focus, :deep([tabindex='-1']:focus) { outline: 2px solid var(--teal); outline-offset: 4px; }
.material-references { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.material-references button { min-height: 44px; max-width: 100%; padding: 8px 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface, #fff); color: var(--ink); font: inherit; font-size: .875rem; text-align: left; cursor: pointer; overflow-wrap: anywhere; }
summary:focus-visible, button:focus-visible { outline: 2px solid var(--teal); outline-offset: 3px; }
@media (max-width: 640px) { .practice-materials { padding: 14px; } }
</style>
