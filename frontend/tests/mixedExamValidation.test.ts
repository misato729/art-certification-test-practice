import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { EXAM_CONFIG } from '../shared/examConfig.ts'
import { parseExamConfig, questionCountForExam, choiceLabelsForQuestion } from '../shared/schemas/exam.ts'
import { parseQuestionInput, parseQuestionArchiveEntries, ContentValidationError } from '../shared/schemas/content.ts'

const content = JSON.parse(readFileSync(new URL('../../content/questions.json', import.meta.url), 'utf8'))
const mock = JSON.parse(readFileSync(new URL('../../content/mock-exams/mock-01/questions.json', import.meta.url), 'utf8'))
test('the only catalog set contains exactly the 85 authored mock questions', () => {
  const parsed = parseQuestionArchiveEntries(content.questions, EXAM_CONFIG)
  assert.equal(parsed.length, 85)
  assert.equal(parsed.reduce((n,q)=>n+q.choices.length,0),350)
  assert.equal(EXAM_CONFIG.exam.set_count,1)
  for (const q of mock.questions) {
    const integrated=parsed.find(p=>p.exam_number===1 && p.question_number===q.question_number)
    assert.ok(integrated)
    assert.equal(JSON.stringify(integrated),JSON.stringify(q))
  }
  assert.equal(questionCountForExam(EXAM_CONFIG,1),85)
  assert.equal(questionCountForExam(EXAM_CONFIG,2),0)
  assert.equal(questionCountForExam(EXAM_CONFIG,3),0)
  assert.equal(choiceLabelsForQuestion(EXAM_CONFIG,1,9).length,4)
  assert.equal(choiceLabelsForQuestion(EXAM_CONFIG,1,80).length,4)
  assert.equal(choiceLabelsForQuestion(EXAM_CONFIG,1,81).length,6)
  assert.equal(choiceLabelsForQuestion(EXAM_CONFIG,1,85).length,6)
})
test('question and choice boundaries follow the set and section on every shared input path', () => {
  for (const [exam,number] of [[1,86],[2,1],[0,1],[3,1]]) {
    assert.throws(()=>parseQuestionInput({...structuredClone(content.questions[0]),exam_number:exam,question_number:number},EXAM_CONFIG),ContentValidationError)
  }
  const six=structuredClone(content.questions.find((q:any)=>q.exam_number===1 && q.question_number===81))
  assert.throws(()=>parseQuestionInput({...six,question_number:80},EXAM_CONFIG),ContentValidationError)
  assert.throws(()=>parseQuestionInput({...six,choices:six.choices.slice(0,4)},EXAM_CONFIG),ContentValidationError)
  const wrong=structuredClone(six);wrong.choices[5].choice_label='キ'
  assert.throws(()=>parseQuestionInput(wrong,EXAM_CONFIG),ContentValidationError)
  const four=structuredClone(content.questions[0]);four.question_number=81
  assert.throws(()=>parseQuestionArchiveEntries([four],EXAM_CONFIG),ContentValidationError)
})
test('set definitions reject missing sets, overlaps, gaps, out-of-range sections and duplicate labels', () => {
  const changes=[
    (c:any)=>{c.exam.sets.pop()},
    (c:any)=>{c.exam.sets[0].exam_number=2},
    (c:any)=>{c.exam.sets[0].sections[1].first=80},
    (c:any)=>{c.exam.sets[0].sections[1].first=82},
    (c:any)=>{c.exam.sets[0].sections[1].last=86},
    (c:any)=>{c.exam.sets[0].sections[1].last=84},
    (c:any)=>{c.exam.sets[0].sections[1].choice_labels=['ア','ア']},
    (c:any)=>{c.exam.sets[0].sections=[]},
  ]
  for (const change of changes) {const config=structuredClone(EXAM_CONFIG);change(config);assert.throws(()=>parseExamConfig(config))}
  const legacy=structuredClone(EXAM_CONFIG);delete legacy.exam.sets
  const config=parseExamConfig(legacy)
  assert.equal(questionCountForExam(config,1),config.exam.questions_per_exam)
  assert.deepEqual(choiceLabelsForQuestion(config,1,1),config.exam.choice_labels)
})
