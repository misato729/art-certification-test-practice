import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = (path: string) => readFileSync(new URL(`../app/${path}`, import.meta.url), 'utf8')
const layout = source('layouts/default.vue')
const header = source('components/SiteHeader.vue')
const sidebar = source('components/ExamSidebar.vue')

test('one shared exam sidebar is rendered inside the sticky site header', () => {
  assert.equal(layout.match(/<ExamSidebar\s*\/>/g)?.length, 1)
  assert.match(layout, /<SiteHeader>\s*<ExamSidebar\s*\/>\s*<\/SiteHeader>/)
  assert.match(header, /<slot\s*\/>\s*<\/header>/)
  assert.match(header, /\.site-header\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;/)
})

test('mobile accordion starts closed and keeps a separate question accordion', () => {
  assert.match(sidebar, /const mobileOpen = ref\(false\)/)
  assert.match(sidebar, /:aria-expanded="mobileOpen"/)
  assert.match(sidebar, /aria-controls="exam-sidebar-content"/)
  assert.match(sidebar, /id="exam-sidebar-content"/)
  assert.match(sidebar, /:aria-expanded="openExam === exam.exam_number"/)
  assert.match(sidebar, /mobileOpen \? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'/)
  assert.match(sidebar, /\.mobile-open \.sidebar-content\s*\{ display: block; \}/)
})

test('navigation closes the mobile list without adding API calls', () => {
  assert.match(sidebar, /watch\(\(\) => route.fullPath, closeMobileList\)/)
  assert.equal(sidebar.match(/@click="closeMobileList"/g)?.length, 2)
  assert.match(sidebar, /@keydown.esc="closeMobileOnEscape"/)
  assert.match(sidebar, /mobileToggle.value\?\.focus\(\)/)
  assert.doesNotMatch(sidebar, /\b(?:useFetch|useApi|\$fetch)\s*\(/)
})

test('home anchor leaves room for both mobile header rows', () => {
  assert.match(layout, /--site-navigation-height: calc\(var\(--header-height\) \+ var\(--exam-toggle-height\)\)/)
  assert.match(source('pages/index.vue'), /scroll-margin-top: calc\(var\(--site-navigation-height, var\(--header-height\)\) \+ 20px\)/)
})

test('mobile exam grid shows two columns and reserves three compact rows', () => {
  const mobileStyles = sidebar.split('@media (max-width: 760px)')[1]
  assert.ok(mobileStyles)
  assert.match(sidebar, /v-else class="exam-groups"/)
  assert.match(mobileStyles, /\.exam-groups\s*\{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/)
  assert.match(mobileStyles, /--exam-row-height: 56px/)
  assert.match(mobileStyles, /var\(--exam-row-height\) \* 3 \+ var\(--exam-grid-gap\) \* 2 \+ 25px/)
  assert.doesNotMatch(mobileStyles, /\.exam-group.expanded\s*\{[^}]*grid-column/)
  assert.match(mobileStyles, /width: calc\(200% \+ var\(--exam-grid-gap\)\)/)
  assert.match(mobileStyles, /\.exam-group:nth-child\(even\) \.question-list\s*\{\s*margin-left: calc\(-100% - var\(--exam-grid-gap\)\)/)
  assert.match(mobileStyles, /overflow-y: auto/)
})
