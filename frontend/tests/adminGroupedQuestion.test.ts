import assert from 'node:assert/strict'
import test from 'node:test'
import { createEmptyQuestion } from '../app/types/adminQuestion.ts'
import { normalizeAdminQuestion, prepareAdminQuestion, setPassageReference } from '../app/utils/adminQuestionForm.ts'
import { passageReferenceSchema } from '../shared/schemas/content.ts'

test('legacy question drafts reopen with independent group defaults', () => {
  const input = createEmptyQuestion()
  delete input.group_id
  delete input.group_question_number
  delete input.passage_references
  const normalized = normalizeAdminQuestion(input)
  assert.equal(normalized.group_id, null)
  assert.equal(normalized.group_question_number, null)
  assert.deepEqual(normalized.passage_references, [])
  normalized.content_blocks[0]!.text = '合成の編集中の文章'
  assert.equal(input.content_blocks[0]!.text, '')
})

test('group submission preserves internal coordinates, six choices, choice IDs and lock version', () => {
  const input = createEmptyQuestion()
  input.question_number = 81
  input.group_id = 23
  input.group_question_number = 1
  input.lock_version = 4
  input.passage_references = [{ passage_id: 12, anchor_id: 'ref-a' }]
  input.choices = ['ア', 'イ', 'ウ', 'エ', 'オ', 'カ'].map((label, index) => ({
    id: 100 + index, choice_label: label, display_order: 9 - index,
    content_blocks: [{ type: 'text', text: '合成選択肢' }], is_correct: index === 5,
  }))
  const submitted = prepareAdminQuestion(input)
  assert.equal(submitted.question_number, 81)
  assert.equal(submitted.group_question_number, 1)
  assert.equal(submitted.lock_version, 4)
  assert.deepEqual(submitted.choices.map(choice => choice.id), [100, 101, 102, 103, 104, 105])
  assert.deepEqual(submitted.choices.map(choice => choice.display_order), [1, 2, 3, 4, 5, 6])
  assert.equal(submitted.choices[5]!.is_correct, true)
  assert.equal(input.choices[0]!.display_order, 9)
  submitted.passage_references![0]!.anchor_id = 'changed'
  assert.equal(input.passage_references[0]!.anchor_id, 'ref-a')
})

test('removing group membership clears stale local numbering and references without modifying the draft', () => {
  const input = createEmptyQuestion()
  input.group_id = null
  input.group_question_number = 4
  input.passage_references = [{ passage_id: 12, anchor_id: null }]
  const submitted = prepareAdminQuestion(input)
  assert.equal(submitted.group_question_number, null)
  assert.deepEqual(submitted.passage_references, [])
  assert.equal(input.group_question_number, 4)
  assert.equal(input.passage_references.length, 1)
})

test('whole-passage and anchor references remain independently selectable without duplicate entries', () => {
  const whole = { passage_id: 12, anchor_id: null }
  const anchor = { passage_id: 12, anchor_id: 'ref-a' }
  let references = setPassageReference([], whole, true)
  references = setPassageReference(references, anchor, true)
  references = setPassageReference(references, whole, true)
  assert.equal(references.length, 2)
  assert.deepEqual(setPassageReference(references, whole, false), [anchor])
  assert.equal(references.length, 2)
})

// UI choices carry a label, but the strict API contract intentionally does not.
test('selecting a labelled reference option keeps only the canonical reference fields', () => {
  const option = { passage_id: 12, anchor_id: 'ref-a', label: '合成の参照表示名' }
  const references = setPassageReference([], option, true)
  assert.deepEqual(references, [{ passage_id: 12, anchor_id: 'ref-a' }])
  assert.equal(passageReferenceSchema.safeParse(references[0]).success, true)
  const input = createEmptyQuestion()
  input.group_id = 7
  input.group_question_number = 1
  input.passage_references = [option]
  const prepared = prepareAdminQuestion(input)
  assert.deepEqual(prepared.passage_references, [{ passage_id: 12, anchor_id: 'ref-a' }])
  assert.equal(passageReferenceSchema.safeParse(prepared.passage_references?.[0]).success, true)
  assert.equal(option.label, '合成の参照表示名')
})
