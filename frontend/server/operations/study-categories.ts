import { lstat, readFile } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'
import { studyCategoryCatalogSchema } from '../../shared/schemas/study-categories.ts'
import { transaction, query, type Database } from '../core/db.ts'
import { OperationError } from './content.ts'

export const STUDY_CATEGORY_CONFIRMATION = 'IMPORT_STUDY_CATEGORIES'
export async function importStudyCategories(path: string | undefined, confirmation: string | undefined, db?: Database) {
  if (!path || confirmation !== STUDY_CATEGORY_CONFIRMATION) throw new OperationError('分野マスターの入力先と明示確認が必要です')
  let parsed
  try {
    const stat = await lstat(path)
    if (!stat.isFile() || stat.size > 2_000_000) throw new Error()
    parsed = studyCategoryCatalogSchema.parse(JSON.parse(await readFile(path, 'utf8')))
  } catch { throw new OperationError('分野マスターの形式を確認してください') }
  return transaction(async connection => {
    await query('SELECT pg_advisory_xact_lock($1)::text', [726041], connection)
    const existing = await connection.studyCategory.findMany()
    const wanted = parsed.categories
    const byCode = new Map(existing.map(row => [row.code, row]))
    const combined = [...existing, ...wanted.filter(row => !byCode.has(row.code))]
    if (!studyCategoryCatalogSchema.safeParse({ schema_version: 1, categories: combined }).success) throw new OperationError('保存済みの分野と競合しています')
    for (const row of wanted) {
      const previous = byCode.get(row.code)
      if (previous && !isDeepStrictEqual(previous, row)) throw new OperationError('保存済みの分野を自動で上書きできません')
    }
    const ordered = [...wanted.filter(row => row.parent_code === null), ...wanted.filter(row => row.parent_code !== null)]
    let created = 0
    for (const row of ordered) if (!byCode.has(row.code)) { await connection.studyCategory.create({ data: row }); created++ }
    return { status: created ? 'imported' : 'unchanged', category_count: wanted.length, created_count: created,
      root_count: wanted.filter(row => row.parent_code === null).length, child_count: wanted.filter(row => row.parent_code !== null).length }
  }, db)
}
