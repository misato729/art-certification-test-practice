import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import { EXAM_CONFIG } from '../shared/examConfig.ts'
import { parseContentDocument, parseQuestionGroupInput } from '../shared/schemas/structure.ts'
import { ContentValidationError, parseBlocks, parseQuestionInput } from '../shared/schemas/content.ts'
const bundled = JSON.parse(readFileSync(new URL('../../content/questions.json', import.meta.url), 'utf8'))
function sample() {
  const question = structuredClone(bundled.questions[0])
  return { schema_version: 2, groups: [{ id: 1, exam_number: 1, group_number: 1, title: 'Synthetic group', planned_question_count: 1,
    publication_status: 'published', passages: [{ id: 1, label: 'A', display_order: 1, content_blocks: [{ type: 'text', text: 'Synthetic context' }] }] }], questions: [question] }
}
test('legacy documents keep absent hierarchy fields absent', () => {
  const { group_id, group_question_number, passage_references, ...question } = structuredClone(bundled.questions[0])
  const parsed = parseContentDocument({ schema_version: 1, questions: [question] }, EXAM_CONFIG)
  assert.equal(isDeepStrictEqual(parsed.questions[0], question), true)
  assert.equal(parsed.groups.length, 0)
})
test('v2 validates the full graph and derives optional parent metadata', () => {
  const document = parseContentDocument(sample(), EXAM_CONFIG)
  assert.equal(document.groups.length, 1)
  assert.equal(document.exam_sets[0]!.publication_status, 'published')
  assert.equal(document.questions[0]!.group_question_number, 1)
})
test('transport records reject extra attributes rather than dropping data silently', () => {
  for (const change of [
    (document: any) => { document.groups[0].unexpected = true },
    (document: any) => { document.groups[0].passages[0].unexpected = true },
    (document: any) => { document.groups[0].passages[0].content_blocks[0].unexpected = true },
    (document: any) => { document.exam_sets = [{ exam_number: 1, title: 'Synthetic', publication_status: 'draft', unexpected: true }] },
  ]) { const document = sample(); change(document); assert.throws(() => parseContentDocument(document, EXAM_CONFIG), ContentValidationError) }
})
test('ownership, duplicate numbering and missing targets are rejected before import', () => {
  for (const change of [
    (document: any) => { document.questions[0].group_id = 99 },
    (document: any) => { document.questions[0].passage_references[0].passage_id = 99 },
    (document: any) => { document.questions[0].passage_references[0].anchor_id = 'missing' },
    (document: any) => { document.questions[0].group_question_number = 2 },
  ]) { const document = sample(); change(document); assert.throws(() => parseContentDocument(document, EXAM_CONFIG), ContentValidationError) }
})
test('inline-only passages render one representation and use stable unique references', () => {
  const block = { type: 'text', inlines: [{ type: 'anchor', id: 'a', label: '(a)', text: 'Synthetic', underline: true }] }
  assert.equal(parseBlocks([block], 'question', true)[0]!.inlines!.length, 1)
  assert.throws(() => parseBlocks([{ ...block, text: 'conflicting text' }], 'question', true), ContentValidationError)
  assert.throws(() => parseBlocks([{ type: 'text', inlines: [] }], 'question', true), ContentValidationError)
  assert.throws(() => parseBlocks([{ ...block, inlines: [{ ...block.inlines[0], underline: false }] }], 'question', true), ContentValidationError)
  assert.throws(() => parseQuestionGroupInput({ ...sample().groups[0], passages: [{ label: 'A', display_order: 1, content_blocks: [block, block] }] }), ContentValidationError)
})
test('a draft group without children can be backed up without fabricating questions', () => {
  const document = sample(); document.groups[0]!.publication_status = 'draft'; document.questions = []
  assert.equal(parseContentDocument(document, EXAM_CONFIG).questions.length, 0)
})
test('membership must be paired and reference rows cannot be duplicated', () => {
  const question = sample().questions[0]
  assert.throws(() => parseQuestionInput({ ...question, group_question_number: null }, EXAM_CONFIG), ContentValidationError)
  assert.throws(() => parseQuestionInput({ ...question, passage_references: [...question.passage_references, ...question.passage_references] }, EXAM_CONFIG), ContentValidationError)
})
