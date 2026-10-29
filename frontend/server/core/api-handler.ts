import { defineEventHandler, getRouterParam, setResponseStatus, type H3Event } from 'h3'
import { authenticate, requireAdmin, type User } from './auth.ts'
import { ApiError, fail } from './errors.ts'
import { applyApiHeaders } from './http.ts'
import { notifyFailure } from './notifications.ts'
import { integer } from '../../shared/schemas/content.ts'

type ApiHandlerOptions = {
  authentication?: 'none' | 'optional' | 'required' | 'admin'
  failureRoute?: 'api' | 'payments/checkout_sessions' | 'webhooks/stripe'
}

/** Shared transport/security boundary; Nitro owns URL and HTTP-method matching. */
export function defineApiHandler<T>(handler: (event: H3Event, user: User | null) => T, options: ApiHandlerOptions = {}) {
  return defineEventHandler(async event => {
    try {
      if (applyApiHeaders(event)) return ''
      const authentication = options.authentication ?? 'optional'
      const user = authentication === 'none' ? null : authentication === 'admin'
        ? await requireAdmin(event) : await authenticate(event, authentication === 'required')
      return await handler(event, user)
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode
      const apiError = error instanceof ApiError ? error : statusCode && statusCode >= 400 && statusCode < 500
        ? new ApiError(statusCode, 'bad_request', '入力内容を確認してください')
        : new ApiError(500, 'internal_server_error', '処理に失敗しました')
      setResponseStatus(event, apiError.status)
      if (apiError.status >= 500) {
        const route = options.failureRoute ?? 'api'
        // No URL, parameters, input, exception messages or personal data in logs.
        console.error(JSON.stringify({ category: 'api_failure', status: apiError.status,
          route: route === 'webhooks/stripe' ? 'stripe_webhook' : route === 'payments/checkout_sessions' ? 'payments' : 'api' }))
        await notifyFailure(route, apiError.status, apiError.expectedUnavailability)
      }
      return { error: { code: apiError.code, message: apiError.message,
        ...(apiError.details ? { details: apiError.details } : {}) } }
    }
  })
}

/** Dynamic IDs come from H3's matched route, never from manually split URLs. */
export function routeId(event: H3Event, name = 'id'): number {
  const id = integer(getRouterParam(event, name))
  if (id === undefined || id < 1) return fail(404, 'not_found', '対象が見つかりません')
  return id
}
