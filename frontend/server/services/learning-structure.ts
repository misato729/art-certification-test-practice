import { isDeepStrictEqual } from 'node:util'
import { getExamSet, questionCountForExam, type ExamConfiguration } from '../../shared/schemas/exam.ts'
import { ContentValidationError, isRecord, parseBlocks, type Block } from '../../shared/schemas/content.ts'
import { parseExamSetInput, parseQuestionGroupInput, collectPassageAnchorIds } from '../../shared/schemas/structure.ts'
import { configuration } from '../core/config.ts'
import { getDatabase, isUniqueViolation, json, query, record, transaction, type Database } from '../core/db.ts'
import { fail } from '../core/errors.ts'
import { validateQuestionInput, excerptFrom } from './learning-validation.ts'

export const LEARNING_WRITE_LOCK = 71514345
export type PassageReference = { passage_id: number; anchor_id: string | null }
export type GroupPassage = { id: number; group_id: number; label: string; display_order: number; content_blocks: Block[] }
export type QuestionGroupRecord = { id: number; exam_number: number; group_number: number; title: string; planned_question_count: number;
  publication_status: string; lock_version: number; passages: GroupPassage[]; questions: any[]; question_numbers: number[]; affected_history_count: number }
type Options = { db?: Database; config?: ExamConfiguration }
const invalid = (message: string, details?: Record<string, string[]>): never => fail(422, 'validation_error', message, details)
const notFound = (): never => fail(404, 'not_found', '対象が見つかりません')
function parse<T>(action: () => T): T {
  try { return action() } catch (error) {
    if (error instanceof ContentValidationError) return invalid(error.message, error.details)
    throw error
  }
}
function checkVersion(actual: number, expected: unknown) {
  if (expected !== actual) fail(409, 'content_conflict', '別の変更が保存されています。再読込してください')
}
let savepointCounter = 0
export async function runLearningWrite<T>(action: (db: Database) => Promise<T>, db?: Database, translateUnique = true): Promise<T> {
  const savepoint = db ? `group_write_${++savepointCounter}` : null
  try {
    return await transaction(async connection => {
      if (savepoint) await query(`SAVEPOINT ${savepoint}`, [], connection)
      try {
        await query('SELECT pg_advisory_xact_lock($1)::text', [LEARNING_WRITE_LOCK], connection)
        const result = await action(connection)
        if (savepoint) await query(`RELEASE SAVEPOINT ${savepoint}`, [], connection)
        return result
      } catch (error) {
        if (savepoint) { await query(`ROLLBACK TO SAVEPOINT ${savepoint}`, [], connection); await query(`RELEASE SAVEPOINT ${savepoint}`, [], connection) }
        throw error
      }
    }, db)
  } catch (error) { if (translateUnique && isUniqueViolation(error)) return invalid('大問番号・本文ラベル・小問番号の重複を確認してください'); throw error }
}

