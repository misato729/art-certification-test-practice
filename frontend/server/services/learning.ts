import { hasPaidAccess, type User } from '../core/auth.ts'
import { configuration, freeExamMax, paymentsEnabled } from '../core/config.ts'
import { getDatabase, Prisma, query, record, transaction, type Database } from '../core/db.ts'
import { fail } from '../core/errors.ts'
import { excerptFrom, integer, sanitizeQuestionInput } from './learning-validation.ts'
import { deleteQuestion, loadQuestion, saveQuestion, type ChoiceRecord, type QuestionRecord } from './learning-writer.ts'

export { saveQuestion, deleteQuestion, validateCompleteExam } from './learning-writer.ts'
export { validateQuestionInput } from './learning-validation.ts'
export type { QuestionInput } from './learning-validation.ts'

const notFound = (): never => fail(404, 'not_found', '対象が見つかりません')
const iso = (value: Date | string) => new Date(value).toISOString()
const present = (value: unknown) => value !== undefined && value !== null && value !== ''
function requireUser(user: User | null): User {
  if (!user) return fail(401, 'unauthorized', 'ログインが必要です')
  return user
}
function checkAdmin(user: User | null): User {
  const current = requireUser(user)
  if (current.role !== 'admin') fail(403, 'forbidden', '管理者権限が必要です')
  return current
}
function integerParam(value: unknown, name: string, minimum = 1, maximum = Number.MAX_SAFE_INTEGER): number {
  const parsed = integer(value)
  if (parsed === undefined || parsed < minimum || parsed > maximum) return fail(400, 'bad_request', `${name}を正しく指定してください`)
  return parsed
}
function pagination(params: Record<string, unknown>) {
  return { page: integerParam(present(params.page) ? params.page : 1, 'page'),
    perPage: integerParam(present(params.per_page) ? params.per_page : 20, 'per_page', 1, 100) }
}
function meta(page: number, perPage: number, total: number, atLeastOne = false) {
  return { current_page: page, per_page: perPage, total_count: total,
    total_pages: Math.max(atLeastOne ? 1 : 0, Math.ceil(total / perPage)) }
}
const serializeChoice = (choice: ChoiceRecord) => ({ id: Number(choice.id), choice_label: choice.choice_label,
  content_blocks: choice.content_blocks, display_order: Number(choice.display_order) })

export async function authorizeExam(examNumber: number, user: User | null, db?: Database): Promise<void> {
  if (!paymentsEnabled || examNumber <= freeExamMax || await hasPaidAccess(user, db)) return
  if (user) fail(403, 'paid_membership_required', 'この模擬試験の利用にはプレミアム会員資格が必要です')
  fail(401, 'unauthorized', 'この模擬試験を利用するにはログインが必要です')
}

async function serializePublicQuestion(question: QuestionRecord, user: User | null, db: Database) {
  const payload: Record<string, unknown> = { id: question.id, exam_number: question.exam_number,
    question_number: question.question_number, content_blocks: question.content_blocks,
    major_category_code: question.major_category_code, category_code: question.category_code,
    choices: question.choices.map(serializeChoice) }
  if (user) {
    const allowed = await hasPaidAccess(user, db)
    const favorite = allowed ? await db.favorite.findUnique({ where: { user_id_question_id: { user_id: user.id, question_id: question.id } }, select: { id: true } }) : null
    payload.is_favorite = allowed && favorite !== null
  }
  return payload
}

export async function getQuestion(id: number, user: User | null, db: Database = getDatabase()) {
  const question = await loadQuestion(id, db, { published: true })
  await authorizeExam(question.exam_number, user, db)
  return { data: await serializePublicQuestion(question, user, db) }
}

