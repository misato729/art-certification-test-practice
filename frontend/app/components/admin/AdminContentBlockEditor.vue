<script setup lang="ts">
import { useFormField } from '@nuxt/ui/composables'
import type { ContentBlock, ContentBlockType } from '~/types/adminQuestion'
import { createAdminContentBlock, FILL_IN_CHOICE_COLUMN_COUNTS, FILL_IN_CHOICE_LABELS, getAdminContentBlockOptions, resizeFillInChoiceCells } from '~/utils/adminContentBlocks'

const props = defineProps<{
  context: 'question' | 'explanation' | 'choice'
}>()

const blocks = defineModel<ContentBlock[]>({ required: true })
const selectedType = ref<ContentBlockType>('text')
const { id: formFieldId, ariaAttrs, emitFormInput, emitFormBlur, emitFormChange } = useFormField()
const editorId = useId()
const fieldId = (field: string, blockIndex: number, cellIndex?: number) => `${editorId}-${field}-${blockIndex}${cellIndex === undefined ? '' : `-${cellIndex}`}`
const retainedChoiceCells = new WeakMap<ContentBlock, string[]>()

const typeOptions = computed(() => getAdminContentBlockOptions(props.context))

watch(typeOptions, (options) => {
  if (!options.some(option => option.value === selectedType.value)) selectedType.value = 'text'
})

const blockLabel = (type: ContentBlockType) => ({
  text: '通常文',
  quote: '枠付き引用文',
  table: '表',
  code: 'プログラム',
  code_group: 'プログラム比較',
  fill_in_text: '穴埋め問題文',
  fill_in_quote: '穴埋め引用文',
  fill_in_choice: '穴埋め選択肢',
}[type])

const addBlock = () => {
  blocks.value = [...blocks.value, createAdminContentBlock(selectedType.value)]
}

const resizeChoiceCells = (block: ContentBlock, columnCount: number) => {
  const resized = resizeFillInChoiceCells(block.cells, columnCount, retainedChoiceCells.get(block))
  retainedChoiceCells.set(block, resized.retainedCells)
  block.cells = resized.cells
}

const updateChoiceCell = (block: ContentBlock, cellIndex: number, value: string) => {
  const cells = [...(block.cells ?? ['', '', ''])]
  cells[cellIndex] = value
  block.cells = cells
}

const removeBlock = (index: number) => {
  if (blocks.value.length <= 1) return
  blocks.value = blocks.value.filter((_, blockIndex) => blockIndex !== index)
}

const moveBlock = (index: number, direction: -1 | 1) => {
  const destination = index + direction
  if (destination < 0 || destination >= blocks.value.length) return
  const next = [...blocks.value]
  const [block] = next.splice(index, 1)
  if (!block) return
  next.splice(destination, 0, block)
  blocks.value = next
}

const updateHeaders = (block: ContentBlock, value: string) => {
  block.headers = value.split('\t').map(item => item.trim())
  const columnCount = block.headers.length
  block.rows = (block.rows ?? [['']]).map(row => Array.from({ length: columnCount }, (_, index) => row[index] ?? ''))
}

const updateRows = (block: ContentBlock, value: string) => {
  const columnCount = Math.max(block.headers?.length ?? 1, 1)
  block.rows = value.split('\n').map(row => {
    const cells = row.split('\t')
    return Array.from({ length: columnCount }, (_, index) => cells[index] ?? '')
  })
}

const rowsText = (block: ContentBlock) => (block.rows ?? []).map(row => row.join('\t')).join('\n')

const addCodeItem = (block: ContentBlock) => {
  block.items = [...(block.items ?? []), { title: `プログラム${String.fromCharCode(65 + (block.items?.length ?? 0))}`, code: '' }]
}

const removeCodeItem = (block: ContentBlock, index: number) => {
  if ((block.items?.length ?? 0) <= 2) return
  block.items = block.items?.filter((_, itemIndex) => itemIndex !== index)
}
</script>

