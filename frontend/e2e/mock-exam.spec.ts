import { readFileSync } from 'node:fs'
import { test, expect, type Page, type Locator, type TestInfo } from '@playwright/test'
import { loadE2EFixture } from '../scripts/e2e-fixture.mjs'
import { type Block, type QuestionInput } from '../shared/schemas/content.ts'
import { parseContentDocument } from '../shared/schemas/structure.ts'
import { choiceLabelsForQuestion } from '../shared/schemas/exam.ts'

const { config } = loadE2EFixture()
const fixtureDocument = parseContentDocument(JSON.parse(readFileSync(new URL('../../content/questions.json', import.meta.url), 'utf8')), config)
const questions = fixtureDocument.questions
  .filter(question => question.publication_status === 'published')
  .sort((left, right) => left.exam_number - right.exam_number || left.question_number - right.question_number)

type PublicQuestion = {
  id: number
  exam_number: number
  question_number: number
  content_blocks: Block[]
  choices: { id: number, choice_label: string, content_blocks: Block[] }[]
}

const compact = (text: string) => text.replace(/\s/g, '')
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)]))
  return value
}
const sameData = (left: unknown, right: unknown) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
let lastSubmissionAt = 0

async function assertFitsViewport(page: Page) {
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: window.innerWidth }))
  expect(dimensions.width).toBeLessThanOrEqual(dimensions.viewport)
}

async function assertBlockTextShown(locator: Locator, blocks: Block[]) {
  const rendered = compact(await locator.innerText())
  const values = blocks.flatMap(block => block.type === 'table'
    ? [...(block.headers ?? []), ...(block.rows ?? []).flat()]
    : block.type === 'fill_in_choice' ? block.cells ?? []
    : block.inlines ? block.inlines.map(inline => inline.type === 'blank' ? inline.label : inline.text)
    : [(block.text ?? '').replace(/\{\{([^}]+)\}\}/g, '$1')])
  // Boolean comparisons keep authored question bodies out of failure logs.
  expect(values.filter(Boolean).every(value => rendered.includes(compact(value))), 'visible block text matches the fixture').toBe(true)
}

async function showQuestion(page: Page, question: QuestionInput, action: () => Promise<unknown>): Promise<PublicQuestion> {
  const response = page.waitForResponse(response => {
    const url = new URL(response.url())
    return url.pathname === '/api/v1/questions/next'
      && url.searchParams.get('exam_number') === String(question.exam_number)
      && url.searchParams.get('question_number') === String(question.question_number)
  })
  await action()
  const result = await response
  expect(result.status()).toBe(200)
  const payload = (await result.json()).data
  for (const key of ['is_correct', 'correct_choice', 'explanation_blocks', 'source_text']) {
    expect(Object.hasOwn(payload, key), 'public question excludes answer material').toBe(false)
  }
  for (const choice of payload.choices) {
    for (const key of ['is_correct', 'correct_choice', 'explanation_blocks', 'source_text']) {
      expect(Object.hasOwn(choice, key), 'public choice excludes answer material').toBe(false)
    }
  }
  expect(payload.exam_number).toBe(question.exam_number)
  expect(payload.question_number).toBe(question.question_number)
  expect(sameData(payload.content_blocks, question.content_blocks), 'API question blocks match the fixture').toBe(true)
  const expectedLabels = choiceLabelsForQuestion(config, question.exam_number, question.question_number)
  expect(expectedLabels.length).toBe(4)
  expect(payload.choices.map((choice: PublicQuestion['choices'][number]) => choice.choice_label).join('') === expectedLabels.join(''), 'question uses its configured labels').toBe(true)
  expect(payload.choices.every((choice: PublicQuestion['choices'][number], index: number) =>
    sameData(choice.content_blocks, question.choices[index]?.content_blocks)), 'API choices match the fixture').toBe(true)
  await expect(page.getByRole('heading', { name: `問${question.question_number}`, exact: true })).toBeVisible()
  await expect(page.locator('.practice-head .exam-label')).toHaveText('模擬試験 1')
  await expect(page.getByRole('radio')).toHaveCount(expectedLabels.length)
  await expect(page.getByRole('heading', { name: '解答解説', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '回答する', exact: true })).toBeDisabled()
  const group = fixtureDocument.groups.find(group => group.id === question.group_id)
  const required = new Set((question.passage_references ?? []).map(reference => reference.passage_id))
  const expectedPassages = (group?.passages ?? []).filter(passage => required.has(passage.id)).sort((left, right) => left.display_order - right.display_order)
  const publicPassages = payload.shared_passages ?? []
  expect(publicPassages.length).toBe(expectedPassages.length)
  expect(publicPassages.every((passage: { label: string; display_order: number; content_blocks: Block[] }, index: number) => {
    const expected = expectedPassages[index]
    return Boolean(expected && passage.label === expected.label && passage.display_order === expected.display_order && sameData(passage.content_blocks, expected.content_blocks))
  }), 'API shared passages match the fixture without relying on remapped database IDs').toBe(true)
  await expect(page.locator('.shared-reading')).toHaveCount(expectedPassages.length ? 1 : 0)
  for (const [index, passage] of expectedPassages.entries()) {
    const renderedPassage = page.locator('.shared-reading > div').nth(index)
    expect(compact(await renderedPassage.locator('h3').innerText()) === compact(`【${passage.label}】`), 'shared passage label matches the fixture').toBe(true)
    await assertBlockTextShown(renderedPassage.locator('.content-blocks'), passage.content_blocks)
  }
  await assertBlockTextShown(page.locator('.question-text'), question.content_blocks)
  for (const [index, choice] of question.choices.entries()) {
    await assertBlockTextShown(page.locator('.choice-content').nth(index), choice.content_blocks)
  }
  await assertFitsViewport(page)
  return payload
}

