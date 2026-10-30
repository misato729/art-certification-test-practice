import { EXAM_CONFIG, type ExamConfiguration } from '../utils/examConfig.ts'
import type { QuestionInput, Block } from '../../shared/schemas/content.ts'
import { choiceLabelsForQuestion } from '../../shared/schemas/exam.ts'
import type { PassageReference, GroupPassage } from '../../shared/types/learning.ts'

export type ContentBlockType =
  | 'text'
  | 'quote'
  | 'table'
  | 'code'
  | 'code_group'
  | 'fill_in_text'
  | 'fill_in_quote'
  | 'fill_in_choice'

export type ContentBlock = Block

export type AdminChoice = {
  id?: number
  choice_label: string
  content_blocks: ContentBlock[]
  is_correct: boolean
  display_order: number
}

export type AdminQuestionInput = {
  exam_number: number
  question_number: number
  group_id?: number | null
  group_question_number?: number | null
  passage_references?: PassageReference[]
  lock_version?: number
  content_blocks: ContentBlock[]
  major_category_code: string
  category_code: string
  explanation_blocks: ContentBlock[]
  source_text: string
  publication_status: QuestionInput['publication_status']
  choices: AdminChoice[]
}

export type AdminQuestion = AdminQuestionInput & {
  id: number
  created_at: string
  updated_at: string
  shared_passages?: GroupPassage[]
  question_version?: number
}

export type AdminQuestionSummary = {
  id: number
  exam_number: number
  question_number: number
  summary: string
  major_category_code: string
  category_code: string
  publication_status: QuestionInput['publication_status']
  updated_at: string
}

export type ApiResponse<T> = { data: T }

export type PaginatedApiResponse<T> = {
  data: T[]
  meta: {
    current_page: number
    per_page: number
    total_count: number
    total_pages: number
  }
}

export const createEmptyQuestion = (config: ExamConfiguration = EXAM_CONFIG): AdminQuestionInput => ({
  exam_number: 1,
  question_number: 1,
  group_id: null,
  group_question_number: null,
  passage_references: [],
  content_blocks: [{ type: 'text', text: '' }],
  major_category_code: config.categories.minor[0]!.major_category_value,
  category_code: config.categories.minor[0]!.value,
  explanation_blocks: [{ type: 'text', text: '' }],
  source_text: '',
  publication_status: 'draft',
  choices: choiceLabelsForQuestion(config, 1, 1).map((label, index) => ({
    choice_label: label,
    content_blocks: [{ type: 'text', text: '' }],
    is_correct: index === 0,
    display_order: index + 1,
  })),
})
