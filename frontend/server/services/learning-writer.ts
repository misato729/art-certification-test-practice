import { createHash } from 'node:crypto'
import { choiceLabelsForQuestion, questionCountForExam, type ExamConfiguration } from '../../shared/schemas/exam.ts'
import { configuration } from '../core/config.ts'
import { json, query, record, transaction, type Database } from '../core/db.ts'
import { fail } from '../core/errors.ts'
import { validateQuestionInput, type ChoiceInput, type QuestionInput } from './learning-validation.ts'

export type { QuestionInput, ChoiceInput } from './learning-validation.ts'
export type ChoiceRecord = ChoiceInput & { id: number, question_id: number }
export type QuestionRecord = Omit<QuestionInput, 'choices'> & {
  id: number
  created_at: Date | string
  updated_at: Date | string
  choices: ChoiceRecord[]
}
export const QUESTION_WRITE_LOCK = 71514345
const notFound = (): never => fail(404, 'not_found', '対象が見つかりません')

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)]))
  return value
}

/** Publication status and record IDs do not change the meaning of an answer. */
export function materialDigest(question: QuestionInput | QuestionRecord): string {
  return createHash('sha256').update(JSON.stringify(canonical({
    exam_number: question.exam_number, question_number: question.question_number,
    major_category_code: question.major_category_code, category_code: question.category_code,
    content_blocks: question.content_blocks, explanation_blocks: question.explanation_blocks,
    source_text: question.source_text,
    choices: question.choices.map(choice => ({ choice_label: choice.choice_label,
      content_blocks: choice.content_blocks, is_correct: choice.is_correct, display_order: choice.display_order })),
  }))).digest('hex')
}

export async function loadQuestion(id: number, db: Database, options: { published?: boolean, lock?: boolean } = {}): Promise<QuestionRecord> {
  // Prisma does not expose PostgreSQL row locks; keep the lock inside the same transaction.
  if (options.lock) await query(`SELECT id FROM questions WHERE id = $1${options.published ? " AND publication_status = 'published'" : ''} FOR UPDATE`, [id], db)
  const row = await db.question.findFirst({ where: { id, ...(options.published ? { publication_status: 'published' } : {}) },
    include: { choices: { orderBy: { display_order: 'asc' } } } })
  if (!row) return notFound()
  return record(row) as unknown as QuestionRecord
}

export async function validateCompleteExam(examNumber: number, db: Database, config: ExamConfiguration = configuration, current?: { id?: number, question_number: number }): Promise<void> {
  const questionCount = questionCountForExam(config, examNumber)
  if (!questionCount) fail(422, 'validation_error', '有効な試験セットを指定してください', { exam_number: ['は設定済みの試験セットを指定してください'] })
  const existing = await db.question.findMany({ where: { exam_number: examNumber,
    ...(current?.id === undefined ? {} : { id: { not: current.id } }) }, select: { question_number: true } })
  const registered = new Set(existing.map(row => Number(row.question_number)))
  if (current) registered.add(current.question_number)
  const missing = Array.from({ length: questionCount }, (_, index) => index + 1).filter(number => !registered.has(number))
  if (missing.length) fail(422, 'validation_error', `模擬試験${examNumber}を公開するには問1〜${questionCount}の登録が必要です。不足：${missing.map(number => `問${number}`).join('、')}`, { base: ['公開する試験セットの問題数が不足しています'] })
}

type SaveOptions = { id?: number, db?: Database, requireCompleteExam?: boolean, config?: ExamConfiguration }

