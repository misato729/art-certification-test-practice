import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

// Inject backend dependencies so this regression never connects to a database.
async function readiness(prerender: boolean) {
  const source = readFileSync(new URL('../server/plugins/readiness.ts', import.meta.url), 'utf8')
    .replace(/^import .*$/gm, '')
    .replaceAll('import.meta.prerender', String(prerender))
    .replace('export default defineNitroPlugin', 'return defineNitroPlugin')
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ESNext } }).outputText
  const calls: string[] = []
  const hooks: Record<string, () => Promise<void>> = {}
  const plugin = new Function('defineNitroPlugin', 'authSecret', 'authBaseURL', 'authTrustedOrigins', 'allowedOrigins', 'getDatabase', 'closeRateLimitStore', 'closeDatabase', compiled)(
    (callback: unknown) => callback,
    () => calls.push('secret'), () => calls.push('url'), () => calls.push('trusted'), () => calls.push('origins'),
    () => ({ $queryRaw: async () => calls.push('database') }),
    async () => { calls.push('close-rate-limit') }, async () => { calls.push('close-database') },
  )
  await plugin({ hooks: { hook: (name: string, callback: () => Promise<void>) => { hooks[name] = callback } } })
  return { calls, hooks }
}

test('static generation does not initialize backend secrets, databases, or pools', async () => {
  const { calls, hooks } = await readiness(true)
  assert.deepEqual(calls, [])
  assert.deepEqual(Object.keys(hooks), [])
})

test('runtime readiness still validates backend configuration and closes both pools', async () => {
  const { calls, hooks } = await readiness(false)
  assert.deepEqual(calls, ['secret', 'url', 'trusted', 'origins', 'database'])
  await hooks.close!()
  assert.deepEqual(calls.slice(-2), ['close-rate-limit', 'close-database'])
})
