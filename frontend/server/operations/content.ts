import { createHash } from 'node:crypto'
import { lstat, readFile, mkdtemp, writeFile, link, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { query, transaction, type Database } from '../core/db.ts'
import { environment, configuration } from '../core/config.ts'
import { ContentValidationError, contentDocumentSchema, parseQuestionArchiveEntries, type QuestionInput } from '../../shared/schemas/content.ts'
import { saveQuestion, validateCompleteExam } from '../services/learning-writer.ts'

export class OperationError extends Error {}
export const ARCHIVE_FORMAT = 'exam-practice-question-archive'
export const IMPORT_CONFIRMATION = 'IMPORT_INTO_EMPTY_DATABASE'
export const MAX_CONTENT_BYTES = 64 * 1024 * 1024
export const QUESTION_LOCK = 71514345
export const defaultContentPath = fileURLToPath(new URL('../../../content/questions.json', import.meta.url))
export function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])]))
  return value
}
export const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
const object = (value: unknown): value is Record<string, any> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const exactKeys = (value: unknown, keys: string[]): value is Record<string, any> => object(value) && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0')

export function validateQuestions(value: unknown): QuestionInput[] {
  try { return parseQuestionArchiveEntries(value, configuration) }
  catch (error) {
    if (error instanceof ContentValidationError) throw new OperationError(error.message)
    throw error
  }
}

export type ArchiveDocument = {
  format: string, version: number, question_count: number, choice_count: number,
  sha256: string, questions: QuestionInput[]
}
export function createArchive(questions: unknown): ArchiveDocument {
  const validated = validateQuestions(questions)
  const body = { format: ARCHIVE_FORMAT, version: 1, question_count: validated.length,
    choice_count: validated.reduce((count, question) => count + question.choices.length, 0), questions: validated }
  return { ...body, sha256: digest(body) }
}
export function validateArchive(value: unknown): ArchiveDocument {
  if (!exactKeys(value, ['format', 'version', 'question_count', 'choice_count', 'sha256', 'questions']) || value.format !== ARCHIVE_FORMAT || value.version !== 1) throw new OperationError('未対応のアーカイブ形式です')
  const archive = createArchive(value.questions)
  if (!Number.isSafeInteger(value.question_count) || !Number.isSafeInteger(value.choice_count) || value.question_count !== archive.question_count || value.choice_count !== archive.choice_count || typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.sha256) || value.sha256 !== archive.sha256) throw new OperationError('アーカイブの件数又は照合値が一致しません')
  return archive
}
const summary = (archive: ArchiveDocument) => ({ format: archive.format, version: archive.version, question_count: archive.question_count, choice_count: archive.choice_count, sha256: archive.sha256 })

async function readJson(path: string): Promise<unknown> {
  try {
    if (!path || path.includes('\0') || !(await lstat(path)).isFile()) throw new OperationError('取込元には通常のJSONファイルを指定してください')
    if ((await lstat(path)).size > MAX_CONTENT_BYTES) throw new OperationError('問題データのサイズ上限を超えています')
    const bytes = await readFile(path)
    if (bytes.length > MAX_CONTENT_BYTES) throw new OperationError('問題データのサイズ上限を超えています')
    return JSON.parse(bytes.toString('utf8'))
  } catch (error) {
    if (error instanceof OperationError) throw error
    throw new OperationError('問題データを読み取れません。配置とJSON形式を確認してください')
  }
}

export async function importArchive(document: unknown, confirmation: string | undefined, db?: Database) {
  if (confirmation !== IMPORT_CONFIRMATION) throw new OperationError('空のDBへ取り込む明示的な確認が必要です')
  const archive = validateArchive(document)
  return transaction(async connection => {
    await query('SELECT pg_advisory_xact_lock($1)::text', [QUESTION_LOCK], connection)
    await query('LOCK TABLE questions, question_choices IN SHARE ROW EXCLUSIVE MODE', [], connection)
    const total = await connection.question.count() + await connection.questionChoice.count()
    if (total !== 0) throw new OperationError('問題と選択肢が両方空のDBだけに取り込めます。既存データは上書きしません')
    for (const question of archive.questions) await saveQuestion(question, { db: connection, requireCompleteExam: false })
    const publishedSets = new Set(archive.questions.filter(question => question.publication_status === 'published').map(question => question.exam_number))
    for (const exam of publishedSets) await validateCompleteExam(exam, connection)
    return summary(archive)
  }, db)
}
export async function importContent(path = defaultContentPath, confirmation?: string, db?: Database) {
  const result = contentDocumentSchema.safeParse(await readJson(path))
  if (!result.success) throw new OperationError('問題データはschema_version: 1と空でないquestions配列で指定してください')
  return importArchive(createArchive(result.data.questions), confirmation, db)
}
export async function importArchiveFile(path: string, confirmation?: string, db?: Database) {
  return importArchive(await readJson(path), confirmation, db)
}
export async function seedContent(options: { path?: string, db?: Database, mode?: string } = {}) {
  if ((options.mode ?? environment()) !== 'development') return { status: 'skipped' as const }
  return transaction(async connection => {
    await query('SELECT pg_advisory_xact_lock($1)::text', [QUESTION_LOCK], connection)
    await query('LOCK TABLE questions, question_choices IN SHARE ROW EXCLUSIVE MODE', [], connection)
    const total = await connection.question.count() + await connection.questionChoice.count()
    if (total !== 0) return { status: 'skipped' as const }
    const report = await importContent(options.path, IMPORT_CONFIRMATION, connection)
    return { status: 'imported' as const, ...report }
  }, options.db)
}

export async function exportArchive(path: string, db?: Database) {
  if (!path || path.includes('\0')) throw new OperationError('出力先のパスを明示してください')
  const archive = await transaction(async connection => {
    if (!db) await query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY', [], connection)
    const questions = await connection.question.findMany({
      orderBy: [{ exam_number: 'asc' }, { question_number: 'asc' }],
      select: { id: true, exam_number: true, question_number: true, major_category_code: true, category_code: true,
        content_blocks: true, explanation_blocks: true, source_text: true, publication_status: true },
    })
    const choices = await connection.questionChoice.findMany({ orderBy: { display_order: 'asc' },
      select: { question_id: true, choice_label: true, content_blocks: true, is_correct: true, display_order: true } })
    const rows = questions.map(({ id, ...question }) => ({ ...question,
      choices: choices.filter(choice => choice.question_id === id).map(({ question_id, ...choice }) => choice),
    }))
    return createArchive(rows)
  }, db)
  const encoded = JSON.stringify(archive, null, 2) + '\n'
  if (Buffer.byteLength(encoded) > MAX_CONTENT_BYTES) throw new OperationError('アーカイブのサイズ上限を超えています')
  let temporary: string | undefined
  try {
    const destination = resolve(path)
    temporary = await mkdtemp(join(dirname(destination), '.exam-questions-'))
    const file = join(temporary, 'archive.json')
    await writeFile(file, encoded, { mode: 0o600, flag: 'wx' })
    await link(file, destination)
  } catch {
    throw new OperationError('書き出せません。出力先が未使用であることと権限を確認してください')
  } finally { if (temporary) await rm(temporary, { recursive: true, force: true }) }
  return summary(archive)
}
