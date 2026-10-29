import type { ExamConfiguration } from '../../shared/schemas/exam.ts'
import {
  ContentValidationError, isRecord, nonblank, normalizeQuestionForm, parseBlocks, parseQuestionInput,
  type Block, type BlockContext, type QuestionInput,
} from '../../shared/schemas/content.ts'
import { configuration } from '../core/config.ts'
import { fail } from '../core/errors.ts'

export type { Block, BlockContext, ChoiceInput, QuestionInput } from '../../shared/schemas/content.ts'
export { integer, validSource } from '../../shared/schemas/content.ts'

function asApiValidation<T>(parse: () => T): T {
  try { return parse() }
  catch (error) {
    if (error instanceof ContentValidationError) return fail(422, 'validation_error', error.message, error.details)
    throw error
  }
}

export function validateBlocks(value: unknown, context: BlockContext, published = false, preserveOptionalAttributes = true): Block[] {
  return asApiValidation(() => parseBlocks(value, context, published, preserveOptionalAttributes))
}

export function validateQuestionInput(value: unknown, config: ExamConfiguration = configuration, preserveOptionalAttributes = true): QuestionInput {
  return asApiValidation(() => parseQuestionInput(value, config, { preserveOptionalAttributes }))
}

/** Only the transport error wrapper is server-specific; schemas and normalization are shared. */
export function sanitizeQuestionInput(value: unknown, config: ExamConfiguration = configuration): QuestionInput {
  if (!isRecord(value)) return fail(400, 'bad_request', 'questionを指定してください')
  return asApiValidation(() => normalizeQuestionForm(value, config))
}

export function excerptFrom(blocks: Block[]): string {
  const text = blocks.find(block => ['text', 'quote', 'fill_in_text', 'fill_in_quote'].includes(block.type))?.text
  const value = nonblank(text)
    ? text.replace(/\{\{([^{}]+)\}\}/g, '$1').replace(/\s+/g, ' ').trim()
    : (blocks.find(block => block.type === 'fill_in_choice')?.cells ?? []).join(' / ')
  const characters = Array.from(value)
  return characters.length > 120 ? `${characters.slice(0, 117).join('')}...` : value
}
