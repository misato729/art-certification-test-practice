import { test, expect, type Page } from '@playwright/test'

const firstGroup = { id: 710, group_number: 1, title: '合成の本文比較', question_numbers: [1, 2] }
const secondGroup = { id: 711, group_number: 2, title: '合成の独立設問', question_numbers: [3] }
const reading = [{ id: 720, label: 'A', display_order: 1, content_blocks: [{ type: 'text', inlines: [
  { type: 'text', text: 'これは検証専用の文章です。' },
  { type: 'anchor', id: 'ref-a', label: 'a', text: '<img src=x onerror=alert(1)>', underline: true },
  { type: 'text', text: '参照を使って本文に戻れます。' },
] }] }]

async function mockGroupedPractice(page: Page) {
  await page.route('**/api/v1/exams', route => route.fulfill({ json: { data: [{ exam_number: 1, title: '模擬試験1', question_numbers: [1, 2, 3], published_question_count: 3, access: 'available', groups: [firstGroup, secondGroup] }] } }))
  await page.route('**/api/v1/questions/next?**', async route => {
    const number = Number(new URL(route.request().url()).searchParams.get('question_number'))
    if (number === 2) await new Promise(resolve => setTimeout(resolve, 300))
    await route.fulfill({ json: { data: {
      id: 730 + number, exam_number: 1, question_number: number, question_version: 1,
      group_question_number: number === 3 ? 1 : number,
      group: number === 3 ? secondGroup : firstGroup,
      content_blocks: [{ type: 'text', text: `合成の設問${number}` }], major_category_code: 'western', category_code: 'modern',
      shared_passages: number === 3 ? [] : reading,
      passage_references: number === 3 ? [] : [{ passage_id: 720, anchor_id: 'ref-a' }],
      choices: ['ア', 'イ', 'ウ', 'エ'].map((choice_label, index) => ({ id: 800 + index, choice_label, display_order: index + 1, content_blocks: [{ type: 'text', text: `合成選択肢${index + 1}` }] })),
    } } })
  })
}

async function openExamGroups(page: Page) {
  const mobile = page.locator('.mobile-exam-toggle')
  if (await mobile.isVisible()) await mobile.click()
  await page.locator('.exam-row button').click()
}

async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
}

test('shared reading stays collapsed across siblings, reference links focus safely, and the next group clears it', async ({ page }) => {
  await mockGroupedPractice(page)
  await page.goto('/practice/1/1')
  await expect(page.locator('.practice-head h1')).toContainText('大問1')
  await expect(page.locator('.question-number')).toHaveText('問1')
  await expect(page.locator('.question-text')).toHaveText('合成の設問1')
  await expect(page.locator('.shared-passage img')).toHaveCount(0)
  await expect(page.locator('.reference-anchor u')).toHaveText('<img src=x onerror=alert(1)>')
  const toggle = page.getByRole('button', { name: '共通本文', exact: true })
  const contentId = await toggle.getAttribute('aria-controls')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await page.getByRole('link', { name: '問2', exact: true }).click()
  await expect(page.locator('.question-text')).toHaveText('合成の設問2')
  await expect(page.locator('.question-number')).toHaveText('問2')
  await expect(toggle).toHaveAttribute('aria-controls', contentId!)
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await page.getByRole('button', { name: '【A】 (a)を確認', exact: true }).click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('#passage-720-ref-a')).toBeFocused()
  await fits(page)
  await openExamGroups(page)
  await expect(page.locator('.group-list a')).toHaveCount(2)
  await expect(page.locator('.question-list')).toHaveCount(0)
  await page.getByRole('link', { name: '大問2 合成の独立設問', exact: true }).click()
  await expect(page).toHaveURL('/practice/1/3')
  await expect(page.locator('.practice-head h1')).toContainText('大問2')
  await expect(page.locator('.question-number')).toHaveText('問1')
  await expect(page.locator('.question-text')).toHaveText('合成の設問3')
  await expect(page.locator('.shared-passages')).toHaveCount(0)
  await fits(page)
})


test('outdated history stays visible with a neutral label and links to the current question', async ({ page }) => {
  await mockGroupedPractice(page)
  const timestamp = '2026-01-01T00:00:00.000Z'
  const user = { id: 910001, name: '合成の履歴検証', email: 'grouped-history@example.test', role: 'user', paid_content_access: false,
    favorite_questions: [], membership: { status: 'free', purchased_at: null, expires_at: null }, verification_access: null, created_at: timestamp }
  await page.route('**/api/v1/me', route => route.fulfill({ json: { data: user } }))
  await page.route('**/api/auth/get-session**', route => route.fulfill({ json: {
    session: { id: 'synthetic-history-session', userId: String(user.id), token: 'synthetic-history-token', expiresAt: '2099-01-01T00:00:00.000Z', createdAt: timestamp, updatedAt: timestamp },
    user: { id: String(user.id), name: user.name, email: user.email, role: user.role, emailVerified: false, createdAt: timestamp, updatedAt: timestamp },
  } }))
  await page.route('**/api/v1/answer_histories?**', route => route.fulfill({ json: {
    data: [{ id: 99, locked: false, is_outdated: true, question_version: 1, answered_at: timestamp, question: { id: 731, exam_number: 1, question_number: 1 } }],
    meta: { current_page: 1, per_page: 20, total_count: 1, total_pages: 1 },
  } }))
  await page.goto('/history')
  await expect(page.locator('.history-card')).toHaveCount(1)
  await expect(page.locator('.history-card .result-badge')).toHaveText('更新前の回答')
  await expect(page.locator('.history-card .selected-answer')).toHaveCount(0)
  await expect(page.locator('.history-card a')).toHaveAttribute('href', '/practice/1/1')
  await page.locator('.history-card a').click()
  await expect(page.locator('.question-text')).toHaveText('合成の設問1')
  await expect(page.getByRole('heading', { name: '解答解説', exact: true })).toHaveCount(0)
  await fits(page)
})
