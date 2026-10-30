import { z } from 'zod'
import { getExamSet, questionCountForExam, type ExamConfiguration } from './exam.ts'
import { blocksSchema, contentDocumentSchema, ContentValidationError, integer, parseQuestionArchiveEntries, type Block, type QuestionInput } from './content.ts'

const status = z.enum(['draft', 'published', 'private'])
const title = z.string().trim().min(1).max(200)
const positive = z.preprocess(integer, z.number().int().positive().max(10000))
const identifier = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const lock = z.preprocess(integer, z.number().int().min(0)).optional()
const passage = z.object({ id: identifier.optional(), label: z.string().trim().min(1).max(40),
  display_order: positive, content_blocks: blocksSchema('question') })

export function collectPassageAnchorIds(blocks: Block[]): Set<string> {
  const ids = new Set<string>()
  for (const block of blocks) {
    if (block.id) ids.add(block.id)
    for (const inline of block.inlines ?? []) if (inline.type !== 'text') ids.add(inline.id)
  }
  return ids
}
export function assertPassageAnchors(blocks: Block[]): void {
  const ids: string[] = []
  for (const block of blocks) {
    if (block.id) ids.push(block.id)
    for (const inline of block.inlines ?? []) if (inline.type !== 'text') ids.push(inline.id)
  }
  if (new Set(ids).size !== ids.length) throw new ContentValidationError('共通本文の参照IDが重複しています', { passages: ['参照IDを重複させないでください'] })
}

export function questionGroupInputSchema(_config?: ExamConfiguration) {
  return z.object({
    group_number: positive, title, planned_question_count: positive, publication_status: status,
    lock_version: lock, passages: z.array(passage).optional(), question_ids: z.array(identifier).optional(),
  }).superRefine((group, ctx) => {
    const add = (message: string, path: (string | number)[] = ['passages']) => ctx.addIssue({ code: 'custom', path, message })
    const passages = group.passages ?? []
    for (const key of ['id', 'label', 'display_order'] as const) {
      const values = passages.map(passage => passage[key]).filter(value => value !== undefined)
      if (new Set(values).size !== values.length) add('共通本文のID・ラベル・表示順を重複させないでください')
    }
    if (group.question_ids && new Set(group.question_ids).size !== group.question_ids.length) add('小問が重複しています', ['question_ids'])
    for (const [index, item] of passages.entries()) {
      try { assertPassageAnchors(item.content_blocks) } catch { add('共通本文の参照IDが重複しています', ['passages', index, 'content_blocks']) }
      if (group.publication_status === 'published' && !blocksSchema('question', true).safeParse(item.content_blocks).success) add('公開する共通本文に空または不正な表示ブロックがあります', ['passages', index, 'content_blocks'])
    }
  })
}
export type QuestionGroupInput = z.output<ReturnType<typeof questionGroupInputSchema>>
export type GroupPassageInput = NonNullable<QuestionGroupInput['passages']>[number]

export function examSetInputSchema(_config?: ExamConfiguration) {
  return z.object({ title, publication_status: status, lock_version: lock })
}
export type ExamSetInput = z.output<ReturnType<typeof examSetInputSchema>>
function parsed<T>(result: z.ZodSafeParseResult<T>): T {
  if (result.success) return result.data
  const issue = result.error.issues[0]!
  const field = String(issue.path[0] ?? 'base')
  throw new ContentValidationError(issue.message, { [field]: [issue.message] })
}
export const parseQuestionGroupInput = (raw: unknown, config?: ExamConfiguration): QuestionGroupInput => parsed(questionGroupInputSchema(config).safeParse(raw))
export const parseExamSetInput = (raw: unknown, config?: ExamConfiguration): ExamSetInput => parsed(examSetInputSchema(config).safeParse(raw))

export type ContentGroup = Omit<QuestionGroupInput, 'lock_version' | 'question_ids' | 'passages'> & {
  id: number; exam_number: number; passages: (GroupPassageInput & { id: number })[]
}
export type ContentExamSet = Omit<ExamSetInput, 'lock_version'> & { exam_number: number }
export type ParsedContentDocument = { schema_version: 1 | 2; questions: QuestionInput[]; groups: ContentGroup[]; exam_sets: ContentExamSet[] }

