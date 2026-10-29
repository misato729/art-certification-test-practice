import { randomUUID } from 'node:crypto'
import { NodeClient, Scope, createTransport, defaultStackParser, type ErrorEvent, type NodeOptions } from '@sentry/node'

const messages = {
  api: 'Exam Practice API server failure',
  stripe_api: 'Exam Practice Stripe API connection failure',
  stripe_webhook: 'Exam Practice Stripe webhook processing failure',
} as const
const suppressionMilliseconds = 60 * 60 * 1000
const deliveryMilliseconds = 1000

type NotificationOptions = {
  transport?: NodeOptions['transport']
  request?: typeof fetch
  now?: () => number
}

// The SDK provides the authenticated destination and serializes each envelope.
// Only its network executor is supplied so delivery has an absolute deadline.
function notificationTransport(request: typeof fetch): NonNullable<NodeOptions['transport']> {
  return options => createTransport(options, async ({ body }) => {
    const response = await request(options.url, {
      method: 'POST', headers: options.headers,
      body: typeof body === 'string' ? body : new Uint8Array(body),
      signal: AbortSignal.timeout(deliveryMilliseconds), redirect: 'error', credentials: 'omit',
    })
    await response.body?.cancel()
    return { statusCode: response.status, headers: {
      'retry-after': response.headers.get('retry-after'),
      'x-sentry-rate-limits': response.headers.get('x-sentry-rate-limits'),
    } }
  })
}

// This only constrains the destination. DSN parsing, authentication and envelope
// serialization belong to the official SDK; no request or exception is passed to it.
function allowedDestination(value: string) {
  const url = new URL(value)
  return url.protocol === 'https:' && (!url.port || url.port === '443')
    && /^o\d+\.ingest(?:\.[a-z]+)?\.sentry\.io$/.test(url.hostname)
    && /^[a-f0-9]{32}$/i.test(url.username) && !url.password
    && /^\/\d+$/.test(url.pathname) && !url.search && !url.hash
}

export function createFailureNotifier(options: NotificationOptions = {}) {
  const sent = new Map<string, number>()
  const now = options.now ?? Date.now
  const createTransportForNotification = options.transport ?? notificationTransport(options.request ?? fetch)

  return async function notifyFailure(route: string, status: number, expected = false) {
    if (process.env.ERROR_NOTIFICATIONS_ENABLED !== 'true' || status < 500 || (status === 503 && expected)) return 'ignored'
    const category = status === 503 ? 'api' : route.startsWith('webhooks/stripe') ? 'stripe_webhook' : route.startsWith('payments/checkout_sessions') ? 'stripe_api' : 'api'
    try {
      const dsn = process.env.SENTRY_ERROR_DSN || ''
      const environment = process.env.ERROR_NOTIFICATION_ENVIRONMENT || (process.env.NODE_ENV === 'production' ? 'production' : 'verification')
      if (!allowedDestination(dsn) || !['production', 'verification'].includes(environment)) return 'failed'
      const key = `${environment}:${category}`
      const timestamp = now()
      const previous = sent.get(key)
      if (previous !== undefined && timestamp - previous < suppressionMilliseconds) return 'throttled'
      sent.set(key, timestamp)

      const eventId = randomUUID().replaceAll('-', '')
      const safeEvent = (): ErrorEvent => ({
        type: undefined,
        event_id: eventId, timestamp: timestamp / 1000, environment, level: 'error' as const,
        message: messages[category], tags: { category },
      })
      let delivered = false
      const client = new NodeClient({
        dsn, environment, stackParser: defaultStackParser,
        integrations: [], includeServerName: false, sendClientReports: false,
        enableRuntimeChannelInjection: false, enableOpenTelemetrySetup: false,
        attachStacktrace: false, maxBreadcrumbs: 0, traceLifecycle: 'static',
        dataCollection: {
          userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false,
          graphQL: { document: false, variables: false }, genAI: { inputs: false, outputs: false },
          mcp: { inputs: false, outputs: false }, databaseQueryData: false, queues: false,
          stackFrameVariables: false, frameContextLines: 0,
        },
        transport: transportOptions => {
          const transport = createTransportForNotification(transportOptions)
          return {
            flush: timeout => transport.flush(timeout),
            send: async envelope => {
              // Suppress SDK sessions, logs, metrics, tracing and client reports.
              if (envelope[1].length !== 1 || envelope[1][0]?.[0].type !== 'event') return {}
              const response = await transport.send(envelope)
              delivered = response.statusCode !== undefined && response.statusCode >= 200 && response.statusCode < 300
              return response
            },
          }
        },
        beforeSend(_event, hint) {
          // Rebuild from closure-owned constants after all scope/event processors.
          // Attachments are carried in the hint rather than the event itself.
          delete hint.attachments
          return safeEvent()
        },
      })
      const scope = new Scope()
      scope.setClient(client)
      // SDK-internal error reports skip beforeSend. Keep the same allowlist at
      // the final documented event hook, before SDK envelope serialization.
      client.on('beforeSendEvent', (event, hint) => {
        for (const key of Object.keys(event)) Reflect.deleteProperty(event, key)
        Object.assign(event, safeEvent())
        if (hint) delete hint.attachments
      })
      // No init(): there are no integrations to install, and this isolated client
      // must not replace the process-wide Sentry context strategy.
      scope.captureEvent(safeEvent())
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const flushed = await Promise.race([
          client.close(deliveryMilliseconds),
          new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), deliveryMilliseconds) }),
        ])
        return flushed && delivered ? 'sent' : 'failed'
      } finally { clearTimeout(timer) }
    } catch { return 'failed' }
  }
}

export const notifyFailure = createFailureNotifier()
