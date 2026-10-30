#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import { parseExamConfig } from '../frontend/shared/schemas/exam.ts'
import { contentDocumentSchema, questionInputSchema } from '../frontend/shared/schemas/content.ts'

const dir = resolve(process.argv[2] ?? 'content/mock-exams/mock-01')
const read = name => JSON.parse(readFileSync(resolve(dir, name), 'utf8'))
const manifest = read('manifest.json')
const editorial = read('editorial.json')
const document = contentDocumentSchema.parse(read('questions.json'))
const counts = {}
assert.equal(document.questions.length, 85)
assert.equal(manifest.duration_minutes, 60)
assert.equal(manifest.scoring.points_per_question * document.questions.length, 85)
assert.equal(manifest.scoring.study_target_correct / 85, 0.6)
assert.equal(manifest.scoring.official_pass_mark, false)
assert.equal(Object.keys(editorial.questions).length, 85)
const stems = new Set()
const correctLabels = {}
for (const [index, input] of document.questions.entries()) {
  const n = index + 1
  const section = manifest.sections.filter(s => n >= s.first && n <= s.last)
  assert.equal(section.length, 1)
  assert.equal(section[0].choice_labels.length, n <= 80 ? 4 : 6)
  const config = parseExamConfig({ ...manifest.validation_config, exam: {
    ...manifest.validation_config.exam, choice_labels: section[0].choice_labels,
  } })
  // Runtime and operational imports use this same canonical schema.
  const question = questionInputSchema(config, { strict: true }).parse(input)
  assert.equal(question.question_number, n)
  assert.equal(question.exam_number, 1)
  assert.equal(question.publication_status, 'published')
  assert.equal(question.major_category_code === 'application', n > 80)
  const choices = question.choices.map(c => JSON.stringify(c.content_blocks))
  assert.equal(new Set(choices).size, choices.length)
  const stem = JSON.stringify(question.content_blocks)
  assert.ok(!stems.has(stem)); stems.add(stem)
  const meta = editorial.questions[n]
  assert.ok(meta.topic?.trim())
  assert.ok(['basic', 'standard', 'advanced'].includes(meta.difficulty))
  if (meta.group) assert.equal(question.content_blocks[0].text, meta.group.passage)
  counts[question.major_category_code] = (counts[question.major_category_code] ?? 0) + 1
  if (n <= 80) {
    const label = question.choices.find(c => c.is_correct).choice_label
    correctLabels[label] = (correctLabels[label] ?? 0) + 1
  }
}
assert.deepEqual(counts, manifest.allocation)
assert.deepEqual(Object.values(correctLabels).sort(), [20, 20, 20, 20])
// Print only safe aggregate results; never question bodies, keys, or explanations.
console.log(JSON.stringify({ status: 'passed', questions: document.questions.length,
  history: 80, application: 5, minutes: manifest.duration_minutes,
  schema: 'frontend/shared/schemas', categories: Object.keys(counts).length }))
