import { randomBytes } from 'node:crypto'

/** E2E never connects to the normal application database or a remote host. */
export function e2eSettings(env = process.env) {
  let maintenance
  try {
    maintenance = new URL(env.E2E_DATABASE_URL || '')
    if (!['postgres:', 'postgresql:'].includes(maintenance.protocol) ||
      !['localhost', '127.0.0.1', '[::1]', 'db'].includes(maintenance.hostname) ||
      !/^\/[a-z][a-z0-9_]{0,48}_test$/.test(maintenance.pathname) ||
      maintenance.search || maintenance.hash) throw new Error()
  } catch {
    throw new Error('E2E_DATABASE_URL must explicitly name a local PostgreSQL maintenance database ending in _test, without URL options.')
  }
  const port = env.E2E_PORT === undefined ? 3318 : Number(env.E2E_PORT)
  if (!Number.isSafeInteger(port) || port < 3200 || port > 65535) throw new Error('E2E_PORT must be an integer between 3200 and 65535.')
  return { maintenance, port, origin: `http://127.0.0.1:${port}` }
}

/** Both the generated DB identifier and secret are fresh for each server run. */
export function e2eDatabase(settings) {
  const name = `exam_e2e_${randomBytes(12).toString('hex')}_test`
  const url = new URL(settings.maintenance)
  url.pathname = `/${name}`
  return { name, url }
}

export function e2eServerEnvironment(settings, databaseUrl, inherited = process.env) {
  const env = { ...inherited }
  for (const key of Object.keys(env)) {
    if (/^(?:PG|DB_|POSTGRES_|STRIPE_|SENTRY_|ERROR_NOTIFICATION|NUXT_|NITRO_|SELLER_|EXAM_E2E_)/.test(key) ||
      ['DATABASE_URL', 'TEST_DATABASE_URL', 'BETTER_AUTH_SECRET', 'BETTER_AUTH_URL', 'CORS_ORIGINS', 'FRONTEND_URL',
        'NUXT_PUBLIC_API_BASE', 'NUXT_API_BASE_INTERNAL', 'MIGRATIONS_DIR', 'INPUT', 'CONFIRM', 'ADMIN_EMAIL',
        'ADMIN_NAME', 'ADMIN_PASSWORD', 'USER_EMAIL', 'EXPIRES_AT', 'GRANTED_BY', 'REASON', 'NODE_OPTIONS'].includes(key)) delete env[key]
  }
  return {
    ...env,
    APP_ENV: 'test', NODE_ENV: 'production', DATABASE_URL: databaseUrl,
    BETTER_AUTH_SECRET: randomBytes(48).toString('hex'),
    BETTER_AUTH_URL: settings.origin, FRONTEND_URL: settings.origin, CORS_ORIGINS: settings.origin,
    NUXT_PUBLIC_API_BASE: '', NUXT_API_BASE_INTERNAL: '',
    PAID_MEMBERSHIP_ENABLED: 'false', STRIPE_LIVEMODE: 'false', ERROR_NOTIFICATIONS_ENABLED: 'false',
    NITRO_HOST: '127.0.0.1', HOST: '127.0.0.1', NITRO_PORT: String(settings.port), PORT: String(settings.port),
  }
}
