import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { after, before, test } from 'node:test'
import { toNodeListener } from 'h3'
import { createApiTestApp } from './helpers/api-app.ts'
import { closeDatabase } from '../server/core/db.ts'

process.env.APP_ENV = 'test'
process.env.BETTER_AUTH_SECRET = 'synthetic-routing-test-' + randomUUID() + randomUUID()
process.env.BETTER_AUTH_URL ||= 'http://localhost:3100'
let server: Server
let base: string
before(async () => {
  server = createServer(toNodeListener(await createApiTestApp()))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`
})
after(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  await closeDatabase()
})
const request = (path: string, init?: RequestInit) => fetch(base + path, init)

test('Nitro native method routes preserve GET, HEAD, trailing slash and no-store', async () => {
  for (const path of ['/health', '/health/']) {
    const get = await request(path)
    assert.equal(get.status, 200)
    assert.equal((await get.json()).status, 'ok')
    assert.equal(get.headers.get('cache-control'), 'no-store')
    const head = await request(path, { method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.equal(head.headers.get('cache-control'), 'no-store')
    assert.equal(await head.text(), '')
  }
})

test('native matching rejects extra segments, repeated separators and unsupported methods with the API envelope', async () => {
  for (const path of ['', '/', '/missing', '/health/extra', '/questions/next/extra', '/questions//next']) {
    const response = await request(path)
    assert.equal(response.status, 404, path)
    assert.deepEqual(await response.json(), { error: { code: 'not_found', message: '対象が見つかりません' } })
  }
  const response = await request('/health', { method: 'POST', headers: { Origin: process.env.BETTER_AUTH_URL!, 'Content-Type': 'application/json' }, body: '{}' })
  assert.equal(response.status, 404)
  assert.equal((await response.json()).error.code, 'not_found')
})

test('preflight and CSRF/JSON checks also cover fallback routes', async () => {
  const preflight = await request('/missing', { method: 'OPTIONS', headers: { Origin: process.env.BETTER_AUTH_URL! } })
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true')
  assert.equal(await preflight.text(), '')
  const foreign = await request('/missing', { method: 'POST', headers: { Origin: 'https://foreign.invalid' } })
  assert.equal(foreign.status, 403)
  assert.equal((await foreign.json()).error.code, 'forbidden')
  const form = await request('/missing', { method: 'POST', headers: { Origin: process.env.BETTER_AUTH_URL!, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'value=synthetic' })
  assert.equal(form.status, 415)
  assert.equal((await form.json()).error.code, 'unsupported_media_type')
})

test('dynamic parameters are validated by the target operation and admin fallbacks still require a session', async () => {
  const invalid = await request('/questions/not-an-id')
  assert.equal(invalid.status, 404)
  assert.equal((await invalid.json()).error.code, 'not_found')
  const history = await request('/answer_histories/not-an-id')
  assert.equal(history.status, 404)
  const favorite = await request('/questions/not-an-id/favorite', { method: 'PUT', headers: { Origin: process.env.BETTER_AUTH_URL! } })
  assert.equal(favorite.status, 404)
  const anonymousFavorite = await request('/questions/1/favorite', { method: 'PUT', headers: { Origin: process.env.BETTER_AUTH_URL! } })
  assert.equal(anonymousFavorite.status, 401)
  const admin = await request('/admin/questions/unknown/extra')
  assert.equal(admin.status, 401)
  assert.equal((await admin.json()).error.code, 'unauthorized')
})

test('hierarchy endpoints retain administrator authentication and mutation origin boundaries', async () => {
  for (const [path, method] of [['/admin/exams', 'GET'], ['/admin/exams/1', 'PATCH'], ['/admin/exams/1/groups', 'POST'],
    ['/admin/exams/1/validate', 'POST'], ['/admin/exams/1/publish', 'POST'], ['/admin/question_groups/1', 'GET'],
    ['/admin/question_groups/1', 'PUT'], ['/admin/question_groups/1', 'DELETE']]) {
    const response = await request(path!, { method, headers: { Origin: process.env.BETTER_AUTH_URL!, 'Content-Type': 'application/json' }, ...(method !== 'GET' ? { body: '{}' } : {}) })
    assert.equal(response.status, 401, `${method} ${path}`)
    assert.equal((await response.json()).error.code, 'unauthorized')
  }
  const foreign = await request('/admin/question_groups/1', { method: 'PUT', headers: { Origin: 'https://foreign.invalid', 'Content-Type': 'application/json' }, body: '{}' })
  assert.equal(foreign.status, 403)
})
