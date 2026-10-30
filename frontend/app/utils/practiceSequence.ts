export type PracticeOrder = 'sequential' | 'random'

export type PracticePosition = {
  examNumber: number
  questionNumber: number
}

export const createPracticeSequence = (
  examNumbers: readonly number[],
  questionNumbers: readonly number[],
  catalog?: readonly { exam_number: number, question_numbers: readonly number[] }[],
): PracticePosition[] => (
  examNumbers.flatMap(examNumber => (
    questionNumbers
      .filter(questionNumber => !catalog || catalog.some(exam => exam.exam_number === examNumber && exam.question_numbers.includes(questionNumber)))
      .map(questionNumber => ({ examNumber, questionNumber }))
  ))
)

export const selectPracticePositions = (
  catalog: readonly { exam_number: number, question_numbers: readonly number[] }[],
  examNumbers: readonly number[],
  questionNumbers?: readonly number[],
): PracticePosition[] => [...catalog]
  .sort((left, right) => left.exam_number - right.exam_number)
  .filter(exam => examNumbers.includes(exam.exam_number))
  .flatMap(exam => exam.question_numbers
    .filter(question => questionNumbers === undefined || questionNumbers.includes(question))
    .map(questionNumber => ({ examNumber: exam.exam_number, questionNumber })))

export const createPracticeSeed = () => Math.floor(Math.random() * 0x100000000)

export const shufflePracticeSequence = (
  positions: readonly PracticePosition[],
  seed: number,
): PracticePosition[] => {
  const shuffled = [...positions]
  let state = seed >>> 0
  const random = () => {
    state = (state + 0x6D2B79F5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000
  }

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(random() * (index + 1))
    const current = shuffled[index]
    shuffled[index] = shuffled[randomIndex]!
    shuffled[randomIndex] = current!
  }

  return shuffled
}
