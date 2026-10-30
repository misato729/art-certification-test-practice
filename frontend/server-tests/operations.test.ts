import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, lstat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { verifyPassword } from 'better-auth/crypto'
import { configuration } from '../server/core/config.ts'
import { ApiError } from '../server/core/errors.ts'
import { isolatedTransaction, query, closeDatabase, type Database } from '../server/core/db.ts'
import { createArchive, validateArchive, validateQuestions, digest, importArchive, importContent, exportArchive, seedContent, defaultContentPath, IMPORT_CONFIRMATION, OperationError } from '../server/operations/content.ts'
import { createAdmin, grantVerification, revokeVerification } from '../server/operations/accounts.ts'
import { auditOperations, expirePendingForUser } from '../server/operations/audit.ts'
import { restoreDrillConnection, normalizeConstraintDefinition } from '../server/operations/restore-drill.ts'
import { runCommand, safeOperationFailure } from '../server/operations/cli.ts'
import type { PaymentStripeClient } from '../server/services/payment-client.ts'

process.env.APP_ENV = 'test'
process.env.BETTER_AUTH_SECRET ||= 'test-secret-for-operations-'.repeat(4)
process.env.BETTER_AUTH_URL ||= 'http://127.0.0.1:3310'
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
const integration = { skip: !Boolean(process.env.DATABASE_URL || process.env.PGHOST) }
const content = JSON.parse(await readFile(defaultContentPath, 'utf8'))
const archive = () => createArchive(structuredClone(content.questions))
after(async () => closeDatabase())

async function isolated(action: (db: Database) => Promise<void>) {
  return isolatedTransaction(async db => {
    // Only this caller-owned rollback transaction is emptied. The test database
    // must already have been migrated by the test command/CI.
    await db.user.deleteMany()
    await db.question.deleteMany()
    await db.payment.deleteMany()
    await db.stripeWebhookEvent.deleteMany()
    await db.authVerification.deleteMany()
    await db.apiRateLimitBucket.deleteMany()
    await db.rateLimiterFlexible.deleteMany()
    await action(db)
  })
}
const countQuestions = async (db: Database) => Number((await query<{ total: number }>('SELECT count(*) AS total FROM questions', [], db))[0]!.total)
async function user(db: Database) {
  const email = `operations-${randomUUID()}@example.invalid`
  const [row] = await query<{ id: number }>("INSERT INTO users(name,email,role,created_at,updated_at) VALUES('Operations test',$1,'user',NOW(),NOW()) RETURNING id", [email], db)
  return { id: row!.id, email }
}

test('archives preserve Rails canonical checksums regardless of object attribute order', () => {
  assert.equal(digest({ b: 2, a: { d: 4, c: 3 } }), digest({ a: { c: 3, d: 4 }, b: 2 }))
  const document = archive()
  assert.equal(document.question_count, content.questions.length)
  assert.equal(document.choice_count, content.questions.reduce((total: number, question: { choices: unknown[] }) => total + question.choices.length, 0))
  assert.deepEqual(validateArchive(document), document)
  const optional = structuredClone(content.questions)
  optional[0].content_blocks = [{ type: 'code', title: '', code: 'value = 1' }]
  assert.equal(validateQuestions(optional)[0]!.content_blocks[0]!.title, '')
})

test('archive integrity rejects modified content, counts, unknown fields and duplicate coordinates before DB access', async () => {
  const changed = archive(); changed.questions[0]!.content_blocks = [{ type: 'text', text: 'changed' }]
  assert.throws(() => validateArchive(changed), OperationError)
  assert.throws(() => validateArchive({ ...archive(), choice_count: 1 }), OperationError)
  assert.throws(() => validateArchive({ ...archive(), secret: 'never-accepted' }), OperationError)
  assert.throws(() => createArchive([...content.questions, content.questions[0]]), OperationError)
  const unexpected = structuredClone(content.questions); unexpected[0].choices[0].secret = true
  assert.throws(() => createArchive(unexpected), OperationError)
  const db = { query: async () => { throw new Error('DB must not be reached') } } as unknown as Database
  await assert.rejects(importArchive(archive(), undefined, db), OperationError)
  await assert.rejects(importArchive(changed, IMPORT_CONFIRMATION, db), OperationError)
})

test('automatic sample seeding is disabled in production and test without touching the DB', async () => {
  const db = { query: async () => { throw new Error('DB must not be reached') } } as unknown as Database
  for (const mode of ['production', 'test']) assert.deepEqual(await seedContent({ mode, db }), { status: 'skipped' })
})

