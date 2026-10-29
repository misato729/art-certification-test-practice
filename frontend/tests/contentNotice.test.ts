import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = (path: string) => readFileSync(new URL(`../app/${path}`, import.meta.url), 'utf8')

test('regular learning screens do not show AI error notices', () => {
  for (const path of ['pages/index.vue', 'pages/practice/[examNumber]/[questionNumber].vue', 'components/SiteFooter.vue']) {
    assert.doesNotMatch(source(path), /生成AIで作成した問題には誤り|ai-note/, path)
  }
})

test('removing the notice keeps explanations, source links and next-question navigation', () => {
  const practice = source('pages/practice/[examNumber]/[questionNumber].vue')
  assert.match(practice, /<h2>解答解説<\/h2>/)
  assert.match(practice, /<h2>根拠資料<\/h2>/)
  assert.match(practice, /:href="source.url"/)
  assert.match(practice, /@click="goToNextQuestion"/)
  assert.match(source('pages/index.vue'), /各問題の解説と、出題の根拠となる資料を確認できます。/)
})

test('the footer keeps policy links and API connection status', () => {
  const footer = source('components/SiteFooter.vue')
  for (const path of ['/privacy-policy', '/terms', '/commercial-disclosure']) {
    assert.ok(footer.includes(`to="${path}"`), path)
  }
  assert.match(footer, /role="status"/)
})
