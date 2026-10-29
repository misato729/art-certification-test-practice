import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import test from 'node:test'

const globals = globalThis as any
globals.defineNuxtConfig = (config: unknown) => config
const { default: config } = await import('../nuxt.config.ts')

test('frontend access does not require Basic authentication', () => {
  assert.equal(existsSync(new URL('../server/middleware/basic-auth.ts', import.meta.url)), false)
  assert.equal(Object.hasOwn(config.runtimeConfig, 'basicAuthUser'), false)
  assert.equal(Object.hasOwn(config.runtimeConfig, 'basicAuthPassword'), false)
})

test('learning and account routes keep their rendering and indexing rules', () => {
  const routes = config.routeRules as Record<string, { ssr?: boolean, headers?: Record<string, string> }>
  for (const path of ['/practice/**', '/history', '/favorites', '/account', '/premium/complete', '/admin/**']) {
    assert.equal(routes[path]?.ssr, false, path)
    assert.equal(routes[path]?.headers?.['X-Robots-Tag'], 'noindex, nofollow', path)
  }
  for (const path of ['/', '/exam-overview', '/terms', '/privacy-policy']) {
    assert.notEqual(routes[path]?.ssr, false, path)
  }
  for (const path of ['/login', '/signup']) {
    assert.equal(routes[path]?.headers?.['X-Robots-Tag'], 'noindex, nofollow', path)
  }
})


test('the integrated API uses the same origin unless an explicit base is configured', () => {
  assert.equal(config.runtimeConfig.public.apiBase, process.env.NUXT_PUBLIC_API_BASE || '')
})
