import type { GroupPassage } from '../../shared/types/learning.ts'

export type PracticeGroupContext = { id: number; group_number: number; title: string; question_numbers: number[] }
export type PracticeRequestTag = { instance: string; scope: number; navigation: number; request: number; examNumber: number; questionNumber: number }
export type PracticePassageContext = {
  scope: number
  examNumber: number
  group: PracticeGroupContext
  passages: GroupPassage[]
  key: string
}

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]))
  return value
}

export const isCurrentPracticeRequest = (actual: PracticeRequestTag | undefined, expected: PracticeRequestTag) => Boolean(actual
  && actual.instance === expected.instance && actual.scope === expected.scope && actual.navigation === expected.navigation && actual.request === expected.request
  && actual.examNumber === expected.examNumber && actual.questionNumber === expected.questionNumber)

/** Retain only the public reading context, never a question, answer, or source DTO. */
export const reconcilePassageContext = (
  previous: PracticePassageContext | null,
  source: { exam_number: number; group?: PracticeGroupContext | null; shared_passages?: GroupPassage[] },
  scope: number,
): PracticePassageContext | null => {
  if (!source.group || !source.shared_passages?.length) return null
  const group = { id: source.group.id, group_number: source.group.group_number, title: source.group.title, question_numbers: [...source.group.question_numbers] }
  const passages = source.shared_passages.map(passage => ({ id: passage.id, label: passage.label, display_order: passage.display_order, content_blocks: passage.content_blocks }))
  const key = JSON.stringify(canonical({ examNumber: source.exam_number, groupId: group.id, passages }))
  return { scope, examNumber: source.exam_number, group, key, passages: previous?.scope === scope && previous.key === key ? previous.passages : passages }
}

export const canRetainPassageContext = (context: PracticePassageContext | null, target: { examNumber: number; questionNumber: number; scope: number }) => Boolean(context
  && context.scope === target.scope && context.examNumber === target.examNumber && context.group.question_numbers.includes(target.questionNumber))
