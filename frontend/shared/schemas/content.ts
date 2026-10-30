import { z } from 'zod'
import type { ExamConfiguration } from './exam.ts'
import { choiceLabelsForQuestion, questionCountForExam } from './exam.ts'

export type BlockContext = 'question' | 'explanation' | 'choice'
export type ValidationDetails = Record<string, string[]>
export class ContentValidationError extends Error {
  details: ValidationDetails
  constructor(message: string, details: ValidationDetails = {}) { super(message); this.details = details }
}

export const nonblank = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
export const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const inputMessage = '入力内容を確認してください'
const blockMessage = '表示ブロックの内容の形式が不正です'
const blockKindMessage = '表示ブロックの種類が正しくありません'
const publicBlockMessage = '公開する問題の本文・解説・選択肢に空または不正な表示ブロックがあります'
const tableMessage = '表の列数を確認してください'
const text = (message = blockMessage) => z.string({ error: message })
const optionalText = text().nullable().optional()
const strings = z.array(text(), { error: blockMessage })

/** Explicit conversion keeps the API's integer-string support without accepting booleans/floats. */
export function integer(value: unknown): number | undefined {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^[+-]?\d+$/.test(value.trim()))) return undefined
  const number = Number(value)
  return Number.isSafeInteger(number) ? number : undefined
}

function integerSchema(message: string, strict: boolean) {
  const number = z.number({ error: message }).int({ error: message })
  return strict ? number : z.preprocess(integer, number)
}

function createRawBlockSchema(context: BlockContext, strict: boolean) {
  const object = <S extends z.ZodRawShape>(shape: S) => strict ? z.strictObject(shape, { error: blockMessage }) : z.object(shape, { error: blockMessage })
  // Legacy API text inputs check optional source but discard it; archives forbid it.
  const plainText = <T extends 'text' | 'fill_in_text' | 'fill_in_quote'>(type: T) => strict
    ? object({ type: z.literal(type), text: text() })
    : object({ type: z.literal(type), text: text(), source: optionalText })
  const plain = plainText('text')
  const quote = object({ type: z.literal('quote'), text: text(), source: optionalText })
  const fillText = plainText('fill_in_text')
  const fillQuote = plainText('fill_in_quote')
  const code = object({ type: z.literal('code'), code: text(), title: optionalText })
  const tableStrings = z.array(text(tableMessage), { error: tableMessage })
  const table = object({ type: z.literal('table'), headers: tableStrings, rows: z.array(tableStrings, { error: tableMessage }) }).superRefine((block, ctx) => {
    if (block.rows.some(row => row.length !== block.headers.length)) ctx.addIssue({ code: 'custom', message: tableMessage, params: { details: { content_blocks: ['見出しと各行の列数を揃えてください'] } } })
  })
  const group = object({ type: z.literal('code_group'), items: z.array(object({ code: text(), title: optionalText }), { error: blockMessage }) })
  const fillChoice = object({ type: z.literal('fill_in_choice'), cells: strings })
  const options = {
    question: [plain, quote, table, code, group, fillText, fillQuote],
    explanation: [plain, quote, table, code],
    choice: [plain, table, fillChoice],
  } as const
  return z.discriminatedUnion('type', options[context], { error: blockKindMessage })
}

// Schemas contain rules only. Reuse immutable block rules during large imports;
// no user input, parsed data or exam configuration is stored in this cache.
const blockRuleCache = new Map<string, ReturnType<typeof createRawBlockSchema>>()
function rawBlockSchema(context: BlockContext, strict: boolean) {
  const key = `${context}:${strict}`
  let schema = blockRuleCache.get(key)
  if (!schema) { schema = createRawBlockSchema(context, strict); blockRuleCache.set(key, schema) }
  return schema
}

type RawBlock = z.output<ReturnType<typeof rawBlockSchema>>
type UnionKeys<T> = T extends unknown ? keyof T : never
type UnionField<T, K extends PropertyKey> = T extends unknown ? K extends keyof T ? T[K] : never : never
/** Inferred from the discriminated schema, with optional fields for existing renderers. */
export type Block = { type: RawBlock['type'] } & { [K in Exclude<UnionKeys<RawBlock>, 'type'>]?: UnionField<RawBlock, K> }

