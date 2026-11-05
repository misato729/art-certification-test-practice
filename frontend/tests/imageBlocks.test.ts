import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { EXAM_CONFIG } from '../shared/examConfig.ts'
import { artworkImagePathSchema, blocksSchema, normalizeQuestionForm, parseQuestionArchiveEntries, type BlockContext } from '../shared/schemas/content.ts'
import { parseContentDocument } from '../shared/schemas/structure.ts'

const image = { type: 'image', src: '/images/artworks/mock01-img-01.jpg', alt: '屋外に並ぶ人物と建物', label: '図A' }
const sample = () => JSON.parse(readFileSync(new URL('../../content/questions.json', import.meta.url), 'utf8')).questions[0]

test('curated image blocks use the same canonical shape in every display context', () => {
  for (const context of ['question', 'explanation', 'choice'] as BlockContext[]) {
    assert.deepEqual(blocksSchema(context, true, true, true).parse([image]), [image])
    for (const extension of ['jpg', 'jpeg', 'png', 'webp']) {
      assert.equal(blocksSchema(context, true).safeParse([{ ...image, src: `/images/artworks/mock01-img-01.${extension}` }]).success, true)
    }
  }
})

test('remote, active, encoded and traversing image paths are rejected even in draft inputs', () => {
  const invalid = ['https://example.com/a.jpg', '//example.com/a.jpg', 'data:image/png;base64,AA', 'javascript:alert(1)',
    '/images/artworks/../secret.jpg', '/images/artworks/%2e%2e-secret.jpg', '/images/artworks/a.jpg?title=answer',
    '/images/artworks/a.jpg#answer', '/images/artworks/a.svg', '/images/artworks/a.html', '/images/artworks/sub/a.jpg',
    '/images/artworks/a b.jpg', '/images/artworks/a\\b.jpg', '/images/artworks/.hidden.jpg', '/images/artworks/a..jpg',
    '/images/artworks/a.jpg\n', 'images/artworks/a.jpg']
  for (const src of invalid) {
    assert.equal(artworkImagePathSchema.safeParse(src).success, false)
    for (const strict of [false, true]) assert.equal(blocksSchema('question', false, true, strict).safeParse([{ ...image, src }]).success, false)
  }
})

test('publication requires image alternative text while unfinished image drafts remain editable', () => {
  for (const raw of [{ ...image, src: '' }, { ...image, alt: '' }, { ...image, alt: '  ' }]) {
    assert.equal(blocksSchema('question', false).safeParse([raw]).success, true)
    assert.equal(blocksSchema('question', true).safeParse([raw]).success, false)
  }
  assert.equal(blocksSchema('question', true).safeParse([{ ...image, alt: 'a'.repeat(251) }]).success, false)
  assert.equal(blocksSchema('question', true).safeParse([{ ...image, label: 'a'.repeat(41) }]).success, false)
})

test('strict image archives forbid embedded author, attribution and answer metadata', () => {
  for (const key of ['author', 'artwork_title', 'credit', 'source', 'title', 'is_correct']) {
    assert.equal(blocksSchema('question', true, true, true).safeParse([{ ...image, [key]: 'not display data' }]).success, false)
  }
  assert.deepEqual(blocksSchema('question', true).parse([{ ...image, author: 'discard', credit: 'discard', title: 'discard' }]), [image])
})

test('question, choice, explanation and shared-passage images retain their neutral fields through archives', () => {
  const question = sample()
  const { group_id, group_question_number, passage_references, ...standalone } = question
  standalone.content_blocks = [{ ...image }]
  standalone.explanation_blocks = [{ ...image, src: '/images/artworks/mock01-img-02.jpg', alt: '解説で用いる図版' }]
  standalone.choices[0].content_blocks = [{ ...image, src: '/images/artworks/mock01-img-03.jpg', label: '図B' }]
  assert.deepEqual(parseQuestionArchiveEntries([standalone], EXAM_CONFIG)[0], standalone)
  const grouped = { ...standalone, group_id: 1, group_question_number: 1, passage_references: [{ passage_id: 1, anchor_id: null }] }
  const document = { schema_version: 2, exam_sets: [{ exam_number: 1, title: 'Synthetic figure set', publication_status: 'published' }],
    groups: [{ id: 1, exam_number: 1, group_number: 1, title: 'Synthetic figures', planned_question_count: 1, publication_status: 'published',
      passages: [{ id: 1, label: 'A', display_order: 1, content_blocks: [image] }] }], questions: [grouped] }
  const parsed = parseContentDocument(document, EXAM_CONFIG)
  assert.deepEqual(parsed.groups[0]!.passages[0]!.content_blocks, [image])
  assert.deepEqual(parsed.questions[0]!.choices[0]!.content_blocks, standalone.choices[0].content_blocks)
  const form = normalizeQuestionForm({ ...standalone, content_blocks: [{ ...image, label: '' }] }, EXAM_CONFIG)
  assert.equal(form.content_blocks[0]!.src, image.src)
  assert.equal('label' in form.content_blocks[0]!, false)
})
