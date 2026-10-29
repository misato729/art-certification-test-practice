import assert from 'node:assert/strict'
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { after, before, test, type TestContext } from 'node:test'
import pg from 'pg'
import { closeDatabase, getDatabase } from '../server/core/db.ts'
import { createRateLimitStore, RateLimiterUnavailableError, rules } from '../server/core/rate-limit.ts'
import { migrate } from '../server/database/migrate.ts'

const secret = randomBytes(48).toString('base64url')
function useSecret(context: TestContext) {
  const previous = process.env.BETTER_AUTH_SECRET
  process.env.BETTER_AUTH_SECRET = secret
  context.after(() => {
    if (previous === undefined) delete process.env.BETTER_AUTH_SECRET
    else process.env.BETTER_AUTH_SECRET = previous
  })
}
type Statement = { text: string, values?: unknown[] }
function scriptedClient(points: number[]) {
  const statements: Statement[] = []
  const client = { async query(statement: Statement) {
    statements.push(statement)
    if (/^\s*DELETE/.test(statement.text)) return { rows: [], rowCount: 0 }
    assert.match(statement.text, /INSERT INTO "test_scope"\."rate_limiter_flexible"/)
    assert.match(statement.text, /ON CONFLICT\(key\) DO UPDATE/)
    assert.match(statement.text, /\.points \+ \(\$2\)/)
    assert.ok(points.length > 0, 'the official adapter must perform only the expected consumes')
    return { rows: [{ points: points.shift()!, expire: statement.values![2] }], rowCount: 1 }
  } } as unknown as Pick<pg.Pool, 'query'>
  return { client, statements, writes: () => statements.filter(statement => /^\s*INSERT/.test(statement.text)) }
}
function expectedKey(scope: string, subject: string, period: number, now = Date.now()) {
  const start = Math.floor(now / 1000 / period) * period
  return createHmac('sha256', secret).update(['api-rate-limit-v1', scope, subject, start].join('\0')).digest('hex')
}

test('the official adapter enforces each configured boundary with private migrated keys', async context => {
  useSecret(context)
  const now = Date.UTC(2026, 9, 24, 12, 34, 25, 250)
  context.mock.timers.enable({ apis: ['Date'], now })
  for (const scope of Object.keys(rules) as (keyof typeof rules)[]) {
    const rule = rules[scope]
    const fixture = scriptedClient([rule.limit, rule.limit + 1])
    const store = createRateLimitStore(fixture.client, 'test_scope')
    const subject = '2001:db8::74'
    const first = await store.consumeRateLimit(scope, subject)
    const denied = await store.consumeRateLimit(scope, subject)
    const boundary = (Math.floor(now / 1000 / rule.period) + 1) * rule.period * 1000
    assert.deepEqual(first, { allowed: true, retryAfter: Math.ceil((boundary - now) / 1000) })
    assert.deepEqual(denied, { allowed: false, retryAfter: first.retryAfter })
    assert.equal(fixture.writes().length, 2)
    for (const statement of fixture.writes()) {
      assert.equal(statement.values![0], expectedKey(scope, subject, rule.period))
      assert.equal(statement.values![1], 1)
      assert.equal(statement.values![2], boundary)
    }
    assert.equal(JSON.stringify(fixture.statements).includes(subject), false)
    assert.equal(JSON.stringify(fixture.statements).includes(secret), false)
  }
})

test('wall-clock window rollover changes the key and retains the original aligned expiry', async context => {
  useSecret(context)
  const boundary = Date.UTC(2026, 9, 24, 12, 35)
  context.mock.timers.enable({ apis: ['Date'], now: boundary - 250 })
  const fixture = scriptedClient([31, 1])
  const store = createRateLimitStore(fixture.client, 'test_scope')
  assert.deepEqual(await store.consumeRateLimit('login', '198.51.100.10'), { allowed: false, retryAfter: 1 })
  context.mock.timers.setTime(boundary)
  assert.deepEqual(await store.consumeRateLimit('login', '198.51.100.10'), { allowed: true, retryAfter: 300 })
  const writes = fixture.writes()
  assert.notEqual(writes[0]!.values![0], writes[1]!.values![0])
  assert.equal(writes[0]!.values![2], boundary)
  assert.equal(writes[1]!.values![2], boundary + 300_000)
})

