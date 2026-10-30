import { lstat, readFile } from 'node:fs/promises'
import { parseContentDocument } from '../../shared/schemas/structure.ts'
import { type Block } from '../../shared/schemas/content.ts'
import { configuration } from '../core/config.ts'
import { record, query, transaction, type Database } from '../core/db.ts'
import { loadQuestion, materialDigest, saveQuestionStructure } from '../services/learning-writer.ts'
import { createQuestionGroup, loadQuestionGroup, saveQuestionGroup, saveExamSet } from '../services/learning-structure.ts'
import { defaultContentPath, MAX_CONTENT_BYTES, OperationError, QUESTION_LOCK, digest } from './content.ts'

export const STRUCTURE_CONFIRMATION = 'APPLY_STRUCTURE_TO_MATCHING_QUESTIONS'
/** Attach structure only when the effective questions are byte-equivalent. Never a content sync. */
export async function applyContentStructure(path = defaultContentPath, confirmation?: string, db?: Database) {
  if (confirmation !== STRUCTURE_CONFIRMATION) throw new OperationError('一致する問題へ階層だけを適用する明示的な確認が必要です')
  let document
  try {
    const stat = await lstat(path)
    if (!stat.isFile() || stat.size > MAX_CONTENT_BYTES) throw new Error()
    document = parseContentDocument(JSON.parse(await readFile(path, 'utf8')), configuration)
    if (document.schema_version !== 2 || !document.groups.length) throw new Error()
  } catch { throw new OperationError('大問・共通本文を含む取込元の形式を確認してください') }
  const wanted = document
  const sourcePassages = new Map(wanted.groups.flatMap(group => group.passages.map(passage => [passage.id, passage] as const)))
  return transaction(async connection => {
    await query('SELECT pg_advisory_xact_lock($1)::text', [QUESTION_LOCK], connection)
    const all = record(await connection.question.findMany({ orderBy: [{ exam_number: 'asc' }, { question_number: 'asc' }], select: { id: true } }))
    if (all.length !== wanted.questions.length) throw new OperationError('問題の件数が一致しないため階層の適用を中止しました')
    const existing = []
    for (const row of all) existing.push(await loadQuestion(row.id, connection, { lock: true }))
    const sourceByPosition = new Map(wanted.questions.map(question => [`${question.exam_number}/${question.question_number}`, question]))
    const livePassages = record(await connection.groupPassage.findMany())
    const livePassageMap = new Map(livePassages.map(passage => [passage.id, passage]))
    for (const question of existing) {
      const expected = sourceByPosition.get(`${question.exam_number}/${question.question_number}`)
      if (!expected) throw new OperationError('問題の位置が一致しないため階層の適用を中止しました')
      const prefix = [...new Set(question.passage_references.map(reference => reference.passage_id))].flatMap(id => (livePassageMap.get(id)?.content_blocks ?? []) as Block[])
      const sourcePrefix = [...new Set((expected.passage_references ?? []).map(reference => reference.passage_id))].flatMap(id => sourcePassages.get(id)!.content_blocks)
      if (question.publication_status !== expected.publication_status ||
        materialDigest({ ...question, content_blocks: [...prefix, ...question.content_blocks] }) !== materialDigest({ ...expected, content_blocks: [...sourcePrefix, ...expected.content_blocks] })) {
        throw new OperationError('問題・選択肢・正答・解説が一致しないため階層の適用を中止しました')
      }
    }
    const liveGroups = record(await connection.questionGroup.findMany())
    if (liveGroups.length || livePassages.length || existing.some(question => question.group_id !== null)) {
      const sameGroups = liveGroups.length === wanted.groups.length && wanted.groups.every(group => {
        const current = liveGroups.find(item => item.exam_number === group.exam_number && item.group_number === group.group_number)
        if (!current || current.title !== group.title || current.planned_question_count !== group.planned_question_count || current.publication_status !== group.publication_status) return false
        const passages = livePassages.filter(passage => passage.group_id === current.id).sort((a, b) => a.display_order - b.display_order)
        return digest(passages.map(passage => ({ label: passage.label, display_order: passage.display_order, content_blocks: passage.content_blocks }))) ===
          digest(group.passages.map(({ label, display_order, content_blocks }) => ({ label, display_order, content_blocks })))
      })
      const sameChildren = existing.every(question => {
        const expected = sourceByPosition.get(`${question.exam_number}/${question.question_number}`)!
        const sourceGroup = wanted.groups.find(group => group.id === expected.group_id)
        const currentGroup = liveGroups.find(group => group.id === question.group_id)
        const refs = question.passage_references.map(reference => ({ label: livePassageMap.get(reference.passage_id)?.label, anchor_id: reference.anchor_id }))
        const sourceRefs = (expected.passage_references ?? []).map(reference => ({ label: sourcePassages.get(reference.passage_id)?.label, anchor_id: reference.anchor_id }))
        return sourceGroup?.group_number === currentGroup?.group_number && sourceGroup?.exam_number === currentGroup?.exam_number &&
          question.group_question_number === expected.group_question_number && digest(refs) === digest(sourceRefs) && digest(question.content_blocks) === digest(expected.content_blocks)
      })
      if (!sameGroups || !sameChildren) throw new OperationError('既存の階層は上書きしません。管理画面で変更してください')
      return { status: 'unchanged' as const, question_count: existing.length, group_count: liveGroups.length, passage_count: livePassages.length }
    }
    const parentsBefore = new Set((await connection.examSet.findMany({ select: { exam_number: true } })).map(exam => exam.exam_number))
    const groupIds = new Map<number, number>()
    const passageIds = new Map<number, number>()
    for (const group of wanted.groups) {
      const created = await createQuestionGroup(group.exam_number, { ...group, publication_status: 'draft', passages: group.passages.map(({ id, ...passage }) => passage) }, { db: connection })
      groupIds.set(group.id, created.id)
      for (const passage of group.passages) passageIds.set(passage.id, created.passages.find(item => item.label === passage.label)!.id)
    }
    for (const question of existing) {
      const expected = sourceByPosition.get(`${question.exam_number}/${question.question_number}`)!
      await saveQuestionStructure(question.id, { ...expected, group_id: groupIds.get(expected.group_id!)!,
        passage_references: (expected.passage_references ?? []).map(reference => ({ ...reference, passage_id: passageIds.get(reference.passage_id)! })) }, { db: connection })
    }
    for (const group of wanted.groups) {
      const current = await loadQuestionGroup(groupIds.get(group.id)!, connection)
      await saveQuestionGroup(current.id, { group_number: group.group_number, title: group.title, planned_question_count: group.planned_question_count,
        publication_status: group.publication_status, lock_version: current.lock_version }, { db: connection })
    }
    // Existing private/draft parents stay private/draft; never resume publication as a side effect.
    for (const exam of wanted.exam_sets.filter(exam => !parentsBefore.has(exam.exam_number))) {
      const current = await connection.examSet.findUniqueOrThrow({ where: { exam_number: exam.exam_number } })
      await saveExamSet({ ...exam, lock_version: current.lock_version }, { db: connection })
    }
    return { status: 'applied' as const, question_count: existing.length, group_count: wanted.groups.length, passage_count: sourcePassages.size }
  }, db)
}
