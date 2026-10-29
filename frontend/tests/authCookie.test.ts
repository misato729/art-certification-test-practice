import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const globals = globalThis as any
globals.defineNuxtPlugin = (plugin: any) => typeof plugin === 'function' ? plugin : plugin.setup
globals.useRequestURL = () => new URL('https://exam.example.invalid')
const { default: setupClient } = await import('../app/plugins/auth-client.ts')

test('Better Auth Vue client uses native endpoints and credentialed requests', async () => {
  const original = globalThis.fetch
  const calls: { path: string, credentials: string | undefined, body: unknown }[] = []
  try {
    globalThis.fetch = async (input, options) => {
      calls.push({ path: String(input), credentials: options?.credentials, body: JSON.parse(String(options?.body || '{}')) })
      return new Response(JSON.stringify({ user: { id: '1', name: 'Test' }, success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    const client = (setupClient as any)().provide.authClient
    await client.signIn.email({ email: 'test@example.invalid', password: 'test-password' })
    await client.signUp.email({ name: 'Test', email: 'test@example.invalid', password: 'test-password' })
    await client.signOut()
    assert.deepEqual(calls.map(call => new URL(call.path).pathname), ['/api/auth/sign-in/email', '/api/auth/sign-up/email', '/api/auth/sign-out'])
    assert.equal(calls.every(call => call.credentials === 'include'), true)
    assert.deepEqual(calls[0]!.body, { email: 'test@example.invalid', password: 'test-password' })
  } finally { globalThis.fetch = original }
})

test('request-scoped auth clients do not inherit another SSR request origin', async () => {
  const original = globalThis.fetch
  const calls: string[] = []
  try {
    globalThis.fetch = async input => {
      calls.push(String(input))
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    globals.useRequestURL = () => new URL('https://first.example.invalid')
    const first = (setupClient as any)().provide.authClient
    globals.useRequestURL = () => new URL('https://second.example.invalid')
    const second = (setupClient as any)().provide.authClient
    await first.signOut(); await second.signOut()
    assert.deepEqual(calls.map(call => new URL(call).origin), ['https://first.example.invalid', 'https://second.example.invalid'])
  } finally { globalThis.fetch = original }
})

test('browser auth state does not serialize credentials or favorites into readable cookies', () => {
  const source = readFileSync(new URL('../app/composables/useAuth.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /useCookie|localStorage|sessionStorage|document\.cookie|Authorization|access_token/)
  assert.match(source, /isLoggedIn = computed\(\(\) => user\.value !== null\)/)
  const api = readFileSync(new URL('../app/plugins/api.ts', import.meta.url), 'utf8')
  assert.match(api, /headers: import\.meta\.server \? useRequestHeaders\(\['cookie'\]\)/)
})
