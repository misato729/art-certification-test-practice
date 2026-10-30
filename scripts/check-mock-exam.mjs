#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import { parseExamConfig, choiceLabelsForQuestion } from '../frontend/shared/schemas/exam.ts'
import { parseContentDocument } from '../frontend/shared/schemas/structure.ts'

function main() {
  const dir = resolve(process.argv[2] ?? 'content/mock-exams/mock-01')
  const read = name => JSON.parse(readFileSync(resolve(dir, name), 'utf8'))
  const manifest = read('manifest.json')
  const editorial = read('editorial.json')
  const config = parseExamConfig(manifest.validation_config)
  // Runtime, operational imports and this editorial check share one document parser.
  const document = parseContentDocument(read('questions.json'), config)
  const counts = {}
  assert.equal(document.schema_version, 2)
  assert.equal(document.questions.length, 85)
  assert.equal(manifest.duration_minutes, 60)
  assert.equal(manifest.scoring.points_per_question * document.questions.length, 85)
  assert.equal(manifest.scoring.study_target_correct / 85, 0.6)
  assert.equal(manifest.scoring.official_pass_mark, false)
  assert.equal(Object.keys(editorial.questions).length, 85)
  const groupMap = new Map(document.groups.map(group => [group.id, group]))
  const passages = new Map(document.groups.flatMap(group => group.passages.map(passage => [passage.id, passage])))
  assert.equal(document.groups.length, manifest.hierarchy.group_count)
  assert.equal(passages.size, manifest.hierarchy.shared_passage_count)
  assert.equal(editorial.hierarchy.group_count, document.groups.length)
  assert.equal(editorial.hierarchy.shared_passage_count, passages.size)
  const stems = new Set()
  const correctLabels = {}
  let sharedLeadQuestions = 0
  for (const [index, question] of document.questions.entries()) {
    const n = index + 1
    const section = manifest.sections.filter(section => n >= section.first && n <= section.last)
    assert.equal(section.length, 1)
    assert.deepEqual(choiceLabelsForQuestion(config, question.exam_number, n), section[0].choice_labels)
    assert.equal(question.choices.length, n <= 80 ? 4 : 6)
    assert.equal(question.question_number, n)
    assert.equal(question.exam_number, 1)
    assert.equal(question.publication_status, 'published')
    assert.equal(question.major_category_code === 'application', n > 80)
    const choices = question.choices.map(choice => JSON.stringify(choice.content_blocks))
    assert.equal(new Set(choices).size, choices.length)
    const group = groupMap.get(question.group_id)
    assert(group)
    const referencedBlocks = (question.passage_references ?? []).flatMap(reference => {
      assert.equal(reference.anchor_id, null)
      const passage = passages.get(reference.passage_id)
      assert(passage)
      return passage.content_blocks
    })
    const effectiveBlocks = [...referencedBlocks, ...question.content_blocks]
    const stem = JSON.stringify(effectiveBlocks)
    assert.ok(!stems.has(stem)); stems.add(stem)
    const meta = editorial.questions[n]
    assert.ok(meta.topic?.trim())
    assert.ok(['basic', 'standard', 'advanced'].includes(meta.difficulty))
    assert.equal(meta.group_number, group.group_number)
    assert.equal(meta.group_question_number, question.group_question_number)
    if (meta.group) {
      assert.deepEqual(referencedBlocks, [{ type: 'text', text: meta.group.passage }])
      assert.ok(!question.content_blocks.some(block => block.type === 'text' && block.text === meta.group.passage))
      sharedLeadQuestions += 1
    } else {
      assert.deepEqual(referencedBlocks, [])
    }
    counts[question.major_category_code] = (counts[question.major_category_code] ?? 0) + 1
    if (n <= 80) {
      const label = question.choices.find(choice => choice.is_correct).choice_label
      correctLabels[label] = (correctLabels[label] ?? 0) + 1
    }
  }
  for (const expected of editorial.hierarchy.groups) {
    const group = document.groups.find(group => group.group_number === expected.group_number)
    assert(group)
    assert.equal(group.title, expected.title)
    assert.equal(group.planned_question_count, expected.question_count)
    assert.equal(group.passages.length, expected.shared_passage_count)
    const numbers = document.questions.filter(question => question.group_id === group.id).map(question => question.question_number)
    assert.deepEqual(numbers, Array.from({ length: expected.question_count }, (_, index) => expected.first_question_number + index))
    assert.equal(numbers.at(-1), expected.last_question_number)
  }
  assert.equal(sharedLeadQuestions, manifest.hierarchy.questions_with_shared_passage)
  assert.deepEqual(counts, manifest.allocation)
  assert.deepEqual(Object.values(correctLabels).sort(), [20, 20, 20, 20])
  // Print only safe aggregate results; never question bodies, keys, or explanations.
  console.log(JSON.stringify({ status: 'passed', questions: document.questions.length,
    groups: document.groups.length, shared_passages: passages.size, shared_lead_questions: sharedLeadQuestions,
    history: 80, application: 5, minutes: manifest.duration_minutes,
    schema: 'frontend/shared/schemas', categories: Object.keys(counts).length }))
}

try { main() } catch {
  // Assertions may contain authored bodies; expose only a fixed safe diagnostic.
  console.error('Mock exam validation failed. Check the shared schema, hierarchy and editorial metadata.')
  process.exitCode = 1
}