test('restore drills reject remote DBs and enabled sales/notifications before connecting', () => {
  assert.throws(() => restoreDrillConnection({ PGHOST: 'db' }, 'production'), OperationError)
  assert.throws(() => restoreDrillConnection({ PGHOST: 'remote.example.test' }, 'test'), OperationError)
  assert.throws(() => restoreDrillConnection({ DATABASE_URL: 'postgres://user:password@remote.example.test/database' }, 'test'), OperationError)
  assert.throws(() => restoreDrillConnection({ PGHOST: 'db', PAID_MEMBERSHIP_ENABLED: 'true' }, 'test'), OperationError)
  assert.throws(() => restoreDrillConnection({ PGHOST: 'db', ERROR_NOTIFICATIONS_ENABLED: '1' }, 'test'), OperationError)
  assert.deepEqual(restoreDrillConnection({ DATABASE_URL: 'postgres://local:password@127.0.0.1:55432/ignored' }, 'test'), { host: '127.0.0.1', port: 55432, user: 'local', password: 'password' })
})

test('restore comparison tolerates only redundant enum varchar/text casts and preserves literals and other checks', () => {
  const source = "CHECK (((role)::text = ANY ((ARRAY['user'::character varying, 'admin'::character varying])::text[])))"
  const reparsed = "CHECK (((role)::text = ANY (ARRAY[('user'::character varying)::text, ('admin'::character varying)::text])))"
  const normalize = (value: string) => normalizeConstraintDefinition('users', 'users_role_valid', value)
  assert.equal(normalize(source), normalize(reparsed))
  assert.notEqual(normalize(source), normalize(reparsed.replace("'admin'", "'owner'")))
  assert.notEqual(normalize(source), normalize(reparsed.replace("'admin'", "'admin ()'")))
  assert.notEqual(normalize(source), normalize(reparsed.replace(' = ANY ', ' <> ALL ')))
  assert.equal(normalizeConstraintDefinition('payments', 'payments_amount_positive', 'CHECK ((amount > 0))'), 'CHECK ((amount > 0))')
})

test('CLI failures never echo DB messages, user data, question bodies or credentials', async () => {
  const secret = 'synthetic-secret@example.invalid question-body password=do-not-log'
  assert.equal(JSON.stringify(safeOperationFailure(new Error(secret))).includes(secret), false)
  assert.equal(JSON.stringify(safeOperationFailure(new ApiError(422, 'validation_error', secret, { secret }))).includes(secret), false)
  await assert.rejects(runCommand('unknown-command-that-must-not-be-echoed'), error => error instanceof OperationError && !error.message.includes('unknown-command-that-must-not-be-echoed'))
  await assert.rejects(createAdmin({ email: 'invalid', password: secret }), OperationError)
})

test('JSON import and development seed never overwrite existing questions', integration, async () => isolated(async db => {
  assert.equal((await seedContent({ db, mode: 'development' })).status, 'imported')
  const before = await query('SELECT * FROM questions ORDER BY id', [], db)
  assert.deepEqual(await seedContent({ db, mode: 'development' }), { status: 'skipped' })
  await assert.rejects(importContent(undefined, IMPORT_CONFIRMATION, db), OperationError)
  assert.deepEqual(await query('SELECT * FROM questions ORDER BY id', [], db), before)
}))

test('an incomplete public set fails as one transaction and persists no imported rows', integration, async () => isolated(async db => {
  await query('SAVEPOINT partial_import', [], db)
  await assert.rejects(importArchive(createArchive(content.questions.slice(0, 1)), IMPORT_CONFIRMATION, db), error => error instanceof ApiError && error.status === 422)
  // A caller-owned transaction is responsible for rollback; the CLI owns its transaction.
  await query('ROLLBACK TO SAVEPOINT partial_import', [], db)
  assert.equal(await countQuestions(db), 0)
}))

test('archive export has private permissions, excludes all user data and rejects existing destinations', integration, async () => isolated(async db => {
  await importContent(undefined, IMPORT_CONFIRMATION, db)
  const owner = await user(db)
  const directory = await mkdtemp(join(tmpdir(), 'exam-export-test-'))
  try {
    const file = join(directory, 'questions.json')
    const report = await exportArchive(file, db)
    assert.equal(report.question_count, content.questions.length)
    const encoded = await readFile(file, 'utf8')
    assert.equal(encoded.includes(owner.email), false)
    assert.equal(encoded.includes('password_digest'), false)
    assert.equal((await lstat(file)).mode & 0o777, 0o600)
    assert.equal(validateArchive(JSON.parse(encoded)).sha256, report.sha256)
    await assert.rejects(exportArchive(file, db), OperationError)
    assert.equal(await readFile(file, 'utf8'), encoded)
  } finally { await rm(directory, { recursive: true, force: true }) }
}))

