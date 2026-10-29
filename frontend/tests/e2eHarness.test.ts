import test from 'node:test'
import assert from 'node:assert/strict'
import { e2eSettings, e2eDatabase, e2eServerEnvironment } from '../scripts/e2e-settings.mjs'
import { e2eBuildConfiguration, e2eBuildPaths } from '../scripts/e2e-build.mjs'

const valid = { E2E_DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:55439/isolated_test' }

test('E2E requires an explicit local test maintenance database and separate port', () => {
  for (const env of [ {}, { DATABASE_URL: valid.E2E_DATABASE_URL },
    { E2E_DATABASE_URL: 'postgresql://remote.example/isolated_test' },
    { E2E_DATABASE_URL: 'postgresql://localhost/exam_practice_development' },
    { E2E_DATABASE_URL: 'postgresql://localhost/isolated_test?host=remote.example' },
    { ...valid, E2E_PORT: '3100' }, { ...valid, E2E_PORT: '3318.5' }, { ...valid, E2E_PORT: '70000' },
  ]) assert.throws(() => e2eSettings(env))
  assert.equal(e2eSettings(valid).origin, 'http://127.0.0.1:3318')
  const first = e2eDatabase(e2eSettings(valid))
  const second = e2eDatabase(e2eSettings(valid))
  assert.match(first.name, /^exam_e2e_[a-f0-9]{24}_test$/)
  assert.notEqual(first.name, second.name)
  assert.notEqual(first.url.pathname, '/isolated_test')
})

test('E2E child environment overrides credentials, app URLs and external effects', () => {
  const settings = e2eSettings(valid)
  const database = e2eDatabase(settings)
  const env = e2eServerEnvironment(settings, database.url.toString(), {
    DATABASE_URL: 'postgresql://remote.example/live', PGHOST: 'remote.example', DB_NAME: 'live',
    PGPASSWORD: 'not-used', POSTGRES_PASSWORD: 'not-used', STRIPE_SECRET_KEY: 'not-used', SENTRY_ERROR_DSN: 'not-used',
    NUXT_PUBLIC_API_BASE: 'https://remote.example', NUXT_API_BASE_INTERNAL: 'https://remote.example',
    NUXT_PUBLIC_UNEXPECTED: 'not-used', NITRO_PRESET: 'not-used',
    PAID_MEMBERSHIP_ENABLED: 'true', ERROR_NOTIFICATIONS_ENABLED: 'true',
    APP_ENV: 'production', BETTER_AUTH_URL: 'https://remote.example', BETTER_AUTH_SECRET: 'not-used',
    NODE_OPTIONS: '--require=not-used', MIGRATIONS_DIR: '/not-used',
  })
  assert.equal(env.DATABASE_URL, database.url.toString())
  assert.equal(env.APP_ENV, 'test')
  assert.equal(env.BETTER_AUTH_URL, settings.origin)
  assert.equal(env.NUXT_PUBLIC_API_BASE, '')
  assert.equal(env.PAID_MEMBERSHIP_ENABLED, 'false')
  assert.equal(env.ERROR_NOTIFICATIONS_ENABLED, 'false')
  assert.match(env.BETTER_AUTH_SECRET, /^[a-f0-9]{96}$/)
  for (const key of ['PGHOST', 'DB_NAME', 'PGPASSWORD', 'POSTGRES_PASSWORD', 'STRIPE_SECRET_KEY', 'SENTRY_ERROR_DSN', 'NODE_OPTIONS', 'MIGRATIONS_DIR', 'NUXT_PUBLIC_UNEXPECTED', 'NITRO_PRESET']) assert.equal(env[key], undefined)
})

test('E2E build output is confined to a generated directory and leaves normal builds unchanged', () => {
  assert.deepEqual(e2eBuildConfiguration({ APP_ENV: 'production' }), {})
  assert.deepEqual(e2eBuildConfiguration({ APP_ENV: 'development' }), {})
  for (const env of [
    { APP_ENV: 'production', EXAM_E2E_RUN_ID: 'a'.repeat(24) },
    { APP_ENV: 'test', EXAM_E2E_RUN_ID: '../../outside' },
    { APP_ENV: 'test', EXAM_E2E_RUN_ID: '/tmp/outside' },
  ]) assert.throws(() => e2eBuildPaths(env))
  const paths = e2eBuildPaths({ APP_ENV: 'test', EXAM_E2E_RUN_ID: 'a'.repeat(24) })!
  assert.match(paths.root, /\/frontend\/\.e2e-build\/a{24}\/$/)
  assert.equal(e2eBuildConfiguration({ APP_ENV: 'test', EXAM_E2E_RUN_ID: 'a'.repeat(24) }).buildDir, paths.build)
  assert.match(paths.server, /\/\.e2e-build\/a{24}\/\.output\/server\/index.mjs$/)
})
