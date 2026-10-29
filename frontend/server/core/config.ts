import { EXAM_CONFIG, parseExamConfig, type ExamConfiguration } from '../../shared/examConfig.ts'

export let configuration = EXAM_CONFIG
export let paymentsEnabled = configuration.payments.enabled
export let freeExamMax = configuration.payments.free_exam_count
export const environment = () => process.env.APP_ENV || process.env.NODE_ENV || 'development'
export function setConfigurationForTesting(next: ExamConfiguration) {
  if (environment() !== 'test') throw new Error('Configuration injection is test-only')
  configuration = parseExamConfig(next)
  paymentsEnabled = configuration.payments.enabled
  freeExamMax = configuration.payments.free_exam_count
}
export function authSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET || ''
  if (secret.length < 64) throw new Error('BETTER_AUTH_SECRET must contain at least 64 characters')
  if (environment() === 'production' && /replace-with|change-this/.test(secret)) throw new Error('Configure an independent production secret')
  return secret
}

/** The public, same-origin URL is explicit; proxy/Host headers never choose it. */
export function authBaseURL(): string {
  const configured = process.env.BETTER_AUTH_URL
  if (!configured && environment() === 'production') throw new Error('BETTER_AUTH_URL is required in production')
  const value = configured || 'http://localhost:3100'
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || (environment() === 'production' && url.protocol !== 'https:') ||
      url.username || url.password || url.search || url.hash || value.includes('*') || url.pathname !== '/' || url.origin !== value.replace(/\/$/, '')) throw new Error()
    return url.origin
  } catch { throw new Error('BETTER_AUTH_URL must be an exact public origin (HTTPS in production)') }
}

export function authTrustedOrigins(): string[] {
  const base = authBaseURL()
  const origins = [base, ...(process.env.CORS_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean)]
  // Both explicit loopback names are useful locally; no wildcard origin is used.
  const local = new URL(base)
  if (environment() !== 'production' && ['localhost', '127.0.0.1'].includes(local.hostname)) {
    local.hostname = local.hostname === 'localhost' ? '127.0.0.1' : 'localhost'
    origins.push(local.origin)
  }
  for (const value of origins) {
    try {
      const url = new URL(value)
      if (!['http:', 'https:'].includes(url.protocol) || (environment() === 'production' && url.protocol !== 'https:') ||
        url.origin !== value || url.username || url.password || value.includes('*')) throw new Error()
    } catch { throw new Error('CORS_ORIGINS requires exact origins (HTTPS in production)') }
  }
  return [...new Set(origins)]
}
