import assert from 'node:assert/strict'
import test from 'node:test'
import { createAdminContentBlock, FILL_IN_CHOICE_COLUMN_COUNTS, FILL_IN_CHOICE_LABELS, getAdminContentBlockOptions, resizeFillInChoiceCells } from '../app/utils/adminContentBlocks.ts'

test('each editor offers exactly the block types allowed by its API context', () => {
  assert.deepEqual(getAdminContentBlockOptions('question').map(option => option.value), ['text', 'quote', 'fill_in_text', 'fill_in_quote', 'table', 'code', 'code_group'])
  assert.deepEqual(getAdminContentBlockOptions('choice').map(option => option.value), ['text', 'table', 'fill_in_choice'])
  assert.deepEqual(getAdminContentBlockOptions('explanation').map(option => option.value), ['text', 'quote', 'table', 'code'])
})

test('new fill-in blocks use the existing text and cells API shapes', () => {
  assert.deepEqual(createAdminContentBlock('fill_in_text'), { type: 'fill_in_text', text: '' })
  assert.deepEqual(createAdminContentBlock('fill_in_quote'), { type: 'fill_in_quote', text: '' })
  assert.deepEqual(createAdminContentBlock('fill_in_choice'), { type: 'fill_in_choice', cells: ['', '', ''] })
})

test('block creation does not share editable nested arrays across choices', () => {
  const first = createAdminContentBlock('fill_in_choice')
  const second = createAdminContentBlock('fill_in_choice')
  first.cells![0] = '変更'
  assert.deepEqual(second.cells, ['', '', ''])
  const table = createAdminContentBlock('table')
  table.rows![0]![0] = '変更'
  assert.deepEqual(createAdminContentBlock('table').rows, [['', '']])
})

test('the column selector and labels cover one to six blanks', () => {
  assert.deepEqual(FILL_IN_CHOICE_COLUMN_COUNTS, [1, 2, 3, 4, 5, 6])
  assert.deepEqual(FILL_IN_CHOICE_LABELS, ['①', '②', '③', '④', '⑤', '⑥'])
  for (const count of FILL_IN_CHOICE_COLUMN_COUNTS) {
    assert.equal(resizeFillInChoiceCells([], count).cells.length, count)
  }
})

test('resizing retains existing cells and appends empty inputs without changing the source', () => {
  const current = ['主体的', '対話的']
  assert.deepEqual(resizeFillInChoiceCells(current, 4).cells, ['主体的', '対話的', '', ''])
  assert.deepEqual(current, ['主体的', '対話的'])
  assert.deepEqual(resizeFillInChoiceCells(undefined, 1).cells, [''])
})

test('hidden cells are restored when the count is increased before leaving the editor', () => {
  const original = ['一', '二', '三', '四', '五', '六']
  const small = resizeFillInChoiceCells(original, 2)
  assert.deepEqual(small.cells, ['一', '二'])
  small.cells[0] = '更新'
  small.cells[1] = ''
  const expanded = resizeFillInChoiceCells(small.cells, 6, small.retainedCells)
  assert.deepEqual(expanded.cells, ['更新', '', '三', '四', '五', '六'])
  assert.deepEqual(original, ['一', '二', '三', '四', '五', '六'])
})

test('unsupported column counts are not silently accepted or truncated', () => {
  for (const count of [0, 7, -1, 1.5, Number.NaN]) {
    assert.throws(() => resizeFillInChoiceCells(['保持'], count), RangeError)
  }
})

test('all existing non-fill-in block defaults remain available', () => {
  assert.deepEqual(createAdminContentBlock('text'), { type: 'text', text: '' })
  assert.deepEqual(createAdminContentBlock('quote'), { type: 'quote', text: '', source: '' })
  assert.deepEqual(createAdminContentBlock('code'), { type: 'code', title: '', code: '' })
  assert.deepEqual(createAdminContentBlock('code_group'), { type: 'code_group', items: [{ title: 'プログラムA', code: '' }, { title: 'プログラムB', code: '' }] })
})
