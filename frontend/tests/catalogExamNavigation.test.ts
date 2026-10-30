import assert from 'node:assert/strict'
import test from 'node:test'
import { catalogExamLabel, catalogExamStartNumber, catalogGroupLabel, catalogGroupLinks, isCatalogGroupActive, type ExamCatalogEntry } from '../app/utils/examCatalog.ts'

const mockExam = (): ExamCatalogEntry => {
  let start = 1
  const groups = [8, 7, 8, 7].map((count, index) => {
    const question_numbers = Array.from({ length: count }, (_, offset) => start + offset)
    start += count
    return { id: index + 10, group_number: index + 1, title: `合成テーマ${index + 1}`, question_numbers }
  })
  return { exam_number: 1, title: '大問のテーマを親名に使わない', question_numbers: groups.flatMap(group => group.question_numbers), groups }
}

test('mock exam and group labels keep their distinct hierarchy', () => {
  assert.equal(catalogExamLabel(1), '模擬試験1')
  assert.equal(catalogExamLabel(2), '模擬試験2')
  assert.equal(catalogGroupLabel({ group_number: 1, title: ' 知識と情報の記録・伝達 ' }), '大問1 知識と情報の記録・伝達')
  assert.equal(catalogGroupLabel({ group_number: 2, title: '  ' }), '大問2')
})

test('an eight-question partial exam shows only its one real group', () => {
  const full = mockExam()
  const first = full.groups![0]!
  const partial = { ...full, question_numbers: first.question_numbers, groups: [first] }
  const links = catalogGroupLinks(partial)
  assert.equal(links.length, 1)
  assert.equal(links[0]!.group.group_number, 1)
  assert.equal(links[0]!.to, '/practice/1/1')
  assert.equal(catalogExamStartNumber(partial), 1)
})

test('a synthetic thirty-question exam has four group links, each starting at its first child', () => {
  const exam = mockExam()
  const links = catalogGroupLinks(exam)
  assert.equal(exam.question_numbers.length, 30)
  assert.equal(links.length, 4)
  assert.deepEqual(links.map(link => link.questionNumber), [1, 9, 16, 24])
  assert.deepEqual(links.map(link => link.to), ['/practice/1/1', '/practice/1/9', '/practice/1/16', '/practice/1/24'])
})

test('empty or nonpublic groups do not create links and child display order is preserved', () => {
  const exam: ExamCatalogEntry = {
    exam_number: 2, question_numbers: [7, 3], groups: [
      { id: 2, group_number: 2, title: '非公開小問だけの群', question_numbers: [99] },
      { id: 3, group_number: 3, title: '空の群', question_numbers: [] },
      { id: 1, group_number: 1, title: '公開群', question_numbers: [99, 7, 3] },
    ],
  }
  const before = JSON.parse(JSON.stringify(exam))
  assert.deepEqual(catalogGroupLinks(exam).map(link => link.questionNumber), [7])
  assert.equal(catalogExamStartNumber(exam), 7)
  assert.deepEqual(exam, before)
  assert.deepEqual(catalogGroupLinks({ exam_number: 1, question_numbers: [] }), [])
  assert.equal(catalogExamStartNumber({ exam_number: 1, question_numbers: [] }), undefined)
  assert.deepEqual(catalogGroupLinks({ exam_number: 1, question_numbers: [1, 2] }), [])
})

test('the active group covers all its public children, not only the starting child', () => {
  const exam = mockExam()
  const first = exam.groups![0]!
  assert.equal(isCatalogGroupActive(exam, first, 1, 1), true)
  assert.equal(isCatalogGroupActive(exam, first, 1, 8), true)
  assert.equal(isCatalogGroupActive(exam, first, 1, 9), false)
  assert.equal(isCatalogGroupActive(exam, first, 2, 8), false)
  assert.equal(isCatalogGroupActive({ ...exam, question_numbers: [1] }, first, 1, 8), false)
})
