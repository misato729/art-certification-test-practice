import { readFileSync } from 'node:fs'
import { parseExamConfig } from '../shared/schemas/exam.ts'
import { parseContentDocument } from '../shared/schemas/structure.ts'

/** The browser fixture uses the exact same validation as runtime and import. */
export function loadE2EFixture() {
  let config
  let questions
  try {
    config = parseExamConfig(JSON.parse(readFileSync(new URL('../../config/exam.json', import.meta.url), 'utf8')))
    const document = parseContentDocument(JSON.parse(readFileSync(new URL('../../content/questions.json', import.meta.url), 'utf8')), config)
    questions = document.questions
  } catch { throw new Error('E2E fixture validation failed. Check the shared configuration and sample content.') }
  const question = questions.find(item => item.publication_status === 'published')
  if (!question || config.payments.enabled) throw new Error('Core browser journeys require a published sample question and payments.enabled=false in the isolated fixture.')
  return { config, question }
}
