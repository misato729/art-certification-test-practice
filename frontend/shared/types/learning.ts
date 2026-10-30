import type { Block } from '../schemas/content.ts'

export type { PassageInline } from '../schemas/content.ts'
export type LearningBlock = Block
export type PassageReference = { passage_id: number; anchor_id: string | null }
export type GroupPassage = { id: number; group_id?: number; label: string; display_order: number; content_blocks: Block[] }
export type GroupQuestion = { id: number; question_number: number; group_question_number?: number | null; publication_status: string; summary?: string }
export type QuestionGroup = {
  id: number; exam_number: number; group_number: number; title: string; planned_question_count: number
  publication_status: 'draft' | 'published' | 'private'; lock_version: number
  passages: GroupPassage[]; questions?: GroupQuestion[]
}
export type ExamSet = {
  exam_number: number; title: string; publication_status: 'draft' | 'published' | 'private'; lock_version: number
  groups: QuestionGroup[]; question_count?: number; published_question_count?: number
}