/** Transport IDs are local to one document and are remapped on database import. */
export function parseContentDocument(raw: unknown, config: ExamConfiguration): ParsedContentDocument {
  const document = parsed(contentDocumentSchema.safeParse(raw))
  const questions = parseQuestionArchiveEntries(document.questions, config)
  if (document.schema_version === 1) {
    if (questions.some(question => question.group_id || question.passage_references?.length)) throw new ContentValidationError('大問を含む問題はschema_version: 2で保存してください')
    return { schema_version: 1, questions, groups: [], exam_sets: [] }
  }
  const groups: ContentGroup[] = document.groups.map(rawGroup => {
    const group = parsed(questionGroupInputSchema(config).safeParse(rawGroup))
    const identity = parsed(z.strictObject({ id: identifier, exam_number: positive, group_number: positive, title, planned_question_count: positive, publication_status: status, passages: z.array(passage.extend({ id: identifier, content_blocks: blocksSchema('question', false, true, true) }).strict()) }).safeParse(rawGroup))
    if (!questionCountForExam(config, identity.exam_number)) throw new ContentValidationError('大問の試験番号が設定範囲外です')
    return { id: identity.id, exam_number: identity.exam_number, group_number: group.group_number, title: group.title,
      planned_question_count: group.planned_question_count, publication_status: group.publication_status,
      passages: identity.passages }
  })
  const exam_sets: ContentExamSet[] = (document.exam_sets ?? []).map(value => {
    const item = parsed(z.strictObject({ exam_number: positive, title, publication_status: status }).safeParse(value))
    if (!questionCountForExam(config, item.exam_number)) throw new ContentValidationError('試験番号が設定範囲外です')
    return { exam_number: item.exam_number, title: item.title, publication_status: item.publication_status }
  })
  for (const examNumber of new Set([...groups.map(group => group.exam_number), ...questions.map(question => question.exam_number)])) {
    if (!exam_sets.some(exam => exam.exam_number === examNumber)) exam_sets.push({ exam_number: examNumber, title: getExamSet(config, examNumber)!.title,
      publication_status: groups.some(group => group.exam_number === examNumber && group.publication_status === 'published') || questions.some(question => question.exam_number === examNumber && !question.group_id && question.publication_status === 'published') ? 'published' : 'draft' })
  }
  const unique = (values: (number | string)[], message: string) => { if (new Set(values).size !== values.length) throw new ContentValidationError(message) }
  unique(groups.map(group => group.id), '大問IDが重複しています')
  unique(groups.map(group => `${group.exam_number}/${group.group_number}`), '大問番号が重複しています')
  unique(exam_sets.map(exam => exam.exam_number), '試験番号が重複しています')
  const passageMap = new Map<number, { group: ContentGroup; passage: ContentGroup['passages'][number] }>()
  for (const group of groups) for (const passage of group.passages) {
    if (passageMap.has(passage.id)) throw new ContentValidationError('共通本文IDが重複しています')
    passageMap.set(passage.id, { group, passage })
  }
  const membership = new Set<string>()
  for (const question of questions) {
    const group = groups.find(group => group.id === question.group_id)
    if (question.group_id && (!group || group.exam_number !== question.exam_number)) throw new ContentValidationError('小問と大問の試験番号が一致しません')
    if (group) {
      const key = `${group.id}/${question.group_question_number}`
      if (membership.has(key)) throw new ContentValidationError('大問内の小問番号が重複しています')
      membership.add(key)
      if ((question.group_question_number ?? 0) > group.planned_question_count) throw new ContentValidationError('大問内の小問番号が予定数を超えています')
    }
    for (const reference of question.passage_references ?? []) {
      const entry = passageMap.get(reference.passage_id)
      if (!entry || entry.group.id !== question.group_id) throw new ContentValidationError('別大問または存在しない共通本文は参照できません')
      if (reference.anchor_id !== null && !collectPassageAnchorIds(entry.passage.content_blocks).has(reference.anchor_id)) throw new ContentValidationError('本文中の参照箇所が存在しません')
    }
  }
  for (const group of groups.filter(group => group.publication_status === 'published')) {
    const children = questions.filter(question => question.group_id === group.id && question.publication_status === 'published')
    const numbers = children.map(question => question.group_question_number).sort((a, b) => (a ?? 0) - (b ?? 0))
    if (JSON.stringify(numbers) !== JSON.stringify(Array.from({ length: group.planned_question_count }, (_, index) => index + 1))) throw new ContentValidationError('公開大問の小問が不足しています')
  }
  return { schema_version: 2, questions, groups, exam_sets }
}
