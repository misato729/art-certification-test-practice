import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { ref } from 'vue'

const globals = globalThis as any
globals.defineNuxtRouteMiddleware = (guard: unknown) => guard
globals.navigateTo = (target: unknown) => target
const { default: guard } = await import('../app/middleware/auth.ts')
const { default: sessionGuard } = await import('../app/middleware/session.global.ts')
const { default: adminGuard } = await import('../app/middleware/admin.ts')

test('anonymous users return to the complete original URL after the session check', async () => {
  let checks = 0
  globals.useAuth = () => ({ ensureCurrentUser: async () => { checks += 1; return null } })
  for (const path of ['/history', '/favorites?page=2', '/account#profile', '/premium/complete?session_id=example']) {
    assert.deepEqual(await (guard as any)({ fullPath: path }), { path: '/login', query: { redirect: path } })
  }
  assert.equal(checks, 4)
})

test('protected navigation waits for a session before allowing a valid member', async () => {
  let resolve!: (value: unknown) => void
  let finished = false
  globals.useAuth = () => ({ ensureCurrentUser: () => new Promise(done => { resolve = done }) })
  const result = (guard as any)({ fullPath: '/favorites' }).then((value: unknown) => { finished = true; return value })
  await Promise.resolve()
  assert.equal(finished, false)
  resolve({ id: 1 })
  assert.equal(await result, undefined)
})

test('initial public navigation hydrates the server session without requiring login', async () => {
  let checks = 0
  globals.useAuth = () => ({ ensureCurrentUser: async () => { checks += 1; return null } })
  assert.equal(await (sessionGuard as any)(), undefined)
  assert.equal(checks, 1)
})

test('admin guard resolves identity before checking role', async () => {
  globals.useAuth = () => ({ ensureCurrentUser: async () => ({ id: 1, role: 'admin' }) })
  assert.equal(await (adminGuard as any)({ fullPath: '/admin/questions' }), undefined)
  globals.useAuth = () => ({ ensureCurrentUser: async () => ({ id: 1, role: 'user' }) })
  assert.deepEqual(await (adminGuard as any)({ fullPath: '/admin/questions' }), { path: '/admin/login', query: { redirect: '/admin/questions', reason: 'forbidden' } })
})

test('SSR documents containing a resolved application user cannot be shared or stored by caches', async () => {
  const source = readFileSync(new URL('../app/middleware/session.global.ts', import.meta.url), 'utf8').replaceAll('import.meta.server', 'true')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext } }).outputText
  const { default: serverGuard } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'))
  const cacheControl = ref<string | undefined>('public, max-age=300')
  globals.useResponseHeader = (name: string) => {
    assert.equal(name, 'Cache-Control')
    return cacheControl
  }
  let resolve!: (value: unknown) => void
  globals.useAuth = () => ({ ensureCurrentUser: () => new Promise(done => { resolve = done }) })
  const pending = serverGuard()
  assert.equal(cacheControl.value, 'public, max-age=300')
  resolve({ id: 1 })
  await pending
  assert.equal(cacheControl.value, 'private, no-store')

  cacheControl.value = 'public, max-age=300'
  globals.useAuth = () => ({ ensureCurrentUser: async () => null })
  await serverGuard()
  assert.equal(cacheControl.value, 'public, max-age=300')
})
