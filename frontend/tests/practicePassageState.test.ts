import assert from 'node:assert/strict'
import test from 'node:test'
import { canRetainPassageContext, isCurrentPracticeRequest, reconcilePassageContext, type PracticeRequestTag } from '../app/utils/practicePassageState.ts'

const reading = () => ({
  exam_number: 1,
  group: { id: 10, group_number: 1, title: '合成大問', question_numbers: [1, 2, 3, 4] },
  shared_passages: [{ id: 20, label: 'A', display_order: 1, content_blocks: [{ type: 'text', text: '合成の共通本文' }] }],
})

test('another question using the same passage preserves the array reference', () => {
  const first = reconcilePassageContext(null, reading(), 3)!
  const second = reconcilePassageContext(first, { ...reading(), group: { ...reading().group, title: '更新された大問名' } }, 3)!
  assert.equal(second.passages, first.passages)
  assert.equal(second.key, first.key)
  assert.equal(second.group.title, '更新された大問名')
})

test('a different passage, label, order, or body creates a fresh reading context', () => {
  const initial = reconcilePassageContext(null, reading(), 3)!
  for (const change of [{ id: 21, label: 'B' }, { label: '改訂A' }, { display_order: 2 }, { content_blocks: [{ type: 'text', text: '更新された本文' }] }]) {
    const source = reading()
    source.shared_passages[0] = { ...source.shared_passages[0]!, ...change }
    const next = reconcilePassageContext(initial, source, 3)!
    assert.notEqual(next.key, initial.key)
    assert.notEqual(next.passages, initial.passages)
  }
})

test('pending navigation may retain only public siblings in the same exam and scope', () => {
  const context = reconcilePassageContext(null, reading(), 3)!
  assert.equal(canRetainPassageContext(context, { examNumber: 1, questionNumber: 2, scope: 3 }), true)
  for (const target of [{ examNumber: 2, questionNumber: 2, scope: 3 }, { examNumber: 1, questionNumber: 5, scope: 3 }, { examNumber: 1, questionNumber: 2, scope: 4 }]) assert.equal(canRetainPassageContext(context, target), false)
  assert.equal(reconcilePassageContext(null, { exam_number: 1 }, 3), null)
})

test('an identity or condition scope change cannot reuse retained passage references', () => {
  const context = reconcilePassageContext(null, reading(), 3)!
  const next = reconcilePassageContext(context, reading(), 4)!
  assert.notEqual(next.passages, context.passages)
  assert.equal(canRetainPassageContext(context, { examNumber: 1, questionNumber: 1, scope: 4 }), false)
})

test('the retained context excludes answer results, question bodies, and sources', () => {
  const source = { ...reading(), id: 99, accepted_answers: ['合成語'], source_references: [{ kind: 'book', title: '解説用資料' }], explanation_blocks: [{ type: 'text', text: '解説' }], choices: [{ is_correct: true }], group: { ...reading().group, questions: [{ accepted_answers: ['合成語'] }] } }
  const context = reconcilePassageContext(null, source, 3)!
  assert.deepEqual(Object.keys(context).sort(), ['examNumber', 'group', 'key', 'passages', 'scope'])
  assert.deepEqual(Object.keys(context.group).sort(), ['group_number', 'id', 'question_numbers', 'title'])
  assert.doesNotMatch(JSON.stringify(context), /accepted_answers|source_references|explanation_blocks|is_correct/)
})

test('responses from old requests, routes, identity scopes, or page instances are rejected', () => {
  const current: PracticeRequestTag = { instance: 'page-b', scope: 5, navigation: 8, request: 12, examNumber: 1, questionNumber: 2 }
  assert.equal(isCurrentPracticeRequest({ ...current }, current), true)
  for (const change of [{ instance: 'page-a' }, { scope: 4 }, { navigation: 6 }, { request: 11 }, { examNumber: 2 }, { questionNumber: 1 }]) assert.equal(isCurrentPracticeRequest({ ...current, ...change }, current), false)
  assert.equal(isCurrentPracticeRequest(undefined, current), false)
})