function blockSchema(context: BlockContext, preserveOptionalAttributes: boolean, strict: boolean) {
  return rawBlockSchema(context, strict).transform((block): Block => {
    const result = { ...block } as Block
    if (result.type !== 'quote' || result.source === undefined || (!preserveOptionalAttributes && !nonblank(result.source))) delete result.source
    if (result.type !== 'code' || result.title === undefined || (!preserveOptionalAttributes && !nonblank(result.title))) delete result.title
    if (result.type === 'code_group') result.items = result.items!.map(item => ({
      ...(item.title !== undefined && (preserveOptionalAttributes || nonblank(item.title)) ? { title: item.title } : {}), code: item.code,
    }))
    return result
  })
}

function completeBlock(block: Block): boolean {
  switch (block.type) {
    case 'text': case 'quote': case 'fill_in_text': case 'fill_in_quote': return nonblank(block.text)
    case 'code': return nonblank(block.code)
    case 'fill_in_choice': return Boolean(block.cells?.length && block.cells.every(nonblank))
    case 'code_group': return Boolean(block.items && block.items.length >= 2 && block.items.every(item => nonblank(item.code)))
    case 'table': return Boolean(block.headers?.length && block.rows?.length && block.headers.some(nonblank) && block.rows.flat().some(nonblank))
    default: return false
  }
}

export function blocksSchema(context: BlockContext, published = false, preserveOptionalAttributes = true, strict = false) {
  return z.array(blockSchema(context, preserveOptionalAttributes, strict), { error: '表示ブロックは配列で指定してください' }).superRefine((blocks, ctx) => {
    if (published && (!blocks.length || !blocks.every(completeBlock))) ctx.addIssue({ code: 'custom', message: publicBlockMessage })
  })
}

export function validSource(line: string): boolean {
  const match = /^.+\s\|\s(https:\/\/\S+)$/.exec(line)
  if (!match?.[1]) return false
  try {
    const url = new URL(match[1])
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password
  } catch { return false }
}

