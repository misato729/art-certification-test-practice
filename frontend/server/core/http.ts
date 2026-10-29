import { getHeader, getRequestURL, setHeader, setResponseStatus, type H3Event } from 'h3'
import { authTrustedOrigins, environment } from './config.ts'
import { fail } from './errors.ts'

export function allowedOrigins(configured?: string, env = environment()) {
  const values = configured === undefined ? authTrustedOrigins() : configured.split(',').map(value => value.trim()).filter(Boolean)
  for (const value of values) {
    try {
      const url = new URL(value)
      if (!['http:', 'https:'].includes(url.protocol) || (env === 'production' && url.protocol !== 'https:') || url.origin !== value || url.username || url.password || value.includes('*')) throw new Error()
    } catch { throw new Error('CORS_ORIGINS requires exact origins (HTTPS in production)') }
  }
  return [...new Set(values)]
}
export function applyApiHeaders(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  const origin = getHeader(event, 'origin')
  const origins = allowedOrigins()
  if (origin && origins.includes(origin)) {
    setHeader(event, 'Access-Control-Allow-Origin', origin)
    setHeader(event, 'Access-Control-Allow-Credentials', 'true')
    setHeader(event, 'Vary', 'Origin')
    setHeader(event, 'Access-Control-Allow-Headers', 'Authorization, Content-Type')
    setHeader(event, 'Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD')
  }
  if (event.method === 'OPTIONS') {
    if (origin && !origins.includes(origin)) fail(403, 'forbidden', 'この接続元は許可されていません')
    setResponseStatus(event, 204)
    return true
  }
  // Better Auth guards its own endpoints. Cookie-authenticated application
  // mutations also require a trusted browser origin; CORS alone is not CSRF
  // protection. Stripe webhooks authenticate their raw body with Stripe instead.
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(event.method)
  const webhook = getRequestURL(event).pathname === '/api/v1/webhooks/stripe'
  if (unsafe && !webhook) {
    if (!origin || !origins.includes(origin) || getHeader(event, 'sec-fetch-site') === 'cross-site') {
      fail(403, 'forbidden', 'この接続元は許可されていません')
    }
    const contentType = getHeader(event, 'content-type')
    const hasBody = Number(getHeader(event, 'content-length') || 0) > 0 || Boolean(getHeader(event, 'transfer-encoding'))
    if ((contentType || hasBody) && !/^application\/json(?:\s*;|$)/i.test(contentType || '')) {
      fail(415, 'unsupported_media_type', 'JSON形式で送信してください')
    }
  }
  return false
}