test('admin creation refuses duplicate accounts and never promotes or resets an existing user', integration, async () => isolated(async db => {
  const existing = await user(db)
  await assert.rejects(createAdmin({ email: existing.email, password: 'synthetic-password' }, db), OperationError)
  assert.equal((await query('SELECT role FROM users WHERE id=$1', [existing.id], db))[0]!.role, 'user')
  const email = `admin-${randomUUID()}@example.invalid`
  await assert.rejects(createAdmin({ email, password: 'short' }, db), OperationError)
  assert.deepEqual(await createAdmin({ email, password: 'synthetic-password', name: 'Test admin' }, db), { status: 'created' })
  const [admin] = await query('SELECT * FROM users WHERE email=$1', [email], db)
  assert.equal(admin!.role, 'admin')
  const [credential] = await query("SELECT * FROM auth_accounts WHERE user_id=$1 AND provider_id='credential'", [admin!.id], db)
  assert.equal(credential!.account_id, String(admin!.id))
  assert.equal(await verifyPassword({ password: 'synthetic-password', hash: credential!.password }), true)
  assert.equal((await query('SELECT id FROM auth_sessions WHERE user_id=$1', [admin!.id], db)).length, 0)
  await assert.rejects(createAdmin({ email, password: 'changed-password' }, db), OperationError)
  assert.deepEqual(await query('SELECT * FROM auth_accounts WHERE user_id=$1', [admin!.id], db), [credential])
  assert.equal((await query('SELECT role FROM users WHERE id=$1', [admin!.id], db))[0]!.role, 'admin')
}))

test('verification grants are audited, expire within seven days, grant once and revoke idempotently', integration, async () => isolated(async db => {
  const owner = await user(db)
  await assert.rejects(grantVerification({ email: owner.email, reason: 'test', grantedBy: 'operator', expiresAt: new Date(Date.now() + 8 * 86400000).toISOString() }, db), OperationError)
  const input = { email: owner.email, reason: 'Synthetic verification', grantedBy: 'test-operator', expiresAt: new Date(Date.now() + 86400000).toISOString() }
  assert.equal((await grantVerification(input, db)).status, 'granted')
  await assert.rejects(grantVerification(input, db), OperationError)
  assert.deepEqual(await revokeVerification(owner.email, db), { status: 'revoked' })
  const [before] = await query('SELECT revoked_at FROM verification_access_grants WHERE user_id=$1', [owner.id], db)
  await revokeVerification(owner.email, db)
  assert.deepEqual((await query('SELECT revoked_at FROM verification_access_grants WHERE user_id=$1', [owner.id], db))[0], before)
}))

test('audit reports aggregate anomalies and pending checkout expiration uses the Stripe service', integration, async () => isolated(async db => {
  const owner = await user(db)
  await query("INSERT INTO payments(user_id,stripe_checkout_session_id,stripe_price_id,amount,currency,status,created_at,updated_at) VALUES($1,'cs_test_operations','price_test_operations',500,'jpy','pending',NOW()-interval '2 days',NOW())", [owner.id], db)
  const report = await auditOperations(db)
  assert.equal(report.counts.stale_pending_checkouts, 1)
  assert.deepEqual(report.warnings, ['stale_pending_checkouts'])
  assert.equal(JSON.stringify(report).includes(owner.email), false)
  const calls: string[] = []
  const client = { checkout: { sessions: {
    retrieve: async () => ({ id: 'cs_test_operations', status: 'open', livemode: false }),
    expire: async (id: string) => { calls.push(id); return { id, status: 'expired' } },
  } } } as unknown as PaymentStripeClient
  assert.deepEqual(await expirePendingForUser(owner.email, { db, client }), { status: 'ok', expired_count: 1 })
  assert.deepEqual(calls, ['cs_test_operations'])
  assert.equal((await query("SELECT status FROM payments WHERE user_id=$1", [owner.id], db))[0]!.status, 'expired')
  assert.deepEqual(await expirePendingForUser(owner.email, { db, client }), { status: 'ok', expired_count: 0 })
}))
