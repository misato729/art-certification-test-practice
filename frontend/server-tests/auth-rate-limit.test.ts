import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { createApp, defineEventHandler, toNodeListener } from 'h3'
import { authRateLimitResponse, authRequest } from '../server/api/auth/[...all].ts'
import { AUTH_CLIENT_IP_HEADER, createAuth, type TemplateAuth } from '../server/core/better-auth.ts'
import type { Database } from '../server/core/db.ts'
import { RateLimiterUnavailableError } from '../server/core/rate-limit.ts'

const origin = 'http://localhost:3100'

async function withEnvironment<T>(values: Record<string, string | undefined>, action: () => Promise<T>): Promise<T> {
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

async function withAuth(action: (auth: TemplateAuth) => Promise<void>) {
  await withEnvironment({ APP_ENV: 'test', NODE_ENV: 'test', BETTER_AUTH_URL: origin,
    BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'), CORS_ORIGINS: '' }, async () => {
    // No database delegate is supplied: admission tests must finish before a
    // successful auth mutation can attempt to create a user or session.
    await action(createAuth({} as Database))
  })
}

function authPost(path: string) {
  return new Request(`${origin}/api/auth${path}`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json',
      [AUTH_CLIENT_IP_HEADER]: '198.51.100.4', 'X-Forwarded-For': '192.0.2.111' },
    body: '{}',
  })
}

test('Better Auth enables the shared standard storage hook in tests and limits only signup/login', async () => {
  await withAuth(async auth => {
    assert.equal(auth.options.rateLimit?.enabled, true)
    assert.equal(typeof auth.options.rateLimit?.customStorage?.consume, 'function')
    assert.deepEqual(auth.options.rateLimit?.customRules, {
      '/sign-up/email': { window: 900, max: 10 },
      '/sign-in/email': { window: 300, max: 30 },
      '/get-session': false,
      '/sign-out': false,
      '**': false,
    })
    assert.deepEqual(auth.options.advanced?.ipAddress?.ipAddressHeaders, [AUTH_CLIENT_IP_HEADER])
    assert.equal(auth.options.advanced?.ipAddress?.ipv6Subnet, 128)
    const calls: { key: string, rule: { window: number, max: number } }[] = []
    auth.options.rateLimit!.customStorage = {
      async consume(key, rule) { calls.push({ key, rule }); return { allowed: true, retryAfter: null } },
    }
    assert.equal((await auth.handler(authPost('/sign-up/email'))).status, 400)
    assert.equal((await auth.handler(authPost('/sign-in/email'))).status, 400)
    assert.deepEqual(calls, [
      { key: '198.51.100.4|/sign-up/email', rule: { window: 900, max: 10 } },
      { key: '198.51.100.4|/sign-in/email', rule: { window: 300, max: 30 } },
    ])
    assert.equal((await auth.handler(new Request(`${origin}/api/auth/get-session`))).status, 200)
    assert.equal((await auth.handler(authPost('/sign-out'))).status, 200)
    assert.equal(calls.length, 2, 'session reads and signout must not consume an additional default bucket')
  })
})

test('native Better Auth denial preserves the Japanese envelope and standard retry header', async () => {
  await withAuth(async auth => {
    auth.options.rateLimit!.customStorage = { async consume() { return { allowed: false, retryAfter: 23 } } }
    const native = await auth.handler(authPost('/sign-in/email'))
    assert.equal(native.status, 429)
    const response = authRateLimitResponse(native)
    assert.equal(response.headers.get('Retry-After'), '23')
    assert.equal(response.headers.get('Cache-Control'), 'no-store')
    assert.deepEqual(await response.json(), {
      code: 'rate_limit_exceeded', message: '操作が集中しています。しばらく待ってからお試しください',
    })
  })
})

test('native Better Auth propagates sanitized storage failure before auth mutation', async () => {
  await withAuth(async auth => {
    auth.options.rateLimit!.customStorage = { async consume() { throw new RateLimiterUnavailableError() } }
    await assert.rejects(auth.handler(authPost('/sign-up/email')), error => {
      assert.ok(error instanceof RateLimiterUnavailableError)
      assert.equal(error.status, 503)
      assert.equal(error.code, 'rate_limiter_unavailable')
      return true
    })
  })
})

test('the HTTP auth boundary replaces forged IP headers and trusts Fly only when configured', async () => {
  await withEnvironment({ FLY_APP_NAME: undefined }, async () => {
    const app = createApp()
    app.use(defineEventHandler(event => ({ address: authRequest(event).headers.get(AUTH_CLIENT_IP_HEADER) })))
    const server = createServer(toNodeListener(app))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    try {
      const headers = { [AUTH_CLIENT_IP_HEADER]: '198.51.100.123', 'X-Forwarded-For': '192.0.2.99', 'Fly-Client-IP': '203.0.113.8' }
      const direct = await fetch(base, { headers })
      assert.deepEqual(await direct.json(), { address: '127.0.0.1' })
      await withEnvironment({ FLY_APP_NAME: 'synthetic-auth-ip-test' }, async () => {
        const proxied = await fetch(base, { headers })
        assert.deepEqual(await proxied.json(), { address: '203.0.113.8' })
      })
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  })
})
