<script setup lang="ts">
import type { GroupPassage, PassageReference } from '../../shared/types/learning'
import { passageAnchorId } from '../utils/learningPresentation'

defineProps<{ passages: GroupPassage[] }>()
const contentId = useId()
const open = ref(true)

const focusTarget = async (id: string, isCurrent = () => true) => {
  open.value = true
  await nextTick()
  if (!isCurrent()) return
  const target = document.getElementById(id)
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  target?.focus({ preventScroll: true })
}
const showReference = (reference: PassageReference, isCurrent?: () => boolean) => focusTarget(passageAnchorId(reference.passage_id, reference.anchor_id), isCurrent)
defineExpose({ showReference })
</script>

<template>
  <aside class="shared-passages" aria-label="共通本文">
    <button class="passage-toggle" type="button" :aria-expanded="open" :aria-controls="contentId" @click="open = !open">共通本文 <UIcon :name="open ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" /></button>
    <div v-show="open" :id="contentId">
      <section v-for="passage in passages" :id="passageAnchorId(passage.id)" :key="passage.id" class="shared-passage" tabindex="-1">
        <h2>【{{ passage.label }}】</h2>
        <QuestionContentBlocks :blocks="passage.content_blocks" :anchor-prefix="`passage-${passage.id}`" />
      </section>
    </div>
  </aside>
</template>

<style scoped>
.shared-passages { min-width: 0; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
.passage-toggle { width: 100%; min-height: 48px; display: flex; align-items: center; justify-content: space-between; padding: 14px 20px; border: 0; border-bottom: 1px solid var(--line); background: var(--surface-soft); color: var(--ink); font-weight: 800; cursor: pointer; }
.shared-passage { padding: 24px; line-height: 1.9; overflow-wrap: anywhere; scroll-margin-top: calc(var(--site-navigation-height, var(--header-height)) + 24px); }
.shared-passage + .shared-passage { border-top: 1px solid var(--line); }
.shared-passage h2 { margin: 0 0 18px; font-size: 1.125rem; }
</style>