test('Better Auth consumes share migrated registration and login buckets and return seconds', async context => {
  useSecret(context)
  context.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 24, 12, 34, 25, 250) })
  for (const [scope, path] of [['signup', '/sign-up/email'], ['login', '/sign-in/email']] as const) {
    const rule = rules[scope]
    const fixture = scriptedClient([rule.limit, rule.limit + 1])
    const store = createRateLimitStore(fixture.client, 'test_scope')
    const subject = '198.51.100.20'
    const first = await store.consumeRateLimit(scope, subject)
    const denied = await store.consumeAuthRateLimit(`${subject}|${path}`, { max: rule.limit, window: rule.period })
    assert.deepEqual(denied, { allowed: false, retryAfter: first.retryAfter })
    assert.equal(fixture.writes()[0]!.values![0], fixture.writes()[1]!.values![0])
  }
  const fixture = scriptedClient([1])
  const store = createRateLimitStore(fixture.client, 'test_scope')
  assert.deepEqual(await store.consumeAuthRateLimit('2001:db8::20|/sign-in/email', { max: 30, window: 300 }), { allowed: true, retryAfter: null })
})

test('database failures become sanitized 503 errors rather than rate-limit rejections', async context => {
  useSecret(context)
  const sensitive = 'synthetic connection detail and 198.51.100.30'
  for (const failure of [new Error(sensitive), { msBeforeNext: 1000, message: sensitive }]) {
    const client = { query: async () => { throw failure } } as unknown as Pick<pg.Pool, 'query'>
    const store = createRateLimitStore(client)
    await assert.rejects(store.consumeAuthRateLimit('198.51.100.30|/sign-in/email', { max: 30, window: 300 }), error => {
      assert.ok(error instanceof RateLimiterUnavailableError)
      assert.equal(error.status, 503)
      assert.equal(error.code, 'rate_limiter_unavailable')
      assert.equal(error.message, '一時的に操作できません。しばらく待ってからお試しください')
      assert.equal(error.expectedUnavailability, false)
      assert.equal(error.cause, undefined)
      assert.equal(error.details, undefined)
      assert.equal(String(error.stack).includes(sensitive), false)
      return true
    })
  }
})

test('schema identifiers are validated before the official adapter can interpolate them', () => {
  const fixture = scriptedClient([])
  assert.throws(() => createRateLimitStore(fixture.client, 'public"; SELECT 1;--'), /Unsupported database schema name/)
  assert.equal(fixture.statements.length, 0)
})

const testUrl = process.env.TEST_DATABASE_URL
const integration = { skip: !testUrl }
const previousDatabaseURL = process.env.DATABASE_URL
const previousEnvironment = process.env.APP_ENV
before(async () => {
  if (!testUrl) return
  if (!/^\/[A-Za-z0-9_]+_test$/.test(new URL(testUrl).pathname)) throw new Error('An explicitly isolated _test database is required')
  process.env.DATABASE_URL = testUrl
  process.env.APP_ENV = 'test'
  await migrate()
})
after(async () => {
  await closeDatabase()
  if (previousDatabaseURL === undefined) delete process.env.DATABASE_URL
  else process.env.DATABASE_URL = previousDatabaseURL
  if (previousEnvironment === undefined) delete process.env.APP_ENV
  else process.env.APP_ENV = previousEnvironment
})

test('PostgreSQL counters are atomic across instances, survive reconnection and use the Prisma-managed schema', integration, async context => {
  useSecret(context)
  const url = new URL(testUrl!)
  const schema = url.searchParams.get('schema') || 'public'
  url.searchParams.delete('schema')
  const pools = [new pg.Pool({ connectionString: url.toString(), max: 2 }), new pg.Pool({ connectionString: url.toString(), max: 2 })]
  const subject = `198.51.100.40-${randomUUID()}`
  const storeA = createRateLimitStore(pools[0]!, schema)
  const storeB = createRateLimitStore(pools[1]!, schema)
  // Keep calls inside one window even when the test begins at its last instant.
  const now = Math.floor(Date.now() / 300_000) * 300_000 + 1000
  context.mock.timers.enable({ apis: ['Date'], now })
  const key = expectedKey('login', subject, 300)
  try {
    const results = await Promise.all(Array.from({ length: 45 }, (_, index) => (index % 2 ? storeA : storeB).consumeRateLimit('login', subject)))
    assert.equal(results.filter(result => result.allowed).length, 30)
    assert.ok(results.every(result => result.retryAfter > 0 && result.retryAfter <= 300))
    const row = await getDatabase().rateLimiterFlexible.findUniqueOrThrow({ where: { key } })
    assert.equal(row.points, 45)
    assert.equal(row.expire, BigInt(now + 299_000))
    assert.match(row.key, /^[a-f0-9]{64}$/)
    assert.equal(row.key.includes(subject), false)
    await pools.shift()!.end()
    const reconnected = new pg.Pool({ connectionString: url.toString(), max: 2 })
    pools.push(reconnected)
    assert.equal((await createRateLimitStore(reconnected, schema).consumeRateLimit('login', subject)).allowed, false)
    assert.equal((await getDatabase().rateLimiterFlexible.findUniqueOrThrow({ where: { key } })).points, 46)
  } finally {
    await Promise.all(pools.map(pool => pool.end()))
    await getDatabase().rateLimiterFlexible.deleteMany({ where: { key } })
  }
})
