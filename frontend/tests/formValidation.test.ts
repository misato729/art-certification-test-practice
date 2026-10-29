import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { EXAM_CONFIG } from '../shared/examConfig.ts'
import { loginFormSchema, signupFormSchema, deleteAccountFormSchema } from '../shared/schemas/auth.ts'
import { normalizeQuestionForm, questionFormSchema } from '../shared/schemas/content.ts'
import { apiFormErrors, questionFormFields } from '../app/utils/apiFormErrors.ts'

const password = '  Synthetic-password  '
const validSignup = { name: ' 検証会員 ', email: ' synthetic@example.test ', password, password_confirmation: password }
const sample = () => JSON.parse(readFileSync(new URL('../../content/questions.json', import.meta.url), 'utf8')).questions[0]

test('auth form schemas normalize names/email while preserving passwords and confirmation paths', () => {
  const parsed = signupFormSchema.parse(validSignup)
  assert.equal(parsed.name, '検証会員')
  assert.equal(parsed.email, 'synthetic@example.test')
  assert.equal(parsed.password, password)
  assert.equal(parsed.password_confirmation, password)
  const mismatch = signupFormSchema.safeParse({ ...validSignup, password_confirmation: password.trim() })
  assert.equal(mismatch.success, false)
  if (!mismatch.success) assert.deepEqual(mismatch.error.issues[0]?.path, ['password_confirmation'])
  assert.equal(signupFormSchema.safeParse({ ...validSignup, name: '😀'.repeat(100) }).success, true)
  assert.equal(signupFormSchema.safeParse({ ...validSignup, name: '😀'.repeat(101) }).success, false)
  assert.equal(signupFormSchema.safeParse({ ...validSignup, name: '  ' }).success, false)
  for (const value of ['', 'invalid', 'name@example', 'a'.repeat(250) + '@example.test']) assert.equal(loginFormSchema.safeParse({ email: value, password }).success, false)
  for (const value of ['', 'a'.repeat(7), 'a'.repeat(129)]) assert.equal(loginFormSchema.safeParse({ email: 'test@example.test', password: value }).success, false)
  assert.equal(loginFormSchema.safeParse({ email: 'test@example.test', password: 'a'.repeat(128) }).success, true)
})

test('deletion requires explicit confirmation and preserves the current password', () => {
  assert.equal(deleteAccountFormSchema.safeParse({ current_password: password, confirmed: false }).success, false)
  assert.equal(deleteAccountFormSchema.safeParse({ current_password: '', confirmed: true }).success, false)
  assert.equal(deleteAccountFormSchema.parse({ current_password: password, confirmed: true }).current_password, password)
})

test('admin editor and API form normalization share published and draft content constraints', () => {
  const published = sample()
  assert.equal(questionFormSchema(EXAM_CONFIG).safeParse(published).success, true)
  const draft = { ...published, publication_status: 'draft', source_text: '', content_blocks: [{ type: 'text', text: '' }] }
  assert.equal(questionFormSchema(EXAM_CONFIG).safeParse(draft).success, true)
  for (const bad of [
    { ...published, content_blocks: [] },
    { ...published, content_blocks: [{ type: 'text', text: '' }] },
    { ...published, source_text: '' },
    { ...draft, content_blocks: [{ type: 'table', headers: [], rows: [] }] },
    { ...draft, content_blocks: [{ type: 'code_group', items: [{ code: '', title: '' }] }] },
    { ...published, choices: published.choices.map((choice: object) => ({ ...choice, is_correct: false })) },
  ]) {
    assert.equal(questionFormSchema(EXAM_CONFIG).safeParse(bad).success, false)
    assert.throws(() => normalizeQuestionForm(bad, EXAM_CONFIG))
  }
})

test('API field errors accept documented fields only and never expose unstructured errors', () => {
  const response = { data: { error: { details: { question_number: ['はすでに使用されています'], source_text: ['出典を確認してください'], sql: ['private query'], choices: [null, false], category_code: ['x'.repeat(501)] } } } }
  assert.deepEqual(apiFormErrors(response, questionFormFields), [
    { name: 'question_number', message: '問番号はすでに使用されています' },
    { name: 'source_text', message: '出典を確認してください' },
  ])
  for (const value of [null, new Error('private network detail'), { data: { error: { details: ['private detail'] } } }, { data: { error: { details: { question_number: 'not-an-array' } } } }]) assert.deepEqual(apiFormErrors(value, questionFormFields), [])
})
