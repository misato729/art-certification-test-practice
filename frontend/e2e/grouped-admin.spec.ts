import { test, expect, type Page } from '@playwright/test'
import { loadE2EFixture } from '../scripts/e2e-fixture.mjs'
import type { ExamSet, QuestionGroup, PassageInline } from '../shared/types/learning.ts'
import type { AdminQuestion } from '../app/types/adminQuestion.ts'

const { config } = loadE2EFixture()
const timestamp = '2026-01-01T00:00:00.000Z'

async function mockAdmin(page: Page) {
  const admin = { id: 990001, name: '大問管理検証', email: 'group-admin@example.test', role: 'admin', paid_content_access: true,
    favorite_questions: [], membership: { status: 'free', purchased_at: null, expires_at: null }, verification_access: null, created_at: timestamp }
  await page.route('**/api/v1/me', route => route.fulfill({ json: { data: admin } }))
  await page.route('**/api/auth/get-session**', route => route.fulfill({ json: {
    session: { id: 'synthetic-group-session', userId: String(admin.id), token: 'synthetic-group-token', expiresAt: '2099-01-01T00:00:00.000Z', createdAt: timestamp, updatedAt: timestamp },
    user: { id: String(admin.id), name: admin.name, email: admin.email, role: 'admin', emailVerified: false, createdAt: timestamp, updatedAt: timestamp },
  } }))
}

