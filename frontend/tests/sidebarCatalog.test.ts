import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { STATIC_EXAM_GROUPS } from '../app/utils/staticExamGroups.ts'
import { catalogGroupLinks, createSidebarExamCatalog, isCatalogGroupActive } from '../app/utils/examCatalog.ts'

test('static group navigation matches the bundled public groups and their exact child positions', () => {
  const content = JSON.parse(readFileSync(new URL('../../content/questions.json', import.meta.url), 'utf8'))
  assert.equal(STATIC_EXAM_GROUPS[1]!.length, content.groups.length)
  for (const group of content.groups) {
    const row = STATIC_EXAM_GROUPS[group.exam_number]!.find(item => item.group_number === group.group_number)!
    assert.equal(row.title, group.title)
    assert.deepEqual(row.question_numbers, content.questions.filter((q: any) => q.group_id === group.id).map((q: any) => q.question_number))
  }
  const staticRows = createSidebarExamCatalog(null, false, true)
  assert.deepEqual(staticRows[0]!.question_numbers, [])
  assert.equal(catalogGroupLinks(staticRows[0]!).length, 23)
})

test('live group links use only published sparse positions and active membership', () => {
  const group = { id: 1, group_number: 2, title: 'Synthetic', question_numbers: [7, 11, 13] }
  const exam = { exam_number: 1, question_numbers: [11, 13], groups: [group] }
  const rows = createSidebarExamCatalog([exam], true, true)
  assert.equal(rows[0]!.isStatic, false)
  assert.equal(catalogGroupLinks(rows[0]!)[0]!.to, '/practice/1/11')
  assert.equal(isCatalogGroupActive(exam, group, 1, 7), false)
  assert.equal(isCatalogGroupActive(exam, group, 1, 13), true)
  assert.equal(isCatalogGroupActive(exam, group, 2, 13), false)
  assert.deepEqual(createSidebarExamCatalog([], true, true), [])
})