/** Shared writer for the admin API and explicit empty-database content import. */
export async function saveQuestion(raw: QuestionInput, options: SaveOptions = {}): Promise<QuestionRecord> {
  const config = options.config ?? configuration
  const input = validateQuestionInput(raw, config)
  const labels = choiceLabelsForQuestion(config, input.exam_number, input.question_number)
  try {
    return await transaction(async db => {
      await query('SELECT pg_advisory_xact_lock($1)::text', [QUESTION_WRITE_LOCK], db)
      const before = options.id === undefined ? undefined : await loadQuestion(options.id, db, { lock: true })
      // Moving between sections must never remove/recreate existing choices or their IDs.
      if (before && (before.exam_number !== input.exam_number || before.question_number !== input.question_number) &&
        JSON.stringify(before.choices.map(choice => choice.choice_label)) !== JSON.stringify(labels)) {
        fail(422, 'validation_error', '選択肢のラベルが異なる区分へ既存の問題は移動できません', {
          exam_number: ['選択肢のラベルが同じ区分を指定してください'],
          question_number: ['選択肢のラベルが同じ区分を指定してください'],
        })
      }
      for (const choice of input.choices) {
        if (choice.id !== undefined && !before?.choices.some(previous => previous.id === choice.id && previous.choice_label === choice.choice_label)) {
          fail(422, 'validation_error', '選択肢IDと問題・ラベルが一致しません')
        }
      }
      if (input.publication_status === 'published' && options.requireCompleteExam) {
        await validateCompleteExam(input.exam_number, db, config, { id: options.id, question_number: input.question_number })
      }
      const data = { exam_number: input.exam_number, question_number: input.question_number,
        major_category_code: input.major_category_code, category_code: input.category_code,
        content_blocks: json(input.content_blocks), explanation_blocks: json(input.explanation_blocks),
        source_text: input.source_text, publication_status: input.publication_status }
      let id: number
      if (before) {
        const changed = materialDigest(before) !== materialDigest(input)
        if (changed || before.publication_status !== input.publication_status) {
          await db.question.update({ where: { id: before.id }, data: { ...data, updated_at: new Date() } })
        }
        id = before.id
        if (changed) await db.answerHistory.deleteMany({ where: { question_id: id } })
      } else {
        const saved = record(await db.question.create({ data: { ...data, created_at: new Date(), updated_at: new Date() }, select: { id: true } }))
        id = saved.id
      }
      const choicePayload = (choices: ChoiceInput[]) => JSON.stringify(canonical(choices.map(choice => ({
        choice_label: choice.choice_label, content_blocks: choice.content_blocks,
        is_correct: choice.is_correct, display_order: choice.display_order,
      }))))
      if (!before || choicePayload(before.choices) !== choicePayload(input.choices)) {
        // Clear the partial unique index before changing which answer is correct.
        await db.questionChoice.updateMany({ where: { question_id: id }, data: { is_correct: false } })
        for (const choice of input.choices) {
          const data = { content_blocks: json(choice.content_blocks), is_correct: choice.is_correct,
            display_order: choice.display_order, updated_at: new Date() }
          await db.questionChoice.upsert({ where: { question_id_choice_label: { question_id: id, choice_label: choice.choice_label } },
            create: { ...data, question_id: id, choice_label: choice.choice_label, created_at: new Date() }, update: data })
        }
      }
      const saved = await loadQuestion(id, db)
      if (saved.choices.length !== labels.length || saved.choices.filter(choice => choice.is_correct).length !== 1 ||
        saved.choices.some((choice, index) => choice.choice_label !== labels[index] || choice.display_order !== index + 1)) {
        fail(422, 'validation_error', `選択肢は${labels.length}件、正答は1件必要です`)
      }
      return saved
    }, options.db)
  } catch (error) {
    if (['23505', 'P2002'].includes((error as { code?: string }).code ?? '')) fail(422, 'validation_error', '入力内容を確認してください', { question_number: ['は同じ試験セット内で既に使用されています'] })
    throw error
  }
}

export async function deleteQuestion(id: number, db?: Database): Promise<void> {
  await transaction(async connection => {
    await query('SELECT pg_advisory_xact_lock($1)::text', [QUESTION_WRITE_LOCK], connection)
    await loadQuestion(id, connection, { lock: true })
    // Histories reference choices without ON DELETE CASCADE, so remove them first.
    await connection.answerHistory.deleteMany({ where: { question_id: id } })
    await connection.question.delete({ where: { id } })
  }, db)
}