// Synthetic HTTP responses exercise editor state and payloads; database checks run separately.
test('group manager edits shared passages and links six-choice questions without losing IDs or versions', async ({ page }, testInfo) => {
  await mockAdmin(page)
  const category = config.categories.minor[0]!
  let group: QuestionGroup = {
    id: 990101, exam_number: 1, group_number: 23, title: '合成の大問', planned_question_count: 1, publication_status: 'draft', lock_version: 7,
    passages: [{ id: 990201, label: 'A', display_order: 1, content_blocks: [{ type: 'text', text: '合成の共通本文' }] }],
    questions: [{ id: 990301, question_number: 81, group_question_number: 1, publication_status: 'draft', summary: '合成の小問' }],
  }
  let question: AdminQuestion = {
    id: 990301, exam_number: 1, question_number: 81, group_id: group.id, group_question_number: 1,
    passage_references: [{ passage_id: 990201, anchor_id: null }], lock_version: 9,
    major_category_code: category.major_category_value, category_code: category.value,
    publication_status: 'draft', source_text: '', content_blocks: [{ type: 'text', text: '合成の小問' }],
    explanation_blocks: [{ type: 'text', text: '合成の解説' }], created_at: timestamp, updated_at: timestamp,
    choices: ['ア', 'イ', 'ウ', 'エ', 'オ', 'カ'].map((label, index) => ({
      id: 990401 + index, choice_label: label, display_order: index + 1, is_correct: index === 5,
      content_blocks: [{ type: 'text', text: `合成選択肢${index + 1}` }],
    })),
  }
  const exam = (): ExamSet => ({ exam_number: 1, title: '合成の模擬試験', publication_status: 'draft', lock_version: 3, groups: [group] })
  let groupSaves = 0
  let questionSaves = 0
  let anchorId = ''
  await page.route('**/api/v1/admin/**', async route => {
    const path = new URL(route.request().url()).pathname
    const method = route.request().method()
    if (path === '/api/v1/admin/exams/1') return route.fulfill({ json: { data: exam() } })
    if (path === '/api/v1/admin/questions' && method === 'GET') return route.fulfill({ json: { data: [{ id: question.id, exam_number: 1, question_number: question.question_number }], meta: { current_page: 1, per_page: 100, total_count: 1, total_pages: 1 } } })
    if (path === `/api/v1/admin/question_groups/${group.id}`) {
      if (method === 'GET') return route.fulfill({ json: { data: group } })
      if (method === 'PUT') {
        groupSaves++
        const input = route.request().postDataJSON().group
        expect(input.lock_version).toBe(7)
        expect(input.question_ids).toEqual([question.id])
        expect(input.passages).toHaveLength(2)
        expect(input.passages[0].id).toBe(990201)
        expect(input.passages[1].id).toBeUndefined()
        const anchor = input.passages[0].content_blocks[0].inlines.find((part: PassageInline) => part.type === 'anchor')
        expect(anchor?.id).toMatch(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/)
        expect(anchor?.text === '合成の下線部分').toBe(true)
        anchorId = anchor.id
        group = { ...group, ...input, lock_version: 8, passages: input.passages.map((passage: QuestionGroup['passages'][number], index: number) => ({ ...passage, id: passage.id ?? 990202 + index - 1 })) }
        return route.fulfill({ json: { data: group } })
      }
    }
    if (path === `/api/v1/admin/questions/${question.id}`) {
      if (method === 'GET') return route.fulfill({ json: { data: question } })
      if (method === 'PATCH') {
        questionSaves++
        const input = route.request().postDataJSON().question
        expect(input.lock_version).toBe(9)
        expect(input.question_number).toBe(82)
        expect(input.group_id).toBe(group.id)
        expect(input.group_question_number).toBe(1)
        expect(input.passage_references).toEqual([{ passage_id: 990201, anchor_id: anchorId }, { passage_id: 990202, anchor_id: null }])
        expect(input.choices.map((choice: { id: number }) => choice.id)).toEqual(question.choices.map(choice => choice.id))
        expect(input.choices.map((choice: { choice_label: string }) => choice.choice_label)).toEqual(['ア', 'イ', 'ウ', 'エ', 'オ', 'カ'])
        expect(input.choices[5].is_correct).toBe(true)
        question = { ...question, ...input, lock_version: 10 }
        return route.fulfill({ json: { data: question } })
      }
    }
    return route.continue()
  })

  await page.goto(`/admin/exams/1?group_id=${group.id}`)
  await expect(page.locator('#group-title')).toHaveValue('合成の大問')
  const firstPassage = page.locator('.passage-editor').first()
  await firstPassage.getByRole('button', { name: '文章を分けて参照箇所・空欄を設定', exact: true }).click()
  await firstPassage.getByRole('button', { name: '参照箇所を追加', exact: true }).click()
  const anchor = firstPassage.locator('.inline-part').nth(1)
  await anchor.getByLabel('表示ラベル', { exact: true }).fill('a')
  await anchor.getByLabel('文章', { exact: true }).fill('合成の下線部分')
  await page.getByRole('button', { name: '本文を追加', exact: true }).click()
  await page.locator('.passage-editor').nth(1).getByLabel('文章', { exact: true }).fill('合成の追加本文')
  await page.getByRole('button', { name: '大問・共通本文を保存', exact: true }).click()
  await expect(page.getByText('大問と共通本文を保存しました。', { exact: true })).toBeVisible()
  expect(groupSaves).toBe(1)
  await expect(page.locator('.passage-editor')).toHaveCount(2)
  await page.getByRole('button', { name: '大問全体をプレビュー', exact: true }).click()
  await expect(page.locator('.group-preview > header h3')).toHaveText(['【A】', '【B】'])
  await page.screenshot({ path: testInfo.outputPath('group-preview.png'), fullPage: true })

  await page.goto(`/admin/questions/${question.id}/edit`)
  await expect(page.locator('.choice-editor')).toHaveCount(6)
  const references = page.locator('.reference-list')
  await references.getByRole('checkbox', { name: '【A】 全体', exact: true }).uncheck()
  await references.getByRole('checkbox', { name: '【A】 参照箇所（a）', exact: true }).check()
  await references.getByRole('checkbox', { name: '【B】 全体', exact: true }).check()
  await page.getByLabel('問番号', { exact: true }).fill('80')
  await expect(page.locator('.choice-editor')).toHaveCount(6)
  await page.getByLabel('問番号', { exact: true }).fill('82')
  await expect(page.locator('.choice-editor')).toHaveCount(6)
  await expect(page.locator('.choice-editor input[name="correct-choice"]').nth(5)).toBeChecked()
  await page.getByRole('button', { name: '編集内容を保存', exact: true }).click()
  await expect(page.getByText('編集内容を保存しました。', { exact: true })).toBeVisible()
  expect(questionSaves).toBe(1)
  await expect(references.getByRole('checkbox', { name: '【A】 参照箇所（a）', exact: true })).toBeChecked()
  await expect(page.locator('#group-question-number')).toHaveValue('1')
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: window.innerWidth }))
  expect(dimensions.width).toBeLessThanOrEqual(dimensions.viewport)
})
