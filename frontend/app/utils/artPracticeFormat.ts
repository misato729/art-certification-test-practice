import { shufflePracticeSequence, type PracticePosition } from './practiceSequence.ts'

/** Display/ordering policy only. Never rewrites questions, references or publication. */
export const MATERIAL_RANDOM_UNIT = 'materials-v1'
export const APPLICATION_SECTION_TITLE = '知識・情報の活用問題'

export type ArtSection = { title: string; first: number; last: number }
export type ArtFormatConfiguration = {
  exam: { sets?: readonly { exam_number: number; sections?: readonly ArtSection[] }[] }
}
export type ArtCatalogGroup = { id: number; group_number: number; question_numbers: readonly number[] }
export type ArtCatalogEntry = {
  exam_number: number
  question_numbers: readonly number[]
  isStatic?: boolean
  access?: 'available' | 'paid_membership_required'
  groups?: readonly ArtCatalogGroup[]
}
export type ArtSectionLink = {
  id: string
  label: string
  to: string
  examNumber: number
  first: number
  last: number
}

export function artSections(config: ArtFormatConfiguration, examNumber: number): readonly ArtSection[] {
  return config.exam.sets?.find(set => set.exam_number === examNumber)?.sections ?? []
}

export function artQuestionSection(config: ArtFormatConfiguration, examNumber: number, questionNumber: number): ArtSection | undefined {
  if (!Number.isSafeInteger(questionNumber) || questionNumber < 1) return undefined
  return artSections(config, examNumber).find(section => questionNumber >= section.first && questionNumber <= section.last)
}

export function isApplicationQuestion(config: ArtFormatConfiguration, examNumber: number, questionNumber: number): boolean {
  // This identifies this app's configured section, not a claim about the real exam's fixed layout.
  return artQuestionSection(config, examNumber, questionNumber)?.title === APPLICATION_SECTION_TITLE
}

/** null = invalid section; [] = valid section with no published positions. */
export function sectionQuestionNumbers(
  config: ArtFormatConfiguration, examNumber: number, sectionNumber: number, published: readonly number[],
): number[] | null {
  if (!Number.isSafeInteger(sectionNumber) || sectionNumber < 1) return null
  const section = artSections(config, examNumber)[sectionNumber - 1]
  if (!section) return null
  return [...new Set(published.filter(number => Number.isSafeInteger(number)
    && number >= section.first && number <= section.last))].sort((a, b) => a - b)
}

/** Configured sections are navigation, not invented 'major questions' or publication counts. */
export function artSectionLinks(exam: ArtCatalogEntry, config: ArtFormatConfiguration): ArtSectionLink[] {
  return artSections(config, exam.exam_number).flatMap((section, index) => {
    const numbers = sectionQuestionNumbers(config, exam.exam_number, index + 1, exam.question_numbers)!
    if (!exam.isStatic && !numbers.length) return []
    const range = section.first === section.last ? `問${section.first}` : `問${section.first}〜${section.last}`
    const to = exam.access === 'paid_membership_required' ? '/premium'
      : exam.isStatic ? `/practice/start?exams=${exam.exam_number}&section=${index + 1}`
        : `/practice/${exam.exam_number}/${numbers[0]}?exams=${exam.exam_number}&questions=${numbers.join(',')}`
    return [{ id: `${exam.exam_number}:${index + 1}`, label: `${section.title}（${range}）`,
      to, examNumber: exam.exam_number, first: section.first, last: section.last }]
  })
}

export function isArtSectionActive(link: ArtSectionLink, examNumber: number, questionNumber: number): boolean {
  return link.examNumber === examNumber && questionNumber >= link.first && questionNumber <= link.last
}

/**
 * Ordinary questions remain independent units. Application questions in the same
 * actual API group stay together, in API child order. Never add unselected siblings.
 * A missing/one-question group is a singleton; we do not invent a five-question group.
 * Existing random URLs without random_unit=materials-v1 use the old shuffle instead.
 */
export function shuffleArtPracticeSequence(
  positions: readonly PracticePosition[], seed: number,
  catalog: readonly ArtCatalogEntry[], config: ArtFormatConfiguration,
): PracticePosition[] {
  const groups = new Map<string, { key: string; order: number }>()
  for (const exam of catalog) {
    const published = new Set(exam.question_numbers)
    for (const group of exam.groups ?? []) {
      group.question_numbers.forEach((number, order) => {
        if (!published.has(number) || !isApplicationQuestion(config, exam.exam_number, number)) return
        const coordinate = `${exam.exam_number}:${number}`
        // Defensive: malformed duplicate membership cannot duplicate a question.
        if (!groups.has(coordinate)) groups.set(coordinate, { key: `g:${exam.exam_number}:${group.id}`, order })
      })
    }
  }
  const units = new Map<string, PracticePosition[]>()
  const seen = new Set<string>()
  // All three entry points must produce the same units even if input order differs.
  for (const position of [...positions].sort((a, b) => a.examNumber - b.examNumber || a.questionNumber - b.questionNumber)) {
    const coordinate = `${position.examNumber}:${position.questionNumber}`
    if (seen.has(coordinate)) continue
    seen.add(coordinate)
    const key = groups.get(coordinate)?.key ?? `q:${coordinate}`
    const unit = units.get(key) ?? []
    unit.push(position)
    units.set(key, unit)
  }
  for (const unit of units.values()) unit.sort((a, b) => (
    (groups.get(`${a.examNumber}:${a.questionNumber}`)?.order ?? 0)
    - (groups.get(`${b.examNumber}:${b.questionNumber}`)?.order ?? 0)
  ))
  return shufflePracticeSequence([...units.values()], seed).flat()
}

export type ArtQuestionContext = {
  exam_number: number
  question_number: number
  group?: { id: number; question_numbers: readonly number[] } | null
  shared_passages?: readonly { id: number }[]
}

export function applicationPeerNumbers(
  question: ArtQuestionContext | null | undefined,
  sequence: readonly PracticePosition[], config: ArtFormatConfiguration,
): number[] {
  if (!question?.group || !question.shared_passages?.length
    || !isApplicationQuestion(config, question.exam_number, question.question_number)) return []
  const available = new Set(sequence.filter(item => item.examNumber === question.exam_number).map(item => item.questionNumber))
  return [...new Set(question.group.question_numbers.filter(number => available.has(number)
    && isApplicationQuestion(config, question.exam_number, number)))]
}