export async function nextQuestion(params: Record<string, unknown>, user: User | null, db: Database = getDatabase()) {
  const where: Prisma.QuestionWhereInput = { publication_status: 'published' }
  let orderBy: Prisma.QuestionOrderByWithRelationInput[] = [{ exam_number: 'asc' }, { question_number: 'asc' }]
  if (present(params.exam_number)) {
    const exam = integerParam(params.exam_number, 'exam_number')
    await authorizeExam(exam, user, db)
    where.exam_number = exam
    if (present(params.after_question_number)) {
      where.question_number = { gt: integerParam(params.after_question_number, 'after_question_number', 0) }
    }
    orderBy = [{ question_number: 'asc' }]
  } else {
    if (present(params.after_question_number)) fail(400, 'bad_request', 'exam_numberを指定してください')
    if (!await hasPaidAccess(user, db)) {
      where.exam_number = { lte: freeExamMax }
    }
  }
  let question: { id: bigint } | null = null
  if (!present(params.exam_number) && present(params.exclude_question_id)) {
    const exclude = integerParam(params.exclude_question_id, 'exclude_question_id')
    question = await db.question.findFirst({ where: { ...where, id: { not: exclude } }, orderBy, select: { id: true } })
  }
  if (!question) question = await db.question.findFirst({ where, orderBy, select: { id: true } })
  if (!question) return notFound()
  return getQuestion(record(question).id, user, db)
}

export async function answerQuestion(id: number, selectedChoiceId: unknown, user: User | null, db?: Database) {
  return transaction(async connection => {
    // The same row lock is held by edits/deletes, so grade and history agree.
    const question = await loadQuestion(id, connection, { published: true, lock: true })
    await authorizeExam(question.exam_number, user, connection)
    const choiceId = integer(selectedChoiceId)
    const selected = question.choices.find(choice => choice.id === choiceId)
    if (!selected) fail(422, 'validation_error', '選択肢を確認してください', { selected_choice_id: ['この問題の選択肢を指定してください'] })
    const correct = question.choices.find(choice => choice.is_correct)
    if (!correct) return notFound()
    const isCorrect = selected.id === correct.id
    const history = user ? record(await connection.answerHistory.create({ data: {
      user_id: user.id, question_id: question.id, selected_choice_id: selected.id, is_correct: isCorrect,
      created_at: new Date(), updated_at: new Date() }, select: { id: true } })) : null
    return { data: { question_id: question.id, selected_choice_id: selected.id, is_correct: isCorrect,
      correct_choice: serializeChoice(correct), explanation_blocks: question.explanation_blocks,
      source_text: question.source_text, answer_history_id: history?.id ?? null } }
  }, db)
}

export async function listExams(user: User | null, db: Database = getDatabase()) {
  const published = await db.question.findMany({ where: { publication_status: 'published' },
    orderBy: [{ exam_number: 'asc' }, { question_number: 'asc' }], select: { exam_number: true, question_number: true } })
  const sets = new Map<number, number[]>()
  for (const question of published) {
    const numbers = sets.get(question.exam_number) ?? []
    numbers.push(question.question_number)
    sets.set(question.exam_number, numbers)
  }
  const fullAccess = await hasPaidAccess(user, db)
  return { data: [...sets].map(([exam_number, question_numbers]) => ({ exam_number, question_numbers,
    published_question_count: question_numbers.length,
    access: !paymentsEnabled || exam_number <= freeExamMax || fullAccess ? 'available' : 'paid_membership_required' })) }
}

type HistoryRow = { id: number, is_correct: boolean, answered_at: Date | string,
  question: Omit<QuestionRecord, 'choices'>, selected_choice: ChoiceRecord }
function serializeHistory(row: HistoryRow, fullAccess: boolean) {
  const question = row.question
  const base = { id: Number(row.id), question: { id: Number(question.id), exam_number: Number(question.exam_number), question_number: Number(question.question_number) }, answered_at: iso(row.answered_at) }
  if (question.exam_number > freeExamMax && !fullAccess) return { ...base, locked: true }
  return { ...base, locked: false, question: { ...base.question, body_excerpt: excerptFrom(question.content_blocks),
    major_category_code: question.major_category_code, category_code: question.category_code },
  selected_choice: { id: Number(row.selected_choice.id), choice_label: row.selected_choice.choice_label, body_excerpt: excerptFrom(row.selected_choice.content_blocks) }, is_correct: row.is_correct }
}

