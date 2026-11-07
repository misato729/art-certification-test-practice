import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = (path: string) => readFileSync(new URL(`../app/${path}`, import.meta.url), 'utf8')
const home = source('pages/index.vue')
const start = source('pages/practice/start.vue')
const page = source('pages/practice/[examNumber]/[questionNumber].vue')
const materials = source('components/PracticeMaterials.vue')
const sidebar = source('components/ExamSidebar.vue')

test('all normal-random entry points use the same versioned material-aware shuffle', () => {
  for (const text of [home, start, page]) {
    assert.match(text, /shuffleArtPracticeSequence\(/)
    assert.match(text, /MATERIAL_RANDOM_UNIT/)
  }
  assert.match(home, /query.random_unit = MATERIAL_RANDOM_UNIT/)
  assert.match(page, /query.random_unit = MATERIAL_RANDOM_UNIT/)
  assert.match(page, /: shufflePracticeSequence\(basePracticeSequence.value, practiceSeed.value!\)/)
})
test('ordinary and application questions both keep all returned passage blocks', () => {
  assert.equal(page.match(/<PracticeMaterials\b/g)?.length, 2)
  assert.match(page, /v-if="applicationQuestion && question.shared_passages\?\.length"/)
  assert.match(page, /v-if="!applicationQuestion && question.shared_passages\?\.length"/)
  assert.equal(page.match(/:passages="question.shared_passages"/g)?.length, 2)
  assert.equal(page.match(/:references="question.passage_references"/g)?.length, 2)
  assert.match(materials, /:blocks="passage.content_blocks"/)
})
test('passage anchors use namespaced IDs, keyboard focus and reopen before jumping', () => {
  assert.match(materials, /:anchor-prefix="prefix\(passage.id\)"/)
  assert.match(materials, /await nextTick\(\)/)
  assert.match(materials, /target.focus\(\{ preventScroll: true \}\)/)
  assert.match(materials, /target.scrollIntoView/)
  assert.match(materials, /root.value.contains\(target\)/)
  assert.match(materials, /prefers-reduced-motion/)
})
test('section entry validates publication and preserves a resolved subset', () => {
  assert.match(start, /sectionQuestionNumbers\(EXAM_CONFIG,/)
  assert.match(start, /query.questions = numbers.join\(','\)/)
  assert.match(start, /if \(!numbers.length\)/)
  assert.match(start, /exam.access !== 'paid_membership_required'/)
})
test('sidebar uses configured sections without listing all authoring groups', () => {
  assert.match(sidebar, /artSectionLinks\(exam, EXAM_CONFIG\)/)
  assert.match(sidebar, /v-for="entry in exam.sectionLinks"/)
  assert.doesNotMatch(sidebar, /v-for="entry in exam.groupLinks"/)
  assert.match(sidebar, /isArtSectionActive\(section,/)
})
test('header distinguishes included application questions from excluded practical problems', () => {
  assert.match(home, /別枠の実践問題は含みません/)
  assert.doesNotMatch(home, /大問の順に演習/)
  assert.doesNotMatch(home, /exam.groups.length\}大問/)
  assert.match(page, /currentSection.title/)
})
