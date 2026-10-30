import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { parseExamConfig, questionCountForExam } from '../frontend/shared/schemas/exam.ts'
import { parseContentDocument } from '../frontend/shared/schemas/structure.ts'

const root = new URL('../', import.meta.url)
const readJson = path => {
  try { return JSON.parse(readFileSync(path, 'utf8')) }
  catch { throw new Error('Template JSON could not be read. Check the file path and JSON syntax.') }
}

try {
  const { values } = parseArgs({ options: { config: { type: 'string' }, content: { type: 'string' } } })
  const config = parseExamConfig(readJson(values.config ? resolve(values.config) : new URL('config/exam.json', root)))
  // Schema rules are shared; filesystem existence and complete sample sets are CLI-only checks.
  assert(existsSync(new URL(`frontend/public${config.site.logo_path}`, root)), 'Configured logo must exist')
  const document = parseContentDocument(readJson(values.content ? resolve(values.content) : new URL('content/questions.json', root)), config)
  const questions = document.questions
  for (let exam = 1; exam <= config.exam.set_count; exam++) {
    const numbers = questions.filter(question => question.exam_number === exam).map(question => question.question_number).sort((a,b) => a-b)
    assert.deepEqual(numbers, Array.from({ length: questionCountForExam(config, exam) }, (_,index) => index+1), `Sample set ${exam} must be complete`)
  }
  console.log(`Template validated: ${config.exam.set_count} sets, ${document.groups.length} groups, ${questions.length} questions, ${questions.reduce((n,q)=>n+q.choices.length,0)} choices.`)
} catch (error) {
  // The public message contains schema paths/categories, never question bodies or input values.
  console.error(error instanceof Error ? error.message : 'Template validation failed')
  process.exitCode = 1
}
