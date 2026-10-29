import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { EXAM_CONFIG } from '../shared/examConfig.ts'
import { examConfigurationJsonSchema, parseExamConfig } from '../shared/schemas/exam.ts'
import {
  ContentValidationError, normalizeQuestionForm, parseQuestionArchiveEntries, parseQuestionInput,
  type QuestionInput,
} from '../shared/schemas/content.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const sample = JSON.parse(readFileSync(new URL('../../content/questions.json', import.meta.url), 'utf8'))
const question = (): QuestionInput => structuredClone(sample.questions[0])
const config = () => structuredClone(EXAM_CONFIG)

test('shared config parsing rejects former CLI/runtime disagreements and retains extension fields without mutation', () => {
  for (const field of ['short_name', 'description', 'tagline'] as const) {
    const input = config()
    input.site[field] = '  '
    assert.throws(() => parseExamConfig(input), new RegExp(`site.${field}`))
  }
  for (const path of ['/images/../logo.svg', '/logo.svg"', '//external/logo.svg']) {
    const input = config()
    input.site.logo_path = path
    assert.throws(() => parseExamConfig(input), /site.logo_path/)
  }
  const input = { ...config(), extension: { custom: true } }
  const parsed = parseExamConfig(input)
  assert.deepEqual(parsed.extension, { custom: true })
  ;(parsed.extension as { custom: boolean }).custom = false
  assert.deepEqual(input.extension, { custom: true })
  parsed.site.name = 'modified'
  assert.notEqual(input.site.name, parsed.site.name)
})

test('generated editor schema stays current and its color/path patterns accept exactly supported assets', () => {
  const actual = JSON.parse(readFileSync(new URL('../../config/exam.schema.json', import.meta.url), 'utf8'))
  assert.deepEqual(actual, examConfigurationJsonSchema())
  const site = (actual as any).properties.site.properties
  for (const color of ['#aabbcc', '#AABBCC', '#0088CC']) {
    assert.equal(new RegExp(site.primary_color.pattern).test(color), true)
    const input = config(); input.site.primary_color = color
    assert.equal(parseExamConfig(input).site.primary_color, color)
  }
  for (const path of ['/images/../logo.svg', '/../logo.svg', '//outside/logo.svg']) assert.equal(new RegExp(site.logo_path.pattern).test(path), false)
  assert.equal(new RegExp(site.logo_path.pattern).test('/images/logo.svg'), true)
})

test('API canonical values and strict archives share question rules while preserving unknown-field and integer policies', () => {
  const raw = question() as any
  raw.exam_number = '1'
  raw.choices[0].id = '42'
  raw.unrelated = 'discard'
  raw.content_blocks[0].unrelated = 'discard'
  const parsed = parseQuestionInput(raw, config())
  assert.equal(parsed.exam_number, 1)
  assert.equal(parsed.choices[0]!.id, 42)
  assert.equal('unrelated' in parsed, false)
  assert.equal('unrelated' in parsed.content_blocks[0]!, false)
  assert.throws(() => parseQuestionArchiveEntries([raw], config()), ContentValidationError)
  for (const path of ['question', 'choice', 'block', 'item']) {
    const raw = question() as any
    if (path === 'question') raw.extra = true
    if (path === 'choice') raw.choices[0].extra = true
    if (path === 'block') raw.content_blocks[0].extra = true
    if (path === 'item') raw.content_blocks = [{ type: 'code_group', items: [{ code: 'a', extra: true }, { code: 'b' }] }]
    assert.throws(() => parseQuestionArchiveEntries([raw], config()), ContentValidationError)
  }
})

test('canonical archives keep missing/null/empty metadata while form-only normalization removes blank titles and sources', () => {
  const raw = question()
  raw.content_blocks = [{ type: 'code_group', items: [{ title: '', code: 'a' }, { title: null, code: 'b' }] }]
  raw.explanation_blocks = [{ type: 'quote', source: null, text: 'Explanation' }, { type: 'code', title: '', code: 'a' }]
  assert.deepEqual(parseQuestionArchiveEntries([raw], config()), [raw])
  assert.deepEqual(parseQuestionInput(raw, config()), raw)
  const normalized = normalizeQuestionForm(raw, config())
  assert.equal('title' in normalized.content_blocks[0]!.items![0]!, false)
  assert.equal('title' in normalized.content_blocks[0]!.items![1]!, false)
  assert.equal('source' in normalized.explanation_blocks[0]!, false)
  assert.equal('title' in normalized.explanation_blocks[1]!, false)
})

