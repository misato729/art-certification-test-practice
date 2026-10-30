import { EXAM_CONFIG, type ExamConfiguration } from './examConfig.ts'
import { getExamSet, questionCountForExam } from '../../shared/schemas/exam.ts'

export type ExamCatalogEntry = {
  exam_number: number
  title: string
  question_numbers: readonly number[]
}

export const FREE_EXAM_MAX = EXAM_CONFIG.payments.enabled ? EXAM_CONFIG.payments.free_exam_count : EXAM_CONFIG.exam.set_count
export const EXAM_SET_COUNT = EXAM_CONFIG.exam.set_count
export const QUESTIONS_PER_EXAM = Math.max(...Array.from({ length: EXAM_SET_COUNT }, (_, index) => questionCountForExam(EXAM_CONFIG, index + 1)))

// Catalog navigation comes from the shared configuration. Publication and access are checked by the API.
export const createExamCatalog = (config: ExamConfiguration = EXAM_CONFIG): readonly ExamCatalogEntry[] => Object.freeze(
  Array.from({ length: config.exam.set_count }, (_, index) => Object.freeze({
    exam_number: index + 1,
    title: getExamSet(config, index + 1)!.title,
    question_numbers: Object.freeze(Array.from({ length: questionCountForExam(config, index + 1) }, (_, questionIndex) => questionIndex + 1)),
  })),
)
export const EXAM_CATALOG = createExamCatalog()
export const FREE_EXAM_CATALOG = EXAM_CATALOG.filter(exam => exam.exam_number <= FREE_EXAM_MAX)
export const examTitle = (examNumber: number): string => getExamSet(EXAM_CONFIG, examNumber)?.title ?? `試験セット ${examNumber}`

export const questionNumbersForExams = (
  examNumbers: readonly number[],
  catalog: readonly ExamCatalogEntry[] = EXAM_CATALOG,
): number[] => [...new Set(catalog.filter(exam => examNumbers.includes(exam.exam_number)).flatMap(exam => [...exam.question_numbers]))].sort((left, right) => left - right)