<template>
  <div :id="formFieldId" v-bind="ariaAttrs" class="block-editor" role="group" :aria-label="({ question: '問題文', explanation: '解答解説', choice: '選択肢' })[context]" tabindex="-1" @input="emitFormInput" @focusout="emitFormBlur" @change="emitFormChange">
    <article v-for="(block, index) in blocks" :key="`${block.type}-${index}`" class="block-card">
      <header class="block-card-head">
        <div><span class="drag-handle"><UIcon name="i-lucide-grip-vertical" /></span><strong>{{ index + 1 }}. {{ blockLabel(block.type) }}</strong></div>
        <div class="block-actions">
          <button type="button" title="上へ移動" :disabled="index === 0" @click="moveBlock(index, -1)"><UIcon name="i-lucide-arrow-up" /></button>
          <button type="button" title="下へ移動" :disabled="index === blocks.length - 1" @click="moveBlock(index, 1)"><UIcon name="i-lucide-arrow-down" /></button>
          <button class="remove" type="button" title="削除" :disabled="blocks.length <= 1" @click="removeBlock(index)"><UIcon name="i-lucide-trash-2" /></button>
        </div>
      </header>
      <div class="block-card-body">
        <template v-if="['text', 'fill_in_text', 'fill_in_quote'].includes(block.type)">
          <div class="admin-field">
            <label :for="fieldId('block-text', index)">文章</label>
            <textarea :id="fieldId('block-text', index)" v-model="block.text" required :placeholder="block.type.startsWith('fill_in_') ? '空欄は {{①}} の形式で入力します' : '表示する文章を入力します'" />
          </div>
        </template>

        <template v-else-if="block.type === 'quote'">
          <div class="admin-field"><label :for="fieldId('quote-text', index)">引用文</label><textarea :id="fieldId('quote-text', index)" v-model="block.text" required /></div>
          <div class="admin-field compact-field"><label :for="fieldId('quote-source', index)">引用元（任意）</label><input :id="fieldId('quote-source', index)" v-model="block.source" type="text"></div>
        </template>

        <template v-else-if="block.type === 'table'">
          <div class="admin-field"><label :for="fieldId('table-headers', index)">見出し</label><input :id="fieldId('table-headers', index)" :value="(block.headers ?? []).join('\t')" type="text" required @input="updateHeaders(block, ($event.target as HTMLInputElement).value)"><small>列はTabキーで区切ります。</small></div>
          <div class="admin-field"><label :for="fieldId('table-rows', index)">セル</label><textarea :id="fieldId('table-rows', index)" :value="rowsText(block)" required @input="updateRows(block, ($event.target as HTMLTextAreaElement).value)" /><small>列はTab、行は改行で区切ります。</small></div>
        </template>

        <template v-else-if="block.type === 'code'">
          <div class="admin-field compact-field"><label :for="fieldId('code-title', index)">タイトル（任意）</label><input :id="fieldId('code-title', index)" v-model="block.title" type="text"></div>
          <div class="admin-field"><label :for="fieldId('code-body', index)">プログラム</label><textarea :id="fieldId('code-body', index)" v-model="block.code" class="code-input" required spellcheck="false" /></div>
        </template>

        <template v-else-if="block.type === 'code_group'">
          <div class="code-item-list">
            <section v-for="(item, itemIndex) in block.items" :key="itemIndex" class="code-item">
              <div class="code-item-head"><strong>比較 {{ itemIndex + 1 }}</strong><button type="button" :disabled="(block.items?.length ?? 0) <= 2" @click="removeCodeItem(block, itemIndex)"><UIcon name="i-lucide-x" />削除</button></div>
              <div class="admin-field compact-field"><label :for="fieldId('group-title', index, itemIndex)">タイトル</label><input :id="fieldId('group-title', index, itemIndex)" v-model="item.title" type="text" required></div>
              <div class="admin-field"><label :for="fieldId('group-code', index, itemIndex)">プログラム</label><textarea :id="fieldId('group-code', index, itemIndex)" v-model="item.code" class="code-input" required spellcheck="false" /></div>
            </section>
          </div>
          <button class="add-code-button" type="button" @click="addCodeItem(block)"><UIcon name="i-lucide-plus" />比較するプログラムを追加</button>
        </template>

        <template v-else-if="block.type === 'fill_in_choice'">
          <div class="admin-field compact-field">
            <label :for="fieldId('fill-choice-columns', index)">空欄数</label>
            <select :id="fieldId('fill-choice-columns', index)" :value="block.cells?.length ?? 3" @change="resizeChoiceCells(block, Number(($event.target as HTMLSelectElement).value))">
              <option v-for="columnCount in FILL_IN_CHOICE_COLUMN_COUNTS" :key="columnCount" :value="columnCount">{{ columnCount }}個</option>
            </select>
          </div>
          <fieldset class="fill-choice-fields">
            <legend>空欄ごとの語句</legend>
            <div v-for="(label, cellIndex) in FILL_IN_CHOICE_LABELS.slice(0, block.cells?.length ?? 3)" :key="label" class="admin-field">
              <label :for="fieldId('fill-choice-cell', index, cellIndex)">{{ label }}</label>
              <input :id="fieldId('fill-choice-cell', index, cellIndex)" :value="block.cells?.[cellIndex] ?? ''" type="text" @input="updateChoiceCell(block, cellIndex, ($event.target as HTMLInputElement).value)">
            </div>
          </fieldset>
        </template>
      </div>
    </article>

    <div class="add-block-row">
      <select v-model="selectedType" aria-label="追加する表示ブロック">
        <option v-for="option in typeOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
      </select>
      <button type="button" @click="addBlock"><UIcon name="i-lucide-plus" />表示ブロックを追加</button>
    </div>
  </div>