export async function listHistory(user: User | null, params: Record<string, unknown>, db: Database = getDatabase()) {
  const current = requireUser(user)
  const { page, perPage } = pagination(params)
  const where = { user_id: current.id }
  const count = await db.answerHistory.count({ where })
  const rows = record(await db.answerHistory.findMany({ where, include: { question: true, selected_choice: true },
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }], take: perPage, skip: (page - 1) * perPage }))
  const fullAccess = await hasPaidAccess(current, db)
  return { data: rows.map(row => serializeHistory({ ...row, answered_at: row.created_at } as unknown as HistoryRow, fullAccess)), meta: meta(page, perPage, count) }
}

export async function getHistory(id: number, user: User | null, db: Database = getDatabase()) {
  const current = requireUser(user)
  const found = await db.answerHistory.findFirst({ where: { user_id: current.id, id }, include: { question: true, selected_choice: true } })
  if (!found) return notFound()
  const row = { ...record(found), answered_at: found.created_at } as unknown as HistoryRow
  await authorizeExam(Number(row.question.exam_number), current, db)
  const correct = await db.questionChoice.findFirst({ where: { question_id: row.question.id, is_correct: true } })
  if (!correct) return notFound()
  return { data: { ...serializeHistory(row, await hasPaidAccess(current, db)), correct_choice: serializeChoice(record(correct) as unknown as ChoiceRecord),
    explanation_blocks: row.question.explanation_blocks, source_text: row.question.source_text } }
}

type FavoriteRow = { id: number, created_at: Date | string, question: Omit<QuestionRecord, 'choices'> }
function serializeFavorite(row: FavoriteRow, fullAccess: boolean) {
  const base = { id: Number(row.id), question: { id: Number(row.question.id), exam_number: Number(row.question.exam_number), question_number: Number(row.question.question_number) }, created_at: iso(row.created_at) }
  if (row.question.exam_number > freeExamMax && !fullAccess) return { ...base, locked: true }
  return { ...base, locked: false, question: { ...base.question, body_excerpt: excerptFrom(row.question.content_blocks), major_category_code: row.question.major_category_code, category_code: row.question.category_code } }
}
async function authorizeFavorites(user: User | null, db: Database): Promise<User> {
  const current = requireUser(user)
  if (!await hasPaidAccess(current, db)) fail(403, 'paid_membership_required', 'お気に入りの利用にはプレミアム会員資格が必要です')
  return current
}

export async function listFavorites(user: User | null, params: Record<string, unknown>, db: Database = getDatabase()) {
  const current = await authorizeFavorites(user, db)
  const { page, perPage } = pagination(params)
  const where = { user_id: current.id, question: { publication_status: 'published' } }
  const count = await db.favorite.count({ where })
  const rows = record(await db.favorite.findMany({ where, include: { question: true },
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }], take: perPage, skip: (page - 1) * perPage }))
  return { data: rows.map(row => serializeFavorite(row as unknown as FavoriteRow, true)), meta: meta(page, perPage, count) }
}

export async function putFavorite(questionId: number, user: User | null, db?: Database) {
  return transaction(async connection => {
    const current = await authorizeFavorites(user, connection)
    const question = await loadQuestion(questionId, connection, { published: true, lock: true })
    await authorizeExam(question.exam_number, current, connection)
    const inserted = await connection.favorite.createMany({ data: [{ user_id: current.id, question_id: questionId,
      created_at: new Date(), updated_at: new Date() }], skipDuplicates: true })
    const favorite = record(await connection.favorite.findUniqueOrThrow({ where: { user_id_question_id: { user_id: current.id, question_id: questionId } }, select: { id: true, created_at: true } }))
    return { created: inserted.count > 0, data: serializeFavorite({ ...favorite, question }, true) }
  }, db)
}

