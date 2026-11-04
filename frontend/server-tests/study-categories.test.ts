import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDatabase, isolatedTransaction } from '../server/core/db.ts'
import { importStudyCategories, STUDY_CATEGORY_CONFIRMATION } from '../server/operations/study-categories.ts'
import { listStudyCategories, validateStudyFilter } from '../server/services/study-categories.ts'
import { nextQuestion } from '../server/services/learning.ts'
import { saveQuestion } from '../server/services/learning-writer.ts'
import { configuration } from '../server/core/config.ts'
import { choiceLabelsForQuestion } from '../shared/schemas/exam.ts'

process.env.APP_ENV = 'test'
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
const integration = { skip: !process.env.DATABASE_URL }
after(() => closeDatabase())

test('master import is atomic, idempotent, conflict-safe and leaves the existing question domain unchanged', integration, async () => {
  const folder = await mkdtemp(join(tmpdir(), 'art-categories-'))
  const file = join(folder, 'categories.json')
  const categories = [
    { code: 'test_part', scheme: 'study_outline', parent_code: null, number: 1, sort_order: 1, label: 'Synthetic part' },
    { code: 'test_section', scheme: 'study_outline', parent_code: 'test_part', number: 1, sort_order: 1, label: 'Synthetic section' },
    { code: 'test_empty', scheme: 'study_outline', parent_code: null, number: 2, sort_order: 2, label: 'Synthetic empty part' },
    { code: 'test_scope', scheme: 'exam_scope', parent_code: null, number: 1, sort_order: 1, label: 'Synthetic scope' },
  ]
  try {
    await writeFile(file, JSON.stringify({ schema_version: 1, categories }))
    await isolatedTransaction(async db => {
      await db.studyCategory.deleteMany()
      const category = configuration.categories.minor[0]!
      await saveQuestion({ exam_number: 1, question_number: 1,
        major_category_code: category.major_category_value, category_code: category.value,
        publication_status: 'draft', source_text: '', content_blocks: [{ type: 'text', text: 'Synthetic question' }],
        explanation_blocks: [{ type: 'text', text: 'Synthetic explanation' }],
        choices: choiceLabelsForQuestion(configuration, 1, 1).map((choice_label, index) => ({ choice_label, display_order: index + 1,
          is_correct: index === 0, content_blocks: [{ type: 'text', text: `Synthetic choice ${index + 1}` }] })) }, { db })
      const before = await db.question.findMany({ include: { choices: true, histories: true, favorites: true } })
      await assert.rejects(importStudyCategories(file, undefined, db))
      assert.equal((await importStudyCategories(file, STUDY_CATEGORY_CONFIRMATION, db)).created_count, 4)
      const saved = await db.studyCategory.findMany({ orderBy: { code: 'asc' } })
      assert.equal((await importStudyCategories(file, STUDY_CATEGORY_CONFIRMATION, db)).status, 'unchanged')
      assert.deepEqual(await db.studyCategory.findMany({ orderBy: { code: 'asc' } }), saved)
      const catalog = await listStudyCategories(db)
      assert.equal(catalog.data.study_outline.length, 2)
      assert.equal(catalog.data.study_outline[1]!.children.length, 0)
      assert.equal(await validateStudyFilter({}, db), false)
      assert.equal(await validateStudyFilter({ study_category_codes: 'test_part,test_section' }, db), true)
      await assert.rejects(validateStudyFilter({ study_category_codes: 'test_scope' }, db), (error: any) => error.status === 400)
      await assert.rejects(nextQuestion({ study_category_codes: 'test_part' }, null, db), (error: any) => error.status === 404)
      assert.equal(await validateStudyFilter({ study_part_code: 'test_part', study_section_code: 'test_section', study_scope_codes: 'test_scope' }, db), true)
      await assert.rejects(validateStudyFilter({ study_section_code: 'test_section' }, db), (error: any) => error.status === 400)
      await assert.rejects(validateStudyFilter({ study_part_code: 'test_empty', study_section_code: 'test_section' }, db), (error: any) => error.status === 400)
      await assert.rejects(validateStudyFilter({ study_scope_codes: 'missing' }, db), (error: any) => error.status === 400)
      await assert.rejects(nextQuestion({ study_part_code: 'test_part' }, null, db), (error: any) => error.status === 404)
      const conflicting = structuredClone(categories); conflicting[0]!.label = 'Changed label'
      await writeFile(file, JSON.stringify({ schema_version: 1, categories: conflicting }))
      await assert.rejects(importStudyCategories(file, STUDY_CATEGORY_CONFIRMATION, db))
      assert.deepEqual(await db.studyCategory.findMany({ orderBy: { code: 'asc' } }), saved)
      assert.deepEqual(await db.question.findMany({ include: { choices: true, histories: true, favorites: true } }), before)
    })
  } finally { await rm(folder, { recursive: true, force: true }) }
})
