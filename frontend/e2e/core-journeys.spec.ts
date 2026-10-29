import { randomBytes } from 'node:crypto'
import { test, expect, type Page } from '@playwright/test'
import { loadE2EFixture } from '../scripts/e2e-fixture.mjs'

const { config, question } = loadE2EFixture()
const practicePath = `/practice/${question.exam_number}/${question.question_number}`
const correctIndex = question.choices.findIndex((choice: { is_correct: boolean }) => choice.is_correct)

async function assertFitsViewport(page: Page) {
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: window.innerWidth }))
  expect(dimensions.width).toBeLessThanOrEqual(dimensions.viewport)
}

async function showQuestion(page: Page) {
  const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/questions/next' && response.ok())
  await page.goto(practicePath)
  await expect(page.getByRole('heading', { name: `問${question.question_number}`, exact: true })).toBeVisible()
  return (await (await response).json()).data
}

async function answerCorrectly(page: Page) {
  // Users can select the full choice label, including on a touch screen.
  await page.locator('.choices label').nth(correctIndex).click()
  await expect(page.getByRole('radio').nth(correctIndex)).toBeChecked()
  await page.getByRole('button', { name: '回答する', exact: true }).click()
  await expect(page.getByText('正解です', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '解答解説', exact: true })).toBeVisible()
}

async function logout(page: Page) {
  await page.getByRole('button', { name: 'メニューを開く', exact: true }).click()
  await page.getByRole('button', { name: 'ログアウト', exact: true }).click()
  await expect(page).toHaveURL('/')
  await expect(page.locator('.site-header .account-link')).toHaveCount(0)
  // The narrow layout offers login in its drawer rather than this header link.
  await expect(page.locator('.site-header .login-link')).toHaveAttribute('href', '/login')
}

test('anonymous practice hides answers until submitting and fits the screen', async ({ page }) => {
  const publicQuestion = await showQuestion(page)
  for (const key of ['explanation_blocks', 'source_text', 'correct_choice']) expect(Object.hasOwn(publicQuestion, key)).toBe(false)
  for (const choice of publicQuestion.choices) expect(Object.hasOwn(choice, 'is_correct')).toBe(false)
  await expect(page.getByRole('radio')).toHaveCount(config.exam.choice_labels.length)
  await expect(page.getByRole('heading', { name: '解答解説', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '回答する', exact: true })).toBeDisabled()
  await assertFitsViewport(page)
  await answerCorrectly(page)
  await assertFitsViewport(page)
  const historyResponse = await page.request.get('/api/v1/answer_histories')
  expect(historyResponse.status()).toBe(401)
  const deniedAdmin = await page.request.get('/api/v1/admin/questions')
  expect(deniedAdmin.status()).toBe(401)
})

test('registration, history, favorites, relogin and cross-tab logout stay consistent', async ({ page, context }) => {
  const suffix = randomBytes(8).toString('hex')
  const email = `browser-${suffix}@example.test`
  const password = `Synthetic-${randomBytes(16).toString('hex')}`
  await page.goto('/signup')
  await page.getByLabel('ユーザー名', { exact: true }).fill(`検証会員${suffix}`)
  await page.getByLabel('メールアドレス', { exact: true }).fill(email)
  await page.getByLabel('パスワード', { exact: true }).fill(password)
  await page.getByLabel('確認用パスワード', { exact: true }).fill(password)
  await page.getByRole('button', { name: '登録する', exact: true }).click()
  await expect(page).toHaveURL('/')
  await expect(page.locator('.site-header .account-link')).toBeVisible()

  const cookies = await context.cookies()
  const sessionCookie = cookies.find(cookie => cookie.name.endsWith('session_token'))
  expect(sessionCookie).toBeDefined()
  expect(sessionCookie?.httpOnly).toBe(true)
  expect(sessionCookie?.sameSite).toBe('Lax')
  const deniedAdmin = await page.request.get('/api/v1/admin/questions')
  expect(deniedAdmin.status()).toBe(403)

  await showQuestion(page)
  await page.getByRole('button', { name: 'お気に入りに登録する', exact: true }).click()
  await expect(page.getByRole('button', { name: 'お気に入りから解除する', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await answerCorrectly(page)
  await page.goto('/history')
  await expect(page.getByRole('heading', { name: '解答履歴', exact: true })).toBeVisible()
  await expect(page.locator('.history-card')).toHaveCount(1)
  await page.locator('.history-card a').click()
  await expect(page).toHaveURL(/answer_history_id=\d+/)
  await expect(page.getByRole('heading', { name: '解答解説', exact: true })).toBeVisible()
  await page.goto('/favorites')
  await expect(page.locator('.favorite-card')).toHaveCount(1)
  await page.reload()
  await expect(page).toHaveURL('/favorites')
  await expect(page.locator('.favorite-card')).toHaveCount(1)
  await assertFitsViewport(page)
  await logout(page)

  // A direct protected URL must return here after a successful login.
  await page.goto('/favorites')
  await expect(page).toHaveURL(/\/login\?redirect=/)
  await page.getByLabel('メールアドレス', { exact: true }).fill(email)
  await page.getByLabel('パスワード', { exact: true }).fill('Deliberately-wrong-password')
  await page.getByRole('button', { name: 'ログイン', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('メールアドレスまたはパスワードが正しくありません')
  await expect(page).toHaveURL(/\/login\?redirect=/)
  await page.getByLabel('パスワード', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'ログイン', exact: true }).click()
  await expect(page).toHaveURL('/favorites')
  await expect(page.locator('.favorite-card')).toHaveCount(1)
  const firstTabSession = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/get-session' && response.ok())
  await page.goto('/history')
  await firstTabSession
  await expect(page.locator('.history-card')).toHaveCount(1)

  const otherTab = await context.newPage()
  const secondTabSession = otherTab.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/get-session' && response.ok())
  await otherTab.goto('/favorites')
  await secondTabSession
  await expect(otherTab.locator('.favorite-card')).toHaveCount(1)
  // Playwright can interact with a background page; model a real tab switch.
  await page.bringToFront()
  await logout(page)
  await otherTab.bringToFront()
  await expect(otherTab.locator('.site-header .account-link')).toHaveCount(0)
  await expect(otherTab.locator('.site-header .login-link')).toHaveAttribute('href', '/login')
  await expect(otherTab.getByRole('heading', { name: 'ログインが必要です', exact: true })).toBeVisible()
  await expect(otherTab.locator('.favorite-card')).toHaveCount(0)
  const historyAfterLogout = await otherTab.request.get('/api/v1/answer_histories')
  expect(historyAfterLogout.status()).toBe(401)
  await otherTab.reload()
  await expect(otherTab).toHaveURL(/\/login\?redirect=/)
  await otherTab.close()
})
