import assert from 'node:assert/strict'
import test from 'node:test'
import { studyCategoryCatalogSchema, studyCategoryTree, studyCategoryFilterSchema } from '../shared/schemas/study-categories.ts'

const row = (code: string, parent_code: string | null, number: number, scheme = 'study_outline') => ({ code, scheme, parent_code, number, sort_order: number, label: 'Synthetic category' })
const fixture = () => ({ schema_version: 1, categories: [row('p1', null, 1), row('s1', 'p1', 1), row('p2', null, 2), row('scope', null, 1, 'exam_scope')] })

test('catalog preserves ordered roots, empty parts, two schemes and separate source locators', () => {
  const input = fixture()
  const parsed = studyCategoryCatalogSchema.parse(input)
  const tree = studyCategoryTree([...parsed.categories].reverse())
  assert.deepEqual(tree.study_outline.map(part => [part.code, part.children.length]), [['p1', 1], ['p2', 0]])
  assert.equal(tree.exam_scope.length, 1)
  assert.equal(parsed.categories[0]!.source_page, null)
  assert.equal(parsed.categories[0]!.reference_page, null)
})

test('catalog rejects missing, cross-scheme, self, cyclic and third-level parents and duplicate positions', () => {
  for (const mutate of [
    (x: ReturnType<typeof fixture>) => { x.categories[1]!.parent_code = 'missing' },
    (x: ReturnType<typeof fixture>) => { x.categories[1]!.parent_code = 'scope' },
    (x: ReturnType<typeof fixture>) => { x.categories[0]!.parent_code = 'p1' },
    (x: ReturnType<typeof fixture>) => { x.categories[0]!.parent_code = 's1' },
    (x: ReturnType<typeof fixture>) => { x.categories.push(row('third', 's1', 1)) },
    (x: ReturnType<typeof fixture>) => { x.categories.push(row('another', 'p1', 1)) },
    (x: ReturnType<typeof fixture>) => { x.categories.push(row('another_root', null, 1)) },
    (x: ReturnType<typeof fixture>) => { x.categories.push(row('p1', null, 3)) },
    (x: ReturnType<typeof fixture>) => { x.categories[3]!.parent_code = 'p1' },
  ]) {
    const input = fixture(); mutate(input)
    assert.equal(studyCategoryCatalogSchema.safeParse(input).success, false)
  }
})

test('filters require a parent for sections and reject malformed or empty genre selections', () => {
  assert.equal(studyCategoryFilterSchema.safeParse({}).success, true)
  assert.equal(studyCategoryFilterSchema.safeParse({ study_category_codes: ['p1', 's1'] }).success, true)
  assert.equal(studyCategoryFilterSchema.safeParse({ study_category_codes: [] }).success, false)
  assert.equal(studyCategoryFilterSchema.safeParse({ study_section_code: 's1' }).success, false)
  assert.equal(studyCategoryFilterSchema.safeParse({ study_part_code: ['p1'] }).success, false)
  assert.equal(studyCategoryFilterSchema.safeParse({ study_scope_codes: [] }).success, false)
  assert.equal(studyCategoryFilterSchema.safeParse({ study_part_code: 'p1', study_section_code: 's1', study_scope_codes: ['scope'] }).success, true)
})