test('published content enforces table widths, context, one correct answer, sources and contiguous blank relations', () => {
  const changes = [
    (raw: QuestionInput) => { raw.content_blocks = [{ type: 'table', headers: ['A', 'B'], rows: [['one']] }] },
    (raw: QuestionInput) => { raw.choices[0]!.content_blocks = [{ type: 'code', code: 'not allowed in a choice' }] },
    (raw: QuestionInput) => { raw.choices[1]!.is_correct = true; raw.choices[0]!.is_correct = true },
    (raw: QuestionInput) => { raw.source_text = 'Source | https://user:secret@example.com' },
    (raw: QuestionInput) => { raw.content_blocks = [{ type: 'fill_in_text', text: '{{①}} and {{③}}' }] },
    (raw: QuestionInput) => { raw.explanation_blocks = [] },
  ]
  for (const change of changes) {
    const raw = question(); change(raw)
    assert.throws(() => parseQuestionInput(raw, config()), ContentValidationError)
    assert.throws(() => parseQuestionArchiveEntries([raw], config()), ContentValidationError)
  }
  const table = question()
  table.content_blocks = [{ type: 'table', headers: ['', 'Value'], rows: [['Row', '']] }]
  assert.deepEqual(parseQuestionArchiveEntries([table], config()), [table])
  const draft = { ...question(), publication_status: 'draft' as const, content_blocks: [], explanation_blocks: [], source_text: null }
  assert.deepEqual(parseQuestionInput(draft, config()), draft)
  assert.throws(() => normalizeQuestionForm(draft, config()), ContentValidationError)
})

test('shared rules follow an alternate five-choice exam and reject duplicate coordinates', () => {
  const alternate = config()
  alternate.exam = { set_count: 3, questions_per_exam: 25, choice_labels: ['A', 'B', 'C', 'D', 'E'] }
  alternate.categories = { major: [{ value: 'new', label: 'New' }], minor: [{ value: 'topic', label: 'Topic', major_category_value: 'new' }] }
  const raw = question()
  raw.exam_number = 3; raw.question_number = 25
  raw.major_category_code = 'new'; raw.category_code = 'topic'
  raw.choices = alternate.exam.choice_labels.map((label, index) => ({ choice_label: label, display_order: index + 1, is_correct: index === 0, content_blocks: [{ type: 'text', text: label }] }))
  assert.deepEqual(parseQuestionArchiveEntries([raw], parseExamConfig(alternate)), [raw])
  assert.throws(() => parseQuestionInput(raw, config()), ContentValidationError)
  assert.throws(() => parseQuestionArchiveEntries([raw, raw], alternate), /重複/)
})

test('CLI uses the same config and nested content validation and does not echo rejected input', () => {
  const directory = mkdtempSync(join(tmpdir(), 'exam-validation-test-'))
  const configPath = join(directory, 'exam.json'), contentPath = join(directory, 'questions.json')
  const command = join(root, 'scripts/check-template.mjs')
  const run = () => spawnSync(process.execPath, ['--experimental-strip-types', command, '--config', configPath, '--content', contentPath], { cwd: root, encoding: 'utf8' })
  try {
    writeFileSync(configPath, JSON.stringify(config()))
    writeFileSync(contentPath, JSON.stringify(sample))
    assert.equal(run().status, 0)
    const badConfig = config(); badConfig.site.description = ' '
    writeFileSync(configPath, JSON.stringify(badConfig))
    const rejectedConfig = run()
    assert.equal(rejectedConfig.status, 1)
    assert.match(rejectedConfig.stderr, /site.description/)
    writeFileSync(configPath, JSON.stringify(config()))
    const badContent = structuredClone(sample)
    badContent.questions[0].content_blocks = [{ type: 'table', headers: ['A', 'B'], rows: [['PRIVATE_REJECTED_CONTENT']] }]
    assert.throws(() => parseQuestionArchiveEntries(badContent.questions, config()), ContentValidationError)
    writeFileSync(contentPath, JSON.stringify(badContent))
    const rejectedContent = run()
    assert.equal(rejectedContent.status, 1)
    assert.equal(rejectedContent.stderr.includes('PRIVATE_REJECTED_CONTENT'), false)
    writeFileSync(contentPath, '{"PRIVATE_INVALID_JSON"')
    const invalidJson = run()
    assert.equal(invalidJson.status, 1)
    assert.equal(invalidJson.stderr.includes('PRIVATE_INVALID_JSON'), false)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
