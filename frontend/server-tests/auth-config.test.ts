import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import { authBaseURL, authSecret, authTrustedOrigins, configuration } from '../server/core/config.ts'
import { createAuth, SESSION_LIFETIME } from '../server/core/better-auth.ts'
import { closeDatabase, isolatedTransaction, query, type Database } from '../server/core/db.ts'
import { migrate } from '../server/database/migrate.ts'

type Environment = Partial<Record<'APP_ENV' | 'NODE_ENV' | 'BETTER_AUTH_URL' | 'BETTER_AUTH_SECRET' | 'CORS_ORIGINS', string | undefined>>
async function withEnvironment<T>(values: Environment, action: () => T | Promise<T>): Promise<T> {
  const previous = new Map(Object.keys(values).map(key => [key, process.env[key]]))
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try { return await action() }
  finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

const origin = 'https://auth-template.example.invalid'
const integration = { skip: !process.env.TEST_DATABASE_URL }
const previousDatabaseURL = process.env.DATABASE_URL
const previousAppEnvironment = process.env.APP_ENV

before(async () => {
  if (integration.skip) return
  const testURL = process.env.TEST_DATABASE_URL!
  if (!decodeURIComponent(new URL(testURL).pathname.slice(1)).endsWith('_test')) throw new Error('An explicit isolated _test database is required')
  process.env.DATABASE_URL = testURL
  process.env.APP_ENV = 'test'
  await migrate()
})

after(async () => {
  await closeDatabase()
  if (previousDatabaseURL === undefined) delete process.env.DATABASE_URL
  else process.env.DATABASE_URL = previousDatabaseURL
  if (previousAppEnvironment === undefined) delete process.env.APP_ENV
  else process.env.APP_ENV = previousAppEnvironment
})

test('production authentication requires an explicit exact HTTPS origin', async () => {
  await withEnvironment({ APP_ENV: 'production', NODE_ENV: 'production', BETTER_AUTH_URL: undefined }, () => {
    assert.throws(authBaseURL, /required in production/)
  })
  for (const value of ['http://auth-template.example.invalid', '*', 'https://*.example.invalid', 'not-a-url',
    `${origin}/api/auth`, `${origin}?redirect=elsewhere`, `${origin}#fragment`,
    'https://name:synthetic@auth-template.example.invalid', `${origin}/?`, `${origin}/#`]) {
    await withEnvironment({ APP_ENV: 'production', BETTER_AUTH_URL: value }, () => {
      assert.throws(authBaseURL, /exact public origin/)
    })
  }
  for (const value of [origin, `${origin}/`]) {
    await withEnvironment({ APP_ENV: 'production', BETTER_AUTH_URL: value }, () => {
      assert.equal(authBaseURL(), origin)
    })
  }
})

test('production authentication rejects missing, short and template-placeholder secrets', async () => {
  for (const value of [undefined, '', 'x'.repeat(63), 'replace-with-an-independent-secret-'.repeat(3), 'change-this-before-publishing-'.repeat(3)]) {
    await withEnvironment({ APP_ENV: 'production', BETTER_AUTH_SECRET: value }, () => {
      assert.throws(authSecret, /BETTER_AUTH_SECRET|independent production secret/)
    })
  }
  const independent = randomBytes(48).toString('base64url')
  await withEnvironment({ APP_ENV: 'production', BETTER_AUTH_SECRET: independent }, () => {
    assert.ok(authSecret() === independent, 'the independent secret must be accepted')
  })
})

test('production trusted origins reject wildcards, credentials and malformed or insecure origins', async () => {
  for (const value of ['*', 'https://*.example.invalid', `${origin}/path`, `${origin}/`,
    'http://other.example.invalid', 'https://name:synthetic@other.example.invalid', 'not-a-url', `${origin}?query=1`]) {
    await withEnvironment({ APP_ENV: 'production', BETTER_AUTH_URL: origin, CORS_ORIGINS: value }, () => {
      assert.throws(authTrustedOrigins, /exact origins/)
    })
  }
  await withEnvironment({ APP_ENV: 'production', BETTER_AUTH_URL: origin,
    CORS_ORIGINS: ` ${origin},https://trusted.example.invalid,${origin} ` }, () => {
    assert.deepEqual(authTrustedOrigins(), [origin, 'https://trusted.example.invalid'])
  })
})

test('the official Prisma adapter maps auth fields and serial BigInt IDs without a database', async () => {
  const writes: { model: string, data: Record<string, unknown> }[] = []
  const reads: { model: string, where: unknown }[] = []
  const stored = new Map<string, Record<string, unknown>>()
  const delegate = (model: string, id: bigint) => ({
    async create({ data }: { data: Record<string, unknown> }) {
      writes.push({ model, data })
      const row = { ...data, id, ...('user_id' in data ? { user_id: BigInt(String(data.user_id)) } : {}) }
      stored.set(model, row)
      return row
    },
    async findFirst({ where }: { where: unknown }) {
      reads.push({ model, where })
      return stored.get(model) ?? null
    },
  })
  // A caller-owned Prisma transaction has model delegates and no $transaction.
  const database = { user: delegate('user', 41n), authAccount: delegate('authAccount', 42n),
    authSession: delegate('authSession', 43n) } as unknown as Database
  await withEnvironment({ APP_ENV: 'test', BETTER_AUTH_URL: 'http://localhost:3100',
    BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'), CORS_ORIGINS: '' }, async () => {
    const { adapter } = await createAuth(database).$context
    const now = new Date('2026-01-01T00:00:00Z')
    const user = await adapter.create<Record<string, unknown>>({ model: 'user', data: {
      name: 'Adapter test', email: 'adapter@example.invalid', emailVerified: true, createdAt: now, updatedAt: now,
    } })
    assert.equal(user.id, '41')
    assert.equal(user.emailVerified, true)
    assert.equal('email_verified' in user, false)
    assert.equal(writes[0]!.model, 'user')
    assert.equal(writes[0]!.data.email_verified, true)
    assert.equal(writes[0]!.data.created_at, now)
    assert.equal(writes[0]!.data.updated_at, now)
    assert.equal('emailVerified' in writes[0]!.data, false)

    const account = await adapter.create<Record<string, unknown>>({ model: 'account', data: {
      userId: user.id, providerId: 'credential', accountId: user.id, password: 'synthetic-adapter-hash', createdAt: now, updatedAt: now,
    } })
    assert.equal(account.id, '42')
    assert.equal(account.userId, '41')
    assert.equal(account.providerId, 'credential')
    assert.equal(writes[1]!.model, 'authAccount')
    assert.equal(writes[1]!.data.user_id, 41)
    assert.equal(writes[1]!.data.provider_id, 'credential')
    assert.equal(writes[1]!.data.account_id, '41')

    const expiresAt = new Date(now.getTime() + SESSION_LIFETIME * 1000)
    const session = await adapter.create<Record<string, unknown>>({ model: 'session', data: {
      userId: user.id, token: 'synthetic-adapter-token', expiresAt, ipAddress: '127.0.0.1', userAgent: 'Adapter test', createdAt: now, updatedAt: now,
    } })
    assert.equal(session.id, '43')
    assert.equal(session.userId, '41')
    assert.equal(session.expiresAt, expiresAt)
    assert.equal(writes[2]!.model, 'authSession')
    assert.equal(writes[2]!.data.user_id, 41)
    assert.equal(writes[2]!.data.expires_at, expiresAt)
    assert.equal(writes[2]!.data.ip_address, '127.0.0.1')
    assert.equal(writes[2]!.data.user_agent, 'Adapter test')
    assert.ok(writes.every(write => !('id' in write.data)), 'serial IDs must be generated by the database')

    const found = await adapter.findOne<Record<string, unknown>>({ model: 'session', where: [{ field: 'userId', value: user.id }] })
    assert.equal(found?.id, '43')
    assert.equal(found?.userId, '41')
    assert.equal(reads[0]!.model, 'authSession')
    assert.deepEqual(reads[0]!.where, { user_id: { equals: 41 } })
  })
})

test('native HTTPS signup issues a site-scoped secure HttpOnly database session without accepting an admin role', integration, async () => {
  let userId: number | undefined
  await isolatedTransaction(async database => {
    await query("SET LOCAL lock_timeout='10s'", [], database)
    await withEnvironment({ APP_ENV: 'production', NODE_ENV: 'production', BETTER_AUTH_URL: origin,
      BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'), CORS_ORIGINS: '' }, async () => {
      // This factory is confined to the caller-owned transaction. Never use or
      // mutate the process-wide getAuth() singleton for synthetic production URLs.
      const auth = createAuth(database)
      const response = await auth.handler(new Request(`${origin}/api/auth/sign-up/email`, {
        method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
        body: JSON.stringify({ name: 'Production auth test', email: `auth-config-${randomUUID()}@example.invalid`,
          password: randomBytes(24).toString('base64url'), role: 'admin' }),
    }))
    assert.equal(response.status, 200)
    const result = await response.json() as { user: { id: string | number, role: string } }
    userId = Number(result.user.id)
    assert.equal(result.user.role, 'user')
    const [user] = await query<{ role: string }>('SELECT role FROM users WHERE id=$1', [Number(result.user.id)], database)
    assert.equal(user?.role, 'user')

    const cookies = response.headers.getSetCookie()
    const sessionCookie = cookies.find(cookie => cookie.slice(0, cookie.indexOf('=')).endsWith('.session_token'))
    assert.ok(sessionCookie, 'signup must set a session cookie')
    const [pair, ...attributes] = sessionCookie.split(';').map(value => value.trim())
    const cookieName = pair!.slice(0, pair!.indexOf('='))
    assert.equal(cookieName, `__Secure-${configuration.site.id}-auth.session_token`)
    const normalized = new Set(attributes.map(value => value.toLowerCase()))
    // Never pass the full cookie to an assertion: failure output must not print it.
    for (const attribute of ['secure', 'httponly', 'samesite=lax', 'path=/']) {
      assert.ok(normalized.has(attribute), `session cookie must include ${attribute}`)
    }
    assert.ok(normalized.has(`max-age=${SESSION_LIFETIME}`), 'cookie lifetime must remain 24 hours')
    assert.ok(!attributes.some(value => /^domain=/i.test(value)), 'session cookie must remain host-only')
    assert.ok(!cookies.some(cookie => cookie.slice(0, cookie.indexOf('=')).endsWith('.session_data')), 'session identity must not be cached in a cookie')

    const cookieHeader = cookies.map(cookie => cookie.split(';')[0]).join('; ')
    const sessionResponse = await auth.handler(new Request(`${origin}/api/auth/get-session`, { headers: { Cookie: cookieHeader } }))
    assert.equal(sessionResponse.status, 200)
    const session = await sessionResponse.json() as { user: { id: string | number }, session: { id: string | number } }
    assert.ok(Number(session.user.id) === Number(result.user.id), 'the cookie must authenticate its registered user')
    const [stored] = await query<{ user_id: number, lifetime_seconds: number }>(
      'SELECT user_id,EXTRACT(EPOCH FROM expires_at-created_at)::double precision AS lifetime_seconds FROM auth_sessions WHERE id=$1',
      [Number(session.session.id)], database)
    assert.ok(stored?.user_id === Number(result.user.id), 'the session must be persisted for its user')
    assert.ok(Math.abs(stored!.lifetime_seconds - SESSION_LIFETIME) < 2, 'database session lifetime must remain 24 hours')
    })
  })
  assert.equal((await query('SELECT id FROM users WHERE id=$1', [userId])).length, 0, 'auth fixtures must be removed by rollback')
})