type QuestionSchemaOptions = { preserveOptionalAttributes?: boolean, strict?: boolean }
/** Canonical question rules shared by admin requests, writers, archive import and CLI. */
export function questionInputSchema(config: ExamConfiguration, options: QuestionSchemaOptions = {}) {
  const preserve = options.preserveOptionalAttributes ?? true
  const strict = options.strict ?? false
  const choiceMessage = '選択肢のラベル・順序と正答を確認してください'
  const choice = z.object({
    id: z.preprocess(value => value === null || value === '' ? undefined : value, integerSchema(choiceMessage, strict).refine(value => value >= 1, choiceMessage).optional()),
    choice_label: text(choiceMessage),
    content_blocks: blocksSchema('choice', false, preserve, strict),
    is_correct: z.boolean({ error: choiceMessage }),
    display_order: integerSchema(choiceMessage, strict),
  }, { error: '選択肢の形式を確認してください' })
  const archiveChoice = choice.omit({ id: true }).strict().transform(value => value as z.output<typeof choice>)
  const shape = {
    exam_number: integerSchema(inputMessage, strict).refine(value => value >= 1 && value <= config.exam.set_count, inputMessage),
    question_number: integerSchema(inputMessage, strict).refine(value => value >= 1, inputMessage),
    major_category_code: text(inputMessage),
    category_code: text(inputMessage),
    publication_status: z.enum(['draft', 'published', 'private'], { error: inputMessage }),
    content_blocks: blocksSchema('question', false, preserve, strict),
    explanation_blocks: blocksSchema('explanation', false, preserve, strict),
    source_text: text('出典の形式を確認してください').nullable(),
    choices: z.array(strict ? archiveChoice : choice, { error: choiceMessage }).min(2, { error: choiceMessage }).max(10, { error: choiceMessage }),
  }
  const schema = strict ? z.strictObject(shape, { error: '問題データの属性が不足しているか未対応の属性があります' }) : z.object(shape, { error: '問題の入力内容を確認してください' })
  return schema.superRefine((question, ctx) => {
    const add = (message: string, path: (string | number)[] = [], details: ValidationDetails = {}) => ctx.addIssue({ code: 'custom', path, message, params: { details } })
    const count = questionCountForExam(config, question.exam_number)
    if (question.question_number > count) add(inputMessage, ['question_number'], { question_number: [`はこの試験の1〜${count}の整数で指定してください`] })
    const labels = choiceLabelsForQuestion(config, question.exam_number, question.question_number)
    const choiceMessage = `選択肢は${labels.join('・')}の順で各1件、正答は1件必要です`
    const major = config.categories.major.find(item => item.value === question.major_category_code)
    const category = config.categories.minor.find(item => item.value === question.category_code)
    if (!major || !category || category.major_category_value !== major.value) add(inputMessage, ['category_code'], { category_code: ['は有効な大分類・小分類の組合せを指定してください'] })
    if (question.choices.length !== labels.length || question.choices.some((item, index) => item.choice_label !== labels[index] || item.display_order !== index + 1)) add(choiceMessage, ['choices'], { choices: [`はこの問題の${labels.length}件を指定してください`] })
    const ids = question.choices.filter(choice => choice.id !== undefined).map(choice => choice.id)
    if (new Set(ids).size !== ids.length) add('選択肢IDが重複しています', ['choices'])
    if (question.choices.filter(item => item.is_correct).length !== 1) add('正答を1件選択してください', ['choices'], { choices: ['正答は1件必要です'] })
    if (question.publication_status !== 'published') return
    for (const key of ['content_blocks', 'explanation_blocks'] as const) {
      if (!question[key].length || !question[key].every(completeBlock)) add(publicBlockMessage, [key])
    }
    question.choices.forEach((choice, index) => {
      if (!choice.content_blocks.length || !choice.content_blocks.every(completeBlock)) add(publicBlockMessage, ['choices', index, 'content_blocks'])
    })
    const sources = (question.source_text ?? '').split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    if (!sources.length || sources.some(line => !validSource(line))) add('公開する問題には「資料名 | https://...」形式の出典が必要です', ['source_text'])
    const blanks = [...new Set(question.content_blocks.flatMap(block => [...(block.text ?? '').matchAll(/\{\{([^}]+)\}\}/g)].map(match => match[1]!)))].sort()
    const fills = question.choices.map(choice => choice.content_blocks.filter(block => block.type === 'fill_in_choice'))
    if (blanks.length || fills.some(blocks => blocks.length)) {
      const expected = ['①', '②', '③', '④', '⑤', '⑥'].slice(0, blanks.length)
      if (!blanks.length || JSON.stringify(blanks) !== JSON.stringify(expected) || fills.some(blocks => blocks.length !== 1 || blocks[0]?.cells?.length !== blanks.length)) add('空欄ラベルと全選択肢のセル数を一致させてください')
    }
  })
}

/** Editor/API form constraints reuse the canonical rules, while allowing draft text to stay empty. */
export function questionFormSchema(config: ExamConfiguration) {
  return questionInputSchema(config, { preserveOptionalAttributes: false }).superRefine((question, ctx) => {
    for (const key of ['content_blocks', 'explanation_blocks'] as const) {
      if (!question[key].length) ctx.addIssue({ code: 'custom', path: [key], message: '表示ブロックを1件以上入力してください' })
    }
    question.choices.forEach((choice, index) => {
      if (!choice.content_blocks.length) ctx.addIssue({ code: 'custom', path: ['choices', index, 'content_blocks'], message: '表示ブロックを1件以上入力してください' })
    })
    const sections: { blocks: Block[], path: (string | number)[] }[] = [
      { blocks: question.content_blocks, path: ['content_blocks'] },
      { blocks: question.explanation_blocks, path: ['explanation_blocks'] },
      ...question.choices.map((choice, index) => ({ blocks: choice.content_blocks, path: ['choices', index, 'content_blocks'] })),
    ]
    for (const { blocks, path } of sections) blocks.forEach((block, index) => {
      if (block.type === 'table' && (!block.headers?.length || !block.rows?.length)) ctx.addIssue({ code: 'custom', path: [...path, index], message: tableMessage })
      if (block.type === 'code_group' && (!block.items || block.items.length < 2)) ctx.addIssue({ code: 'custom', path: [...path, index], message: '比較するプログラムを2件以上入力してください' })
    })
  })
}

