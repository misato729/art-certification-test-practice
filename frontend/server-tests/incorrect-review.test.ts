import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, test } from 'node:test'
import { configuration, setConfigurationForTesting } from '../server/core/config.ts'
import { closeDatabase, isolatedTransaction, record } from '../server/core/db.ts'
import { saveQuestion } from '../server/services/learning-writer.ts'
import { listIncorrectReviewQuestions } from '../server/services/incorrect-review.ts'
import type { User } from '../server/core/auth.ts'
import { choiceLabelsForQuestion } from '../shared/schemas/exam.ts'

process.env.APP_ENV = 'test'
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
const integration = { skip: !process.env.TEST_DATABASE_URL }
const original = structuredClone(configuration)
after(async () => { setConfigurationForTesting(original); await closeDatabase() })

test('review requires an identity before reading learning data', async () => {
  await assert.rejects(listIncorrectReviewQuestions(null, {} as any), (error: any) => error.status === 401)
})

test('latest answer, content version, owner, parent visibility and current entitlement define the review set without writes', integration, async () => {
  const config = structuredClone(original)
  config.exam = { set_count: 2, questions_per_exam: 85, choice_labels: original.exam.choice_labels }
  config.payments = { ...config.payments, enabled: true, free_exam_count: 1 }
  setConfigurationForTesting(config)
  try {
    await isolatedTransaction(async db => {
      const createUser = async () => record(await db.user.create({ data: { name: 'Synthetic review', email: `review-${randomUUID()}@example.invalid`, role: 'user', created_at: new Date(), updated_at: new Date() } })) as User
      const owner = await createUser(), other = await createUser()
      const category = config.categories.minor[0]!
      const rows = []
      for (let number = 1; number <= 7; number++) {
        rows.push(await saveQuestion({ exam_number: number === 7 ? 2 : 1, question_number: number,
          major_category_code: category.major_category_value, category_code: category.value,
          publication_status: number === 6 ? 'draft' : 'published', source_text: 'Synthetic source | https://example.com/review',
          content_blocks: [{ type: 'text', text: 'Synthetic review question' }], explanation_blocks: [{ type: 'text', text: 'Synthetic explanation' }],
          choices: choiceLabelsForQuestion(config, 1, number).map((choice_label, index) => ({ choice_label, display_order: index + 1, is_correct: index === 0, content_blocks: [{ type: 'text', text: 'Synthetic choice' }] })) }, { db }))
      }
      const stamp = new Date()
      const answer = async (index: number, correct: boolean, userId = owner.id, version = 1) => {
        const question = rows[index]!
        await db.answerHistory.create({ data: { user_id: userId, question_id: question.id, selected_choice_id: question.choices[0]!.id,
          question_version: version, is_correct: correct, created_at: stamp, updated_at: stamp } })
      }
      await answer(0, false); await answer(0, true) // Same timestamp: higher ID wins.
      await answer(1, true); await answer(1, false)
      await answer(2, false)
      await db.question.update({ where: { id: rows[2]!.id }, data: { content_version: 2 } })
      await answer(3, false, other.id)
      await answer(4, false); await answer(5, false); await answer(6, false)
      const snapshot = async () => ({ histories: await db.answerHistory.findMany({ where: { user_id: { in: [owner.id, other.id] } }, orderBy: { id: 'asc' } }), questions: await db.question.findMany({ orderBy: { id: 'asc' } }) })
      const before = await snapshot()
      const result = await listIncorrectReviewQuestions(owner, db)
      assert.deepEqual(result, { data: [rows[1], rows[4]].map(q => ({ question_id: Number(q!.id), exam_number: 1, question_number: q!.question_number })), meta: { total_count: 2 } })
      assert.deepEqual(await listIncorrectReviewQuestions(owner, db), result)
      assert.deepEqual(await snapshot(), before)
      assert.equal((await listIncorrectReviewQuestions({ ...owner, role: 'admin' }, db)).meta.total_count, 3)
      assert.equal((await listIncorrectReviewQuestions(other, db)).meta.total_count, 1)
      await db.examSet.update({ where: { exam_number: 1 }, data: { publication_status: 'draft' } })
      assert.deepEqual((await listIncorrectReviewQuestions(owner, db)).data, [])
      await db.examSet.update({ where: { exam_number: 1 }, data: { publication_status: 'published' } })
      const group = await db.questionGroup.create({ data: { exam_number: 1, group_number: 1, title: 'Synthetic hidden group', planned_question_count: 1, publication_status: 'draft' } })
      await db.question.update({ where: { id: rows[1]!.id }, data: { group_id: group.id, group_question_number: 1 } })
      assert.equal((await listIncorrectReviewQuestions(owner, db)).meta.total_count, 1)
    })
  } finally { setConfigurationForTesting(original) }
})
