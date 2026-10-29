import { EXAM_CONFIG, type ExamConfiguration } from './examConfig.ts'

export type ExamCatalogEntry = {
  exam_number: number
  question_numbers: readonly number[]
}

export const FREE_EXAM_MAX = EXAM_CONFIG.payments.enabled ? EXAM_CONFIG.payments.free_exam_count : EXAM_CONFIG.exam.set_count
export const EXAM_SET_COUNT = EXAM_CONFIG.exam.set_count
export const QUESTIONS_PER_EXAM = EXAM_CONFIG.exam.questions_per_exam

// Catalog navigation comes from the shared configuration. Publication and access are checked by the API.
export const createExamCatalog = (config: ExamConfiguration = EXAM_CONFIG): readonly ExamCatalogEntry[] => Object.freeze(
  Array.from({ length: config.exam.set_count }, (_, index) => Object.freeze({
    exam_number: index + 1,
    question_numbers: Object.freeze(Array.from({ length: config.exam.questions_per_exam }, (_, questionIndex) => questionIndex + 1)),
  })),
)
export const EXAM_CATALOG = createExamCatalog()
export const FREE_EXAM_CATALOG = EXAM_CATALOG.filter(exam => exam.exam_number <= FREE_EXAM_MAX)