</template>

<style scoped>
.block-editor { display: grid; gap: 12px; }
.block-card { overflow: hidden; border: 1px solid var(--admin-line); border-radius: 6px; background: #111a1f; }
.block-card-head { min-height: 46px; display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 7px 10px 7px 13px; border-bottom: 1px solid var(--admin-line); background: #172127; }
.block-card-head > div:first-child { display: flex; align-items: center; gap: 8px; }
.block-card-head strong { font-size: 12px; }
.drag-handle { display: grid; place-items: center; color: #64777f; }
.block-actions { display: flex; gap: 4px; }
.block-actions button { width: 31px; height: 31px; display: grid; place-items: center; padding: 0; border: 1px solid var(--admin-line); border-radius: 4px; background: #111a1f; color: var(--admin-muted); cursor: pointer; }
.block-actions button:hover:not(:disabled) { color: var(--admin-text); border-color: var(--admin-line-strong); }
.block-actions button.remove:hover:not(:disabled) { color: #ef9992; border-color: var(--admin-danger); }
.block-actions button:disabled { opacity: .3; cursor: not-allowed; }
.block-card-body { display: grid; gap: 14px; padding: 15px; }
.block-card-body .admin-field + .admin-field { margin-top: 0; }
.compact-field textarea { min-height: 80px; }
.fill-choice-fields { min-width: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 0; padding: 0; border: 0; }
.fill-choice-fields legend { margin-bottom: 8px; color: var(--admin-text); font-size: 13px; font-weight: 700; }
.fill-choice-fields .admin-field { min-width: 0; }
.code-input { min-height: 150px !important; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important; font-size: 13px !important; tab-size: 2; }
.code-item-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.code-item { display: grid; gap: 12px; padding: 13px; border: 1px solid var(--admin-line); border-radius: 5px; }
.code-item-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.code-item-head strong { font-size: 12px; }
.code-item-head button { display: inline-flex; align-items: center; gap: 4px; padding: 0; border: 0; background: transparent; color: var(--admin-muted); font-size: 11px; cursor: pointer; }
.code-item-head button:disabled { opacity: .3; }
.add-code-button { justify-self: start; display: inline-flex; align-items: center; gap: 7px; padding: 7px 10px; border: 1px solid var(--admin-line); border-radius: 4px; background: transparent; color: var(--admin-muted); font-size: 11px; font-weight: 700; cursor: pointer; }
.add-block-row { min-height: 52px; display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 9px; border: 1px dashed var(--admin-line-strong); border-radius: 6px; }
.add-block-row select { min-height: 35px; padding: 0 9px; border: 1px solid var(--admin-line); border-radius: 4px; background: #111a1f; color: var(--admin-text); font-size: 12px; }
.add-block-row button { min-height: 35px; display: inline-flex; align-items: center; gap: 6px; padding: 0 11px; border: 1px solid var(--admin-line-strong); border-radius: 4px; background: var(--admin-surface-3); color: var(--admin-text); font-size: 12px; font-weight: 800; cursor: pointer; }
@media (max-width: 700px) {
  .code-item-list { grid-template-columns: 1fr; }
  .fill-choice-fields { grid-template-columns: 1fr; }
  .add-block-row { align-items: stretch; flex-direction: column; }
}
</style>
