import assert from 'node:assert/strict'
import test from 'node:test'
import type { StudyCategoryNode } from '../shared/schemas/study-categories.ts'
import { categoryLeafCodes, categorySelectionState, presetCategoryCodes, presetSelectionState, toggleCategoryCodes, toggleStudyPreset } from '../app/utils/studyCategorySelection.ts'

const node = (code: string, children: StudyCategoryNode[] = []): StudyCategoryNode => ({ code, scheme: 'study_outline', parent_code: null, number: 1, sort_order: 1, label: 'Synthetic', subtitle: null, source_page: null, reference_page: null, children })
const tree = [node('part_01', [node('w1'), node('w2')]), node('part_02', [node('j1'), node('j2')]), node('part_03', [node('m1')]), node('part_04', [node('part_04_section_01'), node('design'), node('museum')]), node('part_05')]
const sorted = (codes: string[]) => [...codes].sort()

test('world preset selects all Western children plus only Eastern art, replacing unrelated manual extras', () => {
  assert.deepEqual(sorted(presetCategoryCodes(tree, 'world')), ['part_04_section_01', 'w1', 'w2'])
  const selected = toggleStudyPreset(tree, ['design', 'museum', 'm1', 'part_05'], 'world', true)
  assert.deepEqual(sorted(selected), ['part_04_section_01', 'w1', 'w2'])
  assert.equal(categorySelectionState(selected, categoryLeafCodes(tree[0]!)).checked, true)
  assert.equal(categorySelectionState(selected, categoryLeafCodes(tree[3]!)).indeterminate, true)
})

test('Japanese preset selects every Japanese child and both exam presets combine or toggle off independently', () => {
  const japanese = toggleStudyPreset(tree, [], 'japanese', true)
  assert.deepEqual(japanese, ['j1', 'j2'])
  const both = toggleStudyPreset(tree, japanese, 'world', true)
  assert.deepEqual(sorted(both), ['j1', 'j2', 'part_04_section_01', 'w1', 'w2'])
  assert.equal(presetSelectionState(tree, both, 'world').checked, true)
  assert.equal(presetSelectionState(tree, both, 'japanese').checked, true)
  assert.deepEqual(toggleStudyPreset(tree, both, 'world', false), ['j1', 'j2'])
})

test('manual groups preserve other groups, show partial selection, and missing preset categories never partially apply', () => {
  const all = toggleCategoryCodes(['j1'], categoryLeafCodes(tree[0]!), true)
  assert.deepEqual(all, ['j1', 'w1', 'w2'])
  assert.equal(categorySelectionState(['w1'], categoryLeafCodes(tree[0]!)).indeterminate, true)
  assert.equal(presetSelectionState(tree, [...presetCategoryCodes(tree, 'world'), 'design'], 'world').checked, false)
  const partialOther = [...presetCategoryCodes(tree, 'world'), 'j1']
  assert.deepEqual(presetSelectionState(tree, partialOther, 'world'), { checked: false, indeterminate: true })
  assert.deepEqual(sorted(toggleStudyPreset(tree, partialOther, 'world', true)), sorted(presetCategoryCodes(tree, 'world')))
  assert.deepEqual(presetCategoryCodes(tree.slice(0, 2), 'world'), [])
  assert.deepEqual(toggleStudyPreset(tree.slice(0, 2), ['j1'], 'world', true), ['j1'])
  assert.deepEqual(categoryLeafCodes(tree[4]!), ['part_05'])
})