export async function removeFavorite(questionId: number, user: User | null, db?: Database): Promise<void> {
  await transaction(async connection => {
    const current = await authorizeFavorites(user, connection)
    await loadQuestion(questionId, connection, { published: true, lock: true })
    await connection.favorite.deleteMany({ where: { user_id: current.id, question_id: questionId } })
  }, db)
}

function serializeAdmin(question: QuestionRecord) {
  return { ...question, choices: question.choices.map(choice => ({ ...serializeChoice(choice), is_correct: choice.is_correct })),
    created_at: iso(question.created_at), updated_at: iso(question.updated_at) }
}

export async function listAdminQuestions(user: User | null, params: Record<string, unknown>, db: Database = getDatabase()) {
  checkAdmin(user)
  const where: Prisma.QuestionWhereInput = {}
  for (const key of ['exam_number', 'major_category_code', 'category_code', 'publication_status'] as const) {
    if (!present(params[key])) continue
    if (typeof params[key] !== 'string' && typeof params[key] !== 'number') fail(400, 'bad_request', `${key}を正しく指定してください`)
    if (key === 'exam_number' && integer(params[key]) === undefined) fail(400, 'bad_request', `${key}を正しく指定してください`)
    if (key === 'exam_number') where.exam_number = integer(params[key])!
    else where[key] = String(params[key])
  }
  if (present(params.keyword)) {
    if (typeof params.keyword !== 'string') fail(400, 'bad_request', 'keywordを正しく指定してください')
    // Prisma's JSON filters cannot search the serialized root array. Keep this
    // PostgreSQL-specific predicate parameterized, then paginate through Prisma.
    const matches = await query<{ id: number }>('SELECT id FROM questions WHERE content_blocks::text ILIKE $1',
      [`%${params.keyword.trim().replace(/[\\%_]/g, '\\$&')}%`], db)
    where.id = { in: matches.map(question => question.id) }
  }
  const total = await db.question.count({ where })
  const requestedPage = integer(params.page)
  const requestedPerPage = integer(params.per_page)
  const perPage = Math.min(requestedPerPage && requestedPerPage > 0 ? requestedPerPage : 20, 100)
  const page = Math.min(requestedPage && requestedPage > 0 ? requestedPage : 1, Math.max(1, Math.ceil(total / perPage)))
  const rows = record(await db.question.findMany({ where, orderBy: [{ exam_number: 'asc' }, { question_number: 'asc' }, { id: 'asc' }],
    take: perPage, skip: (page - 1) * perPage })) as unknown as Omit<QuestionRecord, 'choices'>[]
  return { data: rows.map(question => ({ id: Number(question.id), exam_number: Number(question.exam_number), question_number: Number(question.question_number),
    summary: question.content_blocks.filter(block => ['text', 'quote', 'fill_in_text', 'fill_in_quote'].includes(block.type)).map(block => block.text ?? '').join(' ').replace(/\s+/g, ' ').trim() || '表・プログラムを含む問題',
    major_category_code: question.major_category_code, category_code: question.category_code, publication_status: question.publication_status, updated_at: iso(question.updated_at) })),
  meta: meta(page, perPage, total, true) }
}

export async function getAdminQuestion(id: number, user: User | null) {
  checkAdmin(user)
  return { data: serializeAdmin(await loadQuestion(id, getDatabase())) }
}

export async function writeAdminQuestion(value: unknown, user: User | null, id?: number) {
  checkAdmin(user)
  const input = sanitizeQuestionInput(value)
  return { data: serializeAdmin(await saveQuestion(input, { id, requireCompleteExam: true })) }
}

export async function deleteAdminQuestion(id: number, user: User | null) {
  checkAdmin(user)
  await deleteQuestion(id)
}
