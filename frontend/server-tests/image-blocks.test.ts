import assert from 'node:assert/strict'
import { randomInt } from 'node:crypto'
import { after, test } from 'node:test'
import { configuration, setConfigurationForTesting } from '../server/core/config.ts'
import { closeDatabase, isolatedTransaction, type Database } from '../server/core/db.ts'
import { ApiError } from '../server/core/errors.ts'
import { createArchive, validateArchive } from '../server/operations/content.ts'
import { excerptFrom, type QuestionInput } from '../server/services/learning-validation.ts'
import { saveQuestion, materialDigest } from '../server/services/learning-writer.ts'
import { getQuestion, answerQuestion } from '../server/services/learning.ts'

process.env.APP_ENV = 'test'
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
const integration = { skip: !Boolean(process.env.DATABASE_URL || process.env.PGHOST) }
const originalConfiguration = structuredClone(configuration)
after(async () => { setConfigurationForTesting(originalConfiguration); await closeDatabase() })
const figure = { type: 'image' as const, src: '/images/artworks/mock01-img-01.jpg', alt: '建物と人物を描いた図版', label: '図A' }
function input(exam = 1): QuestionInput {
  const category = configuration.categories.minor[0]!
  return { exam_number: exam, question_number: 1, major_category_code: category.major_category_value, category_code: category.value,
    publication_status: 'published', content_blocks: [{ type: 'text', text: 'Synthetic image exercise' }, figure],
    explanation_blocks: [{ type: 'text', text: 'Synthetic answer-only explanation' }, { ...figure, src: '/images/artworks/mock01-img-02.jpg', alt: '解説に用いる図版', label: '図B' }],
    source_text: 'Synthetic answer-only attribution | https://example.com/answer-only-image-credit',
    choices: configuration.exam.choice_labels.map((label, index) => ({ choice_label: label, display_order: index + 1, is_correct: index === 0,
      content_blocks: index === 0 ? [{ ...figure, src: '/images/artworks/mock01-img-03.jpg', alt: '選択肢に用いる図版', label: '図C' }] : [{ type: 'text' as const, text: `Synthetic choice ${index + 1}` }] })),
  }
}

test('archive checksums and summaries preserve curated image fields without depending on image files', () => {
  const attributes = input()
  const archive = createArchive([attributes])
  assert.deepEqual(validateArchive(archive).questions, [attributes])
  assert.equal(excerptFrom([figure]), figure.alt)
  assert.equal(excerptFrom([{ type: 'text', text: 'The prompt remains the preferred summary' }, figure]), 'The prompt remains the preferred summary')
  assert.notEqual(materialDigest(attributes), materialDigest({ ...attributes, content_blocks: attributes.content_blocks.map(block => block.type === 'image' ? { ...block, src: '/images/artworks/mock01-img-04.jpg' } : block) }))
})

test('stored image questions expose neutral figures before answering, reveal credits only after grading and reject stale image versions', integration, async () => {
  const config = { ...structuredClone(originalConfiguration),
    exam: { set_count: 10000, questions_per_exam: 1, choice_labels: [...originalConfiguration.exam.choice_labels] },
    payments: { ...originalConfiguration.payments, enabled: false, free_exam_count: 10000 } }
  setConfigurationForTesting(config)
  try {
    await isolatedTransaction(async (db: Database) => {
      const attributes = input(randomInt(100, 9000))
      const saved = await saveQuestion(attributes, { db })
      const response = (await getQuestion(saved.id, null, db)).data
      assert.deepEqual(response.content_blocks, attributes.content_blocks)
      for (const field of ['source_text', 'explanation_blocks', 'correct_choice', 'is_correct']) assert.equal(Object.hasOwn(response, field), false)
      const choices = response.choices as { content_blocks: unknown; is_correct?: boolean }[]
      assert.deepEqual(choices[0]!.content_blocks, attributes.choices[0]!.content_blocks)
      assert.equal(choices.every(choice => !Object.hasOwn(choice, 'is_correct')), true)
      assert.equal(JSON.stringify(response).includes('answer-only'), false)
      const answer = (await answerQuestion(saved.id, saved.choices[0]!.id, null, db, saved.content_version)).data
      assert.equal(answer.is_correct, true)
      assert.deepEqual(answer.explanation_blocks, attributes.explanation_blocks)
      assert.equal(answer.source_text, attributes.source_text)
      const edited = await saveQuestion({ ...attributes, content_blocks: attributes.content_blocks.map(block => block.type === 'image' ? { ...block, src: '/images/artworks/mock01-img-04.jpg' } : block),
        choices: attributes.choices.map((choice, index) => ({ ...choice, id: saved.choices[index]!.id })) }, { id: saved.id, db })
      assert.equal(edited.content_version > saved.content_version, true)
      await assert.rejects(answerQuestion(saved.id, edited.choices[0]!.id, null, db, saved.content_version), (error: unknown) => error instanceof ApiError && error.status === 409)
    })
  } finally { setConfigurationForTesting(originalConfiguration) }
})