export type QuestionInput = z.output<ReturnType<typeof questionInputSchema>>
export type ChoiceInput = QuestionInput['choices'][number]

function throwValidation(error: z.ZodError, config?: ExamConfiguration): never {
  const issue = error.issues[0]!
  const details: ValidationDetails = issue.code === 'custom' ? (issue.params?.details as ValidationDetails | undefined) ?? {} : {}
  if (config && !Object.keys(details).length) {
    if (issue.path[0] === 'exam_number') details.exam_number = [`は1〜${config.exam.set_count}の整数で指定してください`]
    if (issue.path[0] === 'question_number') details.question_number = ['はこの試験の範囲内の整数で指定してください']
    if (issue.path[0] === 'publication_status') details.publication_status = ['は下書き・公開・非公開から指定してください']
    if (issue.path.length === 1 && issue.path[0] === 'choices' && issue.code !== 'custom') details.choices = ['はこの問題の区分に対応する件数で指定してください']
  }
  if (issue.message === blockKindMessage) details.content_blocks = ['使用できない表示ブロックです']
  if (issue.message === tableMessage) details.content_blocks = ['見出しと各行の列数を揃えてください']
  throw new ContentValidationError(issue.code === 'unrecognized_keys' ? '問題データに未対応の属性があります' : issue.message, details)
}

export function parseBlocks(value: unknown, context: BlockContext, published = false, preserveOptionalAttributes = true): Block[] {
  const result = blocksSchema(context, published, preserveOptionalAttributes).safeParse(value)
  return result.success ? result.data : throwValidation(result.error)
}

export function parseQuestionInput(value: unknown, config: ExamConfiguration, options: QuestionSchemaOptions = {}): QuestionInput {
  const result = questionInputSchema(config, options).safeParse(value)
  return result.success ? result.data : throwValidation(result.error, config)
}

export function parseQuestionArchiveEntries(value: unknown, config: ExamConfiguration): QuestionInput[] {
  const result = z.array(questionInputSchema(config, { strict: true }), { error: '問題は配列で指定してください' }).superRefine((questions, ctx) => {
    const coordinates = new Set<string>()
    questions.forEach((question, index) => {
      const coordinate = `${question.exam_number}/${question.question_number}`
      if (coordinates.has(coordinate)) ctx.addIssue({ code: 'custom', path: [index], message: '試験ナンバーと問番号が重複しています' })
      coordinates.add(coordinate)
    })
  }).safeParse(value)
  return result.success ? result.data : throwValidation(result.error)
}

/** Form-only normalization is kept separate from canonical archive validation. */
export function normalizeQuestionForm(value: Record<string, unknown>, config: ExamConfiguration): QuestionInput {
  const raw = structuredClone(value)
  for (const key of ['content_blocks', 'explanation_blocks']) {
    if (!Array.isArray(raw[key]) || raw[key].length === 0) throw new ContentValidationError('表示ブロックを1件以上入力してください', { content_blocks: ['は1件以上必要です'] })
  }
  raw.source_text = nonblank(raw.source_text) ? raw.source_text : null
  if (Array.isArray(raw.choices)) raw.choices = raw.choices.map((value, index) => {
    if (!isRecord(value)) throw new ContentValidationError('選択肢の形式を確認してください')
    if (!Array.isArray(value.content_blocks) || !value.content_blocks.length) throw new ContentValidationError('表示ブロックを1件以上入力してください', { content_blocks: ['は1件以上必要です'] })
    const falseValues = new Set<unknown>([false, 0, '0', 'f', 'F', 'false', 'FALSE', 'off', 'OFF', '', null, undefined])
    return { ...value, is_correct: !falseValues.has(value.is_correct), display_order: index + 1 }
  })
  const result = questionFormSchema(config).safeParse(raw)
  return result.success ? result.data : throwValidation(result.error, config)
}

export const contentDocumentSchema = z.strictObject({ schema_version: z.literal(1), questions: z.array(z.unknown()).min(1) })
