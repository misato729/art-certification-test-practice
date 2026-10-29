import { createHmac } from 'node:crypto'
import { isIP } from 'node:net'
import pg from 'pg'
import { getHeader, setHeader, type H3Event } from 'h3'
import { RateLimiterPostgres, RateLimiterRes } from 'rate-limiter-flexible'
import { authSecret } from './config.ts'
import { databaseURL } from './database-url.ts'
import { ApiError, fail } from './errors.ts'

export const rules = {
  signup: { limit: 10, period: 900 }, login: { limit: 30, period: 300 },
  checkout_ip: { limit: 20, period: 300 }, checkout_user: { limit: 10, period: 300 },
  answer: { limit: 120, period: 60 },
} as const
export type RateScope = keyof typeof rules
type AuthRule = { window: number, max: number }
type Result = { allowed: boolean, retryAfter: number }
// The public cleanup method is present in 11.2.3 but omitted from its types.
type PostgresLimiter = RateLimiterPostgres & { clearExpired(expire: number): Promise<void> }

export class RateLimiterUnavailableError extends ApiError {
  constructor() {
    super(503, 'rate_limiter_unavailable', '一時的に操作できません。しばらく待ってからお試しください')
    this.name = 'RateLimiterUnavailableError'
  }
}

export function clientAddress(event: H3Event) {
  // Never trust arbitrary proxy headers from an unconfigured deployment.
  const address = (process.env.FLY_APP_NAME ? getHeader(event, 'fly-client-ip') : undefined) || event.node.req.socket.remoteAddress || 'unknown'
  return isIP(address) ? address.replace(/^::ffff:/, '') : 'unknown'
}

/** Inject a caller-owned pg client for tests or another application instance. */
export function createRateLimitStore(storeClient: Pick<pg.Pool, 'query'>, schemaName = 'public') {
  // The adapter quotes identifiers but does not escape embedded quotes.
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schemaName)) throw new Error('Unsupported database schema name')
  const limiters = new Map<string, PostgresLimiter>()

  async function consume(scope: string, subject: string, rule: AuthRule, namespace = 'api-rate-limit-v1'): Promise<Result> {
    try {
      const identifier = `${rule.max}:${rule.window}`
      let limiter = limiters.get(identifier)
      if (!limiter) {
        limiter = new RateLimiterPostgres({ storeClient, storeType: 'pool', tableName: 'rate_limiter_flexible', schemaName,
          tableCreated: true, clearExpiredByTimeout: false, keyPrefix: '', points: rule.max, duration: rule.window }) as PostgresLimiter
        limiters.set(identifier, limiter)
      }
      const now = Date.now()
      const start = Math.floor(now / 1000 / rule.window) * rule.window
      const secondsToBoundary = ((start + rule.window) * 1000 - now) / 1000
      // Preserve migrated bucket keys and wall-clock windows; no IP reaches SQL.
      const key = createHmac('sha256', authSecret()).update([namespace, scope, subject, start].join('\0')).digest('hex')
      await limiter.clearExpired(now)
      const result = await limiter.consume(key, 1, { customDuration: secondsToBoundary })
      return { allowed: true, retryAfter: Math.max(1, Math.ceil(result.msBeforeNext / 1000)) }
    } catch (error) {
      if (error instanceof RateLimiterRes) return { allowed: false, retryAfter: Math.max(1, Math.ceil(error.msBeforeNext / 1000)) }
      // Never forward the driver's message, key, subject or connection details.
      throw new RateLimiterUnavailableError()
    }
  }

  return {
    consumeRateLimit(scope: RateScope, subject: string) {
      const rule = rules[scope]
      return consume(scope, subject, { max: rule.limit, window: rule.period })
    },
    async consumeAuthRateLimit(key: string, rule: AuthRule): Promise<{ allowed: boolean, retryAfter: number | null }> {
      const separator = key.lastIndexOf('|')
      const path = key.slice(separator + 1)
      const scope = path === '/sign-up/email' ? 'signup' : path === '/sign-in/email' ? 'login' : undefined
      const compatible = scope && rule.max === rules[scope].limit && rule.window === rules[scope].period
      const result = compatible && separator > 0
        ? await consume(scope, key.slice(0, separator), rule)
        : await consume(`${rule.max}:${rule.window}`, key, rule, 'auth-rate-limit-v1')
      return { allowed: result.allowed, retryAfter: result.allowed ? null : result.retryAfter }
    },
  }
}

let pool: pg.Pool | undefined
let store: ReturnType<typeof createRateLimitStore> | undefined
function getStore() {
  if (!store) {
    const url = new URL(databaseURL())
    const schema = url.searchParams.get('schema') || 'public'
    url.searchParams.delete('schema')
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) throw new RateLimiterUnavailableError()
    pool = new pg.Pool({ connectionString: url.toString(), max: 2, connectionTimeoutMillis: 1000,
      statement_timeout: 1000, query_timeout: 1000, allowExitOnIdle: true })
    // Idle connection errors must not escape as uncaught errors or expose data.
    pool.on('error', () => {})
    store = createRateLimitStore(pool, schema)
  }
  return store
}
export async function closeRateLimitStore() {
  const closing = pool
  pool = undefined
  store = undefined
  if (closing) await closing.end()
}
export async function consumeRateLimit(scope: RateScope, subject: string): Promise<Result> {
  try { return await getStore().consumeRateLimit(scope, subject) }
  catch (error) { if (error instanceof RateLimiterUnavailableError) throw error; throw new RateLimiterUnavailableError() }
}
export async function consumeAuthRateLimit(key: string, rule: AuthRule): Promise<{ allowed: boolean, retryAfter: number | null }> {
  try { return await getStore().consumeAuthRateLimit(key, rule) }
  catch (error) { if (error instanceof RateLimiterUnavailableError) throw error; throw new RateLimiterUnavailableError() }
}
export async function throttle(event: H3Event, scope: RateScope, subject = clientAddress(event)) {
  let result
  try { result = await consumeRateLimit(scope, subject) }
  catch {
    setHeader(event, 'Retry-After', 60); setHeader(event, 'Cache-Control', 'no-store')
    throw new RateLimiterUnavailableError()
  }
  if (!result.allowed) {
    setHeader(event, 'Retry-After', result.retryAfter); setHeader(event, 'Cache-Control', 'no-store')
    fail(429, 'rate_limit_exceeded', '操作が集中しています。しばらく待ってからお試しください')
  }
}
