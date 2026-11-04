import { getDatabase, type Database } from '../core/db.ts'
import { fail } from '../core/errors.ts'
import { studyCategoryTree, studyCategoryFilterSchema, type StudyCategory } from '../../shared/schemas/study-categories.ts'

export async function listStudyCategories(db: Database = getDatabase()) {
  const rows = await db.studyCategory.findMany({ orderBy: [{ sort_order: 'asc' }, { code: 'asc' }] })
  return { data: studyCategoryTree(rows as StudyCategory[]) }
}

/** Master-only phase: no question associations exist. Never broaden a requested filter. */
export async function validateStudyFilter(params: Record<string, unknown>, db: Database = getDatabase()) {
  const keys = ['study_category_codes', 'study_part_code', 'study_section_code', 'study_scope_codes'] as const
  if (!keys.some(key => params[key] !== undefined)) return false
  const input = Object.fromEntries(keys.filter(key => params[key] !== undefined).map(key => [key, params[key]]))
  if (typeof input.study_category_codes === 'string') input.study_category_codes = input.study_category_codes.split(',')
  if (typeof input.study_scope_codes === 'string') input.study_scope_codes = input.study_scope_codes.split(',')
  const parsed = studyCategoryFilterSchema.safeParse(input)
  if (!parsed.success) fail(400, 'bad_request', '分野の条件を確認してください')
  const filter = parsed.data
  const codes = [filter.study_part_code, filter.study_section_code, ...(filter.study_scope_codes ?? []), ...(filter.study_category_codes ?? [])].filter((code): code is string => Boolean(code))
  const rows = await db.studyCategory.findMany({ where: { code: { in: codes } } })
  const part = rows.find(row => row.code === filter.study_part_code)
  const section = rows.find(row => row.code === filter.study_section_code)
  if ((filter.study_part_code && (!part || part.scheme !== 'study_outline' || part.parent_code !== null)) ||
      (filter.study_section_code && (!section || section.scheme !== 'study_outline' || section.parent_code !== part?.code)) ||
      (filter.study_category_codes?.some(code => !rows.some(row => row.code === code && row.scheme === 'study_outline'))) ||
      (filter.study_scope_codes?.some(code => !rows.some(row => row.code === code && row.scheme === 'exam_scope' && row.parent_code === null)))) {
    fail(400, 'bad_request', '分野の組み合わせを確認してください')
  }
  return true
}
