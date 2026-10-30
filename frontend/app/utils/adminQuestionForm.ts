import type { AdminQuestionInput } from '../types/adminQuestion.ts'
import type { PassageReference } from '../../shared/types/learning.ts'

export const normalizeAdminQuestion = (input: AdminQuestionInput): AdminQuestionInput => ({
  ...JSON.parse(JSON.stringify(input)),
  group_id: input.group_id ?? null,
  group_question_number: input.group_question_number ?? null,
  passage_references: (input.passage_references ?? []).map(reference => ({ passage_id: reference.passage_id, anchor_id: reference.anchor_id })),
})

export const prepareAdminQuestion = (input: AdminQuestionInput): AdminQuestionInput => {
  const output = normalizeAdminQuestion(input)
  output.choices.forEach((choice, index) => { choice.display_order = index + 1 })
  if (!output.group_id) {
    output.group_id = null
    output.group_question_number = null
    output.passage_references = []
  }
  return output
}

export const referenceKey = (reference: PassageReference) => JSON.stringify([reference.passage_id, reference.anchor_id])

export const setPassageReference = (references: PassageReference[], reference: PassageReference, selected: boolean): PassageReference[] => {
  const key = referenceKey(reference)
  const remaining = references.filter(item => referenceKey(item) !== key).map(item => ({ passage_id: item.passage_id, anchor_id: item.anchor_id }))
  return selected ? [...remaining, { passage_id: reference.passage_id, anchor_id: reference.anchor_id }] : remaining
}