export async function ensureExamSet(examNumber: number, db: Database, published = false, config = configuration) {
  const definition = getExamSet(config, examNumber)
  if (!definition) return invalid('設定済みの模擬試験を指定してください')
  return record(await db.examSet.upsert({ where: { exam_number: examNumber }, update: {},
    create: { exam_number: examNumber, title: definition.title, publication_status: published ? 'published' : 'draft' } }))
}
export async function loadQuestionGroup(id: number, db: Database = getDatabase()): Promise<QuestionGroupRecord> {
  const row = await db.questionGroup.findUnique({ where: { id }, include: {
    passages: { orderBy: [{ display_order: 'asc' }, { id: 'asc' }] },
    questions: { orderBy: [{ group_question_number: 'asc' }, { question_number: 'asc' }], include: {
      choices: { orderBy: { display_order: 'asc' } }, passage_references: { orderBy: { display_order: 'asc' } }, _count: { select: { histories: true } },
    } },
  } })
  if (!row) return notFound()
  const result = record(row)
  return { ...result, passages: result.passages as unknown as GroupPassage[],
    questions: result.questions.map(question => ({ ...question, summary: excerptFrom(question.content_blocks as unknown as Block[]), passage_references: question.passage_references.map(ref => ({ passage_id: ref.passage_id, anchor_id: ref.anchor_id })) })),
    question_numbers: result.questions.map(question => question.question_number),
    affected_history_count: result.questions.reduce((sum, question) => sum + question._count.histories, 0) }
}
export async function loadExamSet(examNumber: number, db: Database = getDatabase(), config = configuration) {
  const row = await db.examSet.findUnique({ where: { exam_number: examNumber } })
  const groups = await db.questionGroup.findMany({ where: { exam_number: examNumber }, orderBy: [{ group_number: 'asc' }, { id: 'asc' }], select: { id: true } })
  const definition = getExamSet(config, examNumber)
  if (!definition) return notFound()
  return { ...(row ? record(row) : { exam_number: examNumber, title: definition.title, publication_status: 'draft', lock_version: 0 }),
    groups: await Promise.all(groups.map(group => loadQuestionGroup(Number(group.id), db))) }
}
export async function listExamSets(db: Database = getDatabase(), config = configuration) {
  return Promise.all(Array.from({ length: config.exam.set_count }, (_, index) => loadExamSet(index + 1, db, config)))
}
export async function assertQuestionReferences(groupId: number | null, examNumber: number, refs: PassageReference[], db: Database, published = false) {
  if (groupId === null) { if (refs.length) invalid('大問未所属の小問は共通本文を参照できません'); return }
  const group = await db.questionGroup.findFirst({ where: { id: groupId, exam_number: examNumber }, include: { passages: true } })
  if (!group) return invalid('大問と模擬試験の所属が一致しません')
  for (const ref of refs) {
    const passage = group.passages.find(item => Number(item.id) === ref.passage_id)
    if (!passage) return invalid('共通本文と大問の所属が一致しません')
    const blocks = parse(() => parseBlocks(passage.content_blocks, 'question', published))
    if (ref.anchor_id !== null && !collectPassageAnchorIds(blocks).has(ref.anchor_id)) return invalid('共通本文の参照先が見つかりません')
  }
}
export async function validateGroup(id: number, db: Database = getDatabase(), config = configuration, publishedOnly = false) {
  const group = await loadQuestionGroup(id, db)
  const errors: string[] = []
  if (!group.title.trim()) errors.push('大問タイトルを入力してください')
  const questions = group.questions.filter(question => publishedOnly ? question.publication_status === 'published' : question.publication_status !== 'private')
  if (questions.length !== group.planned_question_count) errors.push(`予定した${group.planned_question_count}小問をそろえてください`)
  for (const [index, question] of questions.entries()) {
    if (question.group_question_number !== index + 1) errors.push('大問内の小問番号は1から連続させてください')
    try { validateQuestionInput({ ...question, publication_status: 'published' }, config); await assertQuestionReferences(group.id, group.exam_number, question.passage_references, db, true) } catch { errors.push('小問の共通本文参照を確認してください') }
  }
  for (const passage of group.passages) {
    try { parseBlocks(passage.content_blocks, 'question', true) } catch { errors.push('共通本文を完成させてください') }
  }
  return { valid: errors.length === 0, errors }
}
export async function validateExamSet(examNumber: number, db: Database = getDatabase(), config = configuration, options: { publishedOnly?: boolean } = {}) {
  const count = questionCountForExam(config, examNumber)
  if (!count) return invalid('設定済みの模擬試験を指定してください')
  const set = await loadExamSet(examNumber, db, config)
  const questions = await db.question.findMany({ where: { exam_number: examNumber,
    publication_status: options.publishedOnly ? 'published' : { not: 'private' } }, select: { id: true, question_number: true, group_id: true } })
  const errors: string[] = []
  if (questions.length !== count || Array.from({ length: count }, (_, index) => index + 1).some(number => !questions.some(question => question.question_number === number))) errors.push(`問1〜${count}をそろえてください`)
  const groups = set.groups.filter(group => options.publishedOnly ? group.publication_status === 'published' : group.publication_status !== 'private')
  if (groups.length && questions.some(question => question.group_id === null || !groups.some(group => group.id === Number(question.group_id)))) errors.push('公開する小問を公開対象の大問へ所属させてください')
  for (const group of groups) {
    const report = await validateGroup(group.id, db, config, options.publishedOnly)
    errors.push(...report.errors.map(error => `大問${group.group_number}: ${error}`))
  }
  return { valid: errors.length === 0, errors }
}
export async function saveExamSet(raw: unknown, options: Options = {}) {
  const config = options.config ?? configuration
  if (!isRecord(raw) || !Number.isSafeInteger(raw.exam_number) || !getExamSet(config, Number(raw.exam_number))) return invalid('設定済みの模擬試験を指定してください')
  const input = { ...parse(() => parseExamSetInput(raw, config)), exam_number: Number(raw.exam_number) }
  return runLearningWrite(async db => {
    const before = await db.examSet.findUnique({ where: { exam_number: input.exam_number } })
    if (before) checkVersion(before.lock_version, input.lock_version)
    if (input.publication_status === 'published') { const report = await validateExamSet(input.exam_number, db, config, { publishedOnly: true }); if (!report.valid) invalid('公開条件を確認してください', { base: report.errors }) }
    await db.examSet.upsert({ where: { exam_number: input.exam_number },
      create: { exam_number: input.exam_number, title: input.title, publication_status: input.publication_status },
      update: { title: input.title, publication_status: input.publication_status, lock_version: { increment: 1 }, updated_at: new Date() } })
    return loadExamSet(input.exam_number, db, config)
  }, options.db)
}
export async function createQuestionGroup(examNumber: number, raw: unknown, options: Options = {}) {
  const config = options.config ?? configuration
  const input = parse(() => parseQuestionGroupInput(isRecord(raw) ? { publication_status: 'draft', ...raw } : raw, config))
  return runLearningWrite(async db => {
    await ensureExamSet(examNumber, db, false, config)
    const group = record(await db.questionGroup.create({ data: { exam_number: examNumber, group_number: input.group_number,
      title: input.title, planned_question_count: input.planned_question_count, publication_status: 'draft' } }))
    if (input.passages?.length) await saveQuestionGroup(group.id, { ...input, publication_status: 'draft', lock_version: group.lock_version }, { db, config })
    return loadQuestionGroup(group.id, db)
  }, options.db)
}
export async function saveQuestionGroup(id: number, raw: unknown, options: Options = {}) {
  const config = options.config ?? configuration
  return runLearningWrite(async db => {
    const before = await loadQuestionGroup(id, db)
    if (!isRecord(raw)) return invalid('大問の内容を指定してください')
    const input = parse(() => parseQuestionGroupInput({ group_number: before.group_number, title: before.title, planned_question_count: before.planned_question_count, publication_status: before.publication_status, ...raw }, config))
    checkVersion(before.lock_version, input.lock_version)
    const changedPassages: number[] = []
    if (input.passages !== undefined) {
      const ids: number[] = []
      // Keep every label/order unique during a swap, without replacing passage IDs.
      for (const [index, passage] of before.passages.entries()) await db.groupPassage.update({ where: { id: passage.id }, data: { label: `__editing_${passage.id}`, display_order: 1000000 + index } })
      for (const [index, passage] of input.passages.entries()) {
        const previous = passage.id === undefined ? undefined : before.passages.find(item => item.id === passage.id)
        if (passage.id !== undefined && (!previous || ids.includes(passage.id))) invalid('共通本文IDと大問が一致しません')
        const data = { label: passage.label, display_order: index + 1, content_blocks: json(passage.content_blocks), updated_at: new Date() }
        if (previous) {
          ids.push(previous.id)
          if (!isDeepStrictEqual(previous.content_blocks, passage.content_blocks) || previous.label !== passage.label) changedPassages.push(previous.id)
          await db.groupPassage.update({ where: { id: previous.id }, data })
        } else ids.push(Number((await db.groupPassage.create({ data: { ...data, group_id: id } })).id))
      }
      for (const passage of before.passages.filter(item => !ids.includes(item.id))) {
        if (await db.questionPassageReference.count({ where: { passage_id: passage.id } })) invalid('参照されている共通本文は削除できません。先に小問の参照を解除してください')
        await db.groupPassage.delete({ where: { id: passage.id } })
      }
    }
    if (input.question_ids !== undefined) {
      const existing = before.questions.map(question => Number(question.id))
      if (input.question_ids.length !== existing.length || new Set(input.question_ids).size !== existing.length || input.question_ids.some(question => !existing.includes(question))) invalid('並べ替えには現在所属する全小問を指定してください')
      for (const [index, question] of before.questions.entries()) await db.question.update({ where: { id: question.id }, data: { group_question_number: 1000000 + index } })
      for (const [index, question] of input.question_ids.entries()) await db.question.update({ where: { id: question }, data: { group_question_number: index + 1, lock_version: { increment: 1 } } })
    }
    const changedRefs = changedPassages.length ? await db.questionPassageReference.findMany({ where: { passage_id: { in: changedPassages } }, select: { question_id: true }, distinct: ['question_id'] }) : []
    if (changedRefs.length) await db.question.updateMany({ where: { id: { in: changedRefs.map(ref => ref.question_id) } }, data: { content_version: { increment: 1 }, lock_version: { increment: 1 }, updated_at: new Date() } })
    await db.questionGroup.update({ where: { id }, data: { group_number: input.group_number, title: input.title,
      planned_question_count: input.planned_question_count, publication_status: input.publication_status,
      lock_version: { increment: 1 }, updated_at: new Date() } })
    const after = await loadQuestionGroup(id, db)
    for (const question of after.questions) await assertQuestionReferences(id, after.exam_number, question.passage_references, db, after.publication_status === 'published' && question.publication_status === 'published')
    if (after.publication_status === 'published') { const report = await validateGroup(id, db, config, true); if (!report.valid) invalid('公開する大問の内容を確認してください', { base: report.errors }) }
    return after
  }, options.db)
}
export async function deleteQuestionGroup(id: number, options: Options = {}) {
  return runLearningWrite(async db => {
    const group = await loadQuestionGroup(id, db)
    if (group.questions.length || group.publication_status === 'published') await db.questionGroup.update({ where: { id }, data: { publication_status: 'private', lock_version: { increment: 1 }, updated_at: new Date() } })
    else { await db.groupPassage.deleteMany({ where: { group_id: id } }); await db.questionGroup.delete({ where: { id } }) }
  }, options.db)
}
export async function publishExamSet(examNumber: number, lockVersion: number, options: Options = {}) {
  const config = options.config ?? configuration
  return runLearningWrite(async db => {
    const before = await loadExamSet(examNumber, db, config)
    checkVersion(before.lock_version, lockVersion)
    const report = await validateExamSet(examNumber, db, config)
    if (!report.valid) invalid('公開条件を確認してください', { base: report.errors })
    await ensureExamSet(examNumber, db, false, config)
    await db.questionGroup.updateMany({ where: { exam_number: examNumber, publication_status: { not: 'private' } }, data: { publication_status: 'published', lock_version: { increment: 1 } } })
    await db.question.updateMany({ where: { exam_number: examNumber, publication_status: { not: 'private' } }, data: { publication_status: 'published', lock_version: { increment: 1 } } })
    await db.examSet.update({ where: { exam_number: examNumber }, data: { publication_status: 'published', lock_version: { increment: 1 }, updated_at: new Date() } })
    return loadExamSet(examNumber, db, config)
  }, options.db)
}