async function answerCorrectly(page: Page, question: QuestionInput, payload: PublicQuestion) {
  const index = question.choices.findIndex(choice => choice.is_correct)
  expect(index >= 0, 'fixture has one correct choice').toBe(true)
  await page.locator('.choices label').nth(index).click()
  await expect(page.getByRole('radio').nth(index)).toBeChecked()
  // Exercise the real 120/minute limiter without bypassing it during this 85-question journey.
  const delay = 650 - (Date.now() - lastSubmissionAt)
  if (delay > 0) await page.waitForTimeout(delay)
  const response = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/questions/${payload.id}/answer`
    && response.request().method() === 'POST')
  lastSubmissionAt = Date.now()
  await page.getByRole('button', { name: '回答する', exact: true }).click()
  const result = await response
  expect(result.status()).toBe(200)
  const answer = (await result.json()).data
  expect(answer.is_correct).toBe(true)
  expect(answer.correct_choice.id === payload.choices[index]?.id, 'grading uses the selected correct choice').toBe(true)
  expect(sameData(answer.explanation_blocks, question.explanation_blocks), 'graded explanation matches the fixture').toBe(true)
  expect(answer.source_text === question.source_text, 'graded sources match the fixture').toBe(true)
  await expect(page.getByText('正解です', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '解答解説', exact: true })).toBeVisible()
  await assertBlockTextShown(page.locator('.answer-result'), question.explanation_blocks)
  await expect(page.locator('.source-section a')).toHaveCount((question.source_text ?? '').split('\n').filter(Boolean).length)
  await assertFitsViewport(page)
}

async function finishSequence(page: Page) {
  await page.getByRole('button', { name: '次の問題', exact: true }).click()
  await expect(page.locator('.completed-message')).toBeVisible()
  await expect(page.getByRole('button', { name: '次の問題', exact: true })).toHaveCount(0)
}

async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(name)
  await page.screenshot({ path, fullPage: true, animations: 'disabled' })
  await testInfo.attach(name, { path, contentType: 'image/png' })
}

async function assertSingleExamName(page: Page) {
  const mobileToggle = page.locator('.mobile-exam-toggle')
  const isMobile = await mobileToggle.isVisible()
  if (isMobile) await mobileToggle.click()
  await expect(page.locator('.exam-sidebar .exam-link')).toHaveCount(1)
  await expect(page.locator('.exam-sidebar .exam-link')).toHaveText('模擬試験1')
  await expect(page.locator('.exam-sidebar .exam-link')).toBeVisible()
  if (isMobile) await mobileToggle.click()
}

test('all 85 four-choice questions and shared passages hide answers, render and grade across the history/application boundary', async ({ page }, testInfo) => {
  test.setTimeout(240000)
  expect(questions.length).toBe(85)
  expect(questions.every(question => question.exam_number === 1)).toBe(true)
  expect(questions.reduce((total, question) => total + question.choices.length, 0)).toBe(340)
  await page.goto('/')
  await expect(page.locator('.exam-card')).toHaveCount(1)
  await expect(page.locator('.exam-card strong')).toHaveText('模擬試験1')
  await expect(page.locator('.exam-grid-heading')).toContainText('大問の順に演習')
  await assertSingleExamName(page)
  await screenshot(page, testInfo, 'mock-home.png')
  for (const [index, question] of questions.entries()) {
    const payload = await showQuestion(page, question, () => index === 0
      ? page.goto(`/practice/1/${question.question_number}`)
      : page.getByRole('button', { name: '次の問題', exact: true }).click())
    if ([80, 81, 82, 85].includes(question.question_number)) {
      await screenshot(page, testInfo, `mock-question-${question.question_number}.png`)
    }
    await answerCorrectly(page, question, payload)
    if (question.question_number === 85) await screenshot(page, testInfo, 'mock-answer-85.png')
  }
  await finishSequence(page)
  await expect(page).toHaveURL('/practice/1/85')
})

async function chooseAllQuestions(page: Page) {
  await page.goto('/')
  await expect(page.locator('.exam-card')).toHaveCount(1)
  await expect(page.locator('.exam-card[href="/practice/start?exams=1"]')).toBeVisible()
  await expect(page.locator('.exam-card strong')).toHaveText('模擬試験1')
  await page.getByRole('tab', { name: '条件を指定', exact: true }).click()
  await expect(page.locator('.condition-submit strong')).toHaveText('全85問')
  await assertFitsViewport(page)
}

test('unfiltered conditions use published positions in sequential and random order', async ({ page }) => {
  test.setTimeout(90000)
  for (const order of ['sequential', 'random']) {
    await chooseAllQuestions(page)
    await page.getByRole('button', { name: order === 'random' ? 'ランダムに始める' : '順番に始める', exact: true }).click()
    const visited = new Set<number>()
    for (let index = 0; index < 3; index += 1) {
      await expect(page.locator('.practice-progress')).toHaveText(`${order === 'random' ? 'ランダム ' : ''}${index + 1} / 85`)
      await expect(page.getByRole('heading', { name: /^問[0-9]+$/ })).toBeVisible()
      const url = new URL(page.url())
      expect(url.pathname.startsWith('/practice/1/')).toBe(true)
      expect(url.searchParams.get('order') === 'random').toBe(order === 'random')
      const number = Number(url.pathname.split('/').at(-1))
      expect(visited.has(number)).toBe(false)
      visited.add(number)
      const question = questions.find(question => question.exam_number === 1 && question.question_number === number)!
      // Read the same public endpoint to validate each chosen position independently.
      const response = await page.request.get(`/api/v1/questions/next?exam_number=1&question_number=${number}`)
      expect(response.status()).toBe(200)
      const payload = (await response.json()).data
      expect(payload.exam_number).toBe(1)
      expect(payload.question_number).toBe(number)
      await answerCorrectly(page, question, payload)
      if (index < 2) await page.getByRole('button', { name: '次の問題', exact: true }).click()
    }
    expect(visited.size).toBe(3)
    expect([...visited].every(number => number >= 1 && number <= 85)).toBe(true)
  }
  for (const path of ['/practice/1/86', '/practice/2/1']) {
    await page.goto(path)
    await expect(page.getByRole('heading', { name: '問題を表示できません', exact: true })).toBeVisible()
  }
})

async function mockAdmin(page: Page) {
  const timestamp = '2026-01-01T00:00:00.000Z'
  const admin = { id: 900001, name: '模試フォーム検証', email: 'mock-form@example.test', role: 'admin', paid_content_access: true,
    favorite_questions: [], membership: { status: 'free', purchased_at: null, expires_at: null }, verification_access: null, created_at: timestamp }
  await page.route('**/api/v1/me', route => route.fulfill({ json: { data: admin } }))
  await page.route('**/api/auth/get-session**', route => route.fulfill({ json: {
    session: { id: 'mock-form-session', userId: String(admin.id), token: 'mock-form-token', expiresAt: '2099-01-01T00:00:00.000Z', createdAt: timestamp, updatedAt: timestamp },
    user: { id: String(admin.id), name: admin.name, email: admin.email, role: 'admin', emailVerified: false, createdAt: timestamp, updatedAt: timestamp },
  } }))
}

test('admin can create and preview four choices and receives field errors without saving', async ({ page }, testInfo) => {
  await mockAdmin(page)
  let saves = 0
  await page.route('**/api/v1/admin/questions', async route => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: { data: [] } })
    saves += 1
    const input = route.request().postDataJSON().question
    expect(input.exam_number).toBe(1)
    expect(input.question_number).toBe(81)
    expect(input.choices.length).toBe(4)
    expect(input.choices.filter((choice: { is_correct: boolean }) => choice.is_correct).length).toBe(1)
    await route.fulfill({ status: 422, json: { error: { code: 'validation_error', message: '入力内容を確認してください', details: { question_number: ['は同じ試験セット内で既に使用されています'] } } } })
  })
  await page.goto('/admin/questions/new')
  await expect(page.locator('.choice-editor')).toHaveCount(4)
  await page.getByLabel('試験ナンバー', { exact: true }).fill('1')
  await page.getByLabel('問番号', { exact: true }).fill('81')
  await expect(page.locator('.choice-editor')).toHaveCount(4)
  await expect(page.locator('.choice-editor > header .choice-label')).toHaveText(['ア', 'イ', 'ウ', 'エ'])
  await page.locator('.choice-editor textarea').first().fill('合成の入力保持')
  await page.locator('.choice-editor').nth(3).locator('textarea').first().fill('合成の選択肢4')
  await page.locator('.choice-editor .correct-control').nth(3).click()
  await expect(page.locator('.choice-editor input[name="correct-choice"]').nth(3)).toBeChecked()
  await page.getByLabel('問番号', { exact: true }).fill('80')
  await expect(page.locator('.choice-editor')).toHaveCount(4)
  await page.getByLabel('問番号', { exact: true }).fill('81')
  await expect(page.locator('.choice-editor')).toHaveCount(4)
  expect(await page.locator('.choice-editor textarea').first().inputValue() === '合成の入力保持', 'new form retains shared-label input').toBe(true)
  expect(await page.locator('.choice-editor').nth(3).locator('textarea').first().inputValue() === '合成の選択肢4', 'new form retains the fourth input across section coordinates').toBe(true)
  await expect(page.locator('input[name="correct-choice"]:checked')).toHaveCount(1)
  await expect(page.locator('.choice-editor input[name="correct-choice"]').nth(3)).toBeChecked()
  await page.getByRole('button', { name: 'プレビュー', exact: true }).click()
  await expect(page.locator('.preview-choices > div')).toHaveCount(4)
  await assertFitsViewport(page)
  await screenshot(page, testInfo, 'admin-four-choice-preview.png')
  await page.getByRole('button', { name: '問題を保存', exact: true }).click()
  await expect(page.locator('.admin-question-form .form-field-error').filter({ hasText: '問番号は同じ試験セット内で既に使用されています' })).toBeVisible()
  expect(saves).toBe(1)
  await page.locator('input[name="publication-status"][value="published"]').check()
  await page.getByRole('button', { name: '問題を保存', exact: true }).click()
  await expect(page.getByText('公開する問題の本文・解説・選択肢に空または不正な表示ブロックがあります', { exact: true }).first()).toBeVisible()
  expect(saves).toBe(1)
})

test('editing an existing four-choice question retains every ID and input through temporary coordinates', async ({ page }) => {
  await mockAdmin(page)
  const base = questions.find(question => question.exam_number === 1 && question.question_number === 81)!
  const initial = { ...base, id: 900101, publication_status: 'draft', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    choices: base.choices.map((choice, index) => ({ ...choice, id: 900201 + index, is_correct: index === 3, content_blocks: [{ type: 'text', text: `合成選択肢${index + 1}` }] })) }
  let saves = 0
  await page.route('**/api/v1/admin/questions/900101', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { data: initial } })
    saves += 1
    const input = route.request().postDataJSON().question
    expect(input.exam_number).toBe(1)
    expect(input.question_number).toBe(82)
    expect(input.choices.length).toBe(4)
    expect(input.choices.every((choice: { id?: number, content_blocks: { text?: string }[] }, index: number) =>
      choice.id === initial.choices[index]?.id && choice.content_blocks[0]?.text === `合成選択肢${index + 1}`), 'shared choice IDs and inputs are preserved').toBe(true)
    expect(input.choices.every((choice: { is_correct: boolean }, index: number) => choice.is_correct === (index === 3)), 'existing correct choice is preserved').toBe(true)
    await route.fulfill({ status: 422, json: { error: { code: 'validation_error', message: '合成の保存拒否', details: {} } } })
  })
  await page.goto('/admin/questions/900101/edit')
  await expect(page.locator('.choice-editor')).toHaveCount(4)
  await page.getByLabel('問番号', { exact: true }).fill('8')
  await expect(page.locator('.choice-editor')).toHaveCount(4)
  await page.getByLabel('問番号', { exact: true }).fill('82')
  await expect(page.locator('.choice-editor')).toHaveCount(4)
  for (let index = 0; index < 4; index += 1) {
    expect(await page.locator('.choice-editor').nth(index).locator('textarea').first().inputValue() === `合成選択肢${index + 1}`, 'existing input survives coordinate editing').toBe(true)
  }
  await expect(page.locator('input[name="correct-choice"]:checked')).toHaveCount(1)
  await expect(page.locator('.choice-editor input[name="correct-choice"]').nth(3)).toBeChecked()
  await page.getByRole('button', { name: '編集内容を保存', exact: true }).click()
  await expect(page.getByText('合成の保存拒否', { exact: true }).first()).toBeVisible()
  expect(saves).toBe(1)
  await assertFitsViewport(page)
})
