import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { test } from 'node:test'
import {
  createTransport, getClient, getCurrentScope, getGlobalScope, getIsolationScope, startSession,
  type NodeOptions,
} from '@sentry/node'
import { createFailureNotifier } from '../server/core/notifications.ts'

const syntheticDsn = 'https://' + 'a'.repeat(32) + '@o1.ingest.sentry.io/1'
const notificationEnvironment = {
  ERROR_NOTIFICATIONS_ENABLED: 'true', SENTRY_ERROR_DSN: syntheticDsn,
  ERROR_NOTIFICATION_ENVIRONMENT: 'verification',
}
type TransportFactory = NonNullable<NodeOptions['transport']>

async function withEnvironment<T>(values: Record<string, string | undefined>, action: () => Promise<T>) {
  const previous = new Map(Object.keys(values).map(key => [key, process.env[key]]))
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try { return await action() }
  finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

function recorder(statusCode = 200) {
  const bodies: string[] = []
  const destinations: string[] = []
  const transport: TransportFactory = options => {
    destinations.push(options.url)
    // The SDK's real transport serializes the envelope; this executor replaces only I/O.
    return createTransport(options, async request => {
      bodies.push(typeof request.body === 'string' ? request.body : Buffer.from(request.body).toString('utf8'))
      return { statusCode }
    })
  }
  return { transport, bodies, destinations }
}

function eventFrom(body: string) {
  const lines = body.trimEnd().split('\n')
  assert.equal(lines.length, 3, 'only one error event is allowed, without attachments or other items')
  assert.equal(JSON.parse(lines[1]!).type, 'event')
  return JSON.parse(lines[2]!) as Record<string, unknown>
}

function clearSyntheticScope(scope: ReturnType<typeof getGlobalScope>) {
  scope.setSession()
  scope.setUser(null)
  scope.setTag('private-tag', undefined)
  scope.setExtra('sql', undefined)
  scope.setContext('request', null)
  scope.clearBreadcrumbs()
  scope.clearAttachments()
  scope.getScopeData().eventProcessors.splice(0)
}

test('the official SDK emits only fixed notification fields despite hostile ambient Sentry data', async () => {
  await withEnvironment(notificationEnvironment, async () => {
    const secret = 'synthetic-private-request-exception-query-sql-cookie-user-body'
    const scopes = [getGlobalScope(), getIsolationScope(), getCurrentScope()]
    const priorClient = getClient()
    const uncaughtListeners = process.listenerCount('uncaughtException')
    const rejectionListeners = process.listenerCount('unhandledRejection')
    for (const scope of scopes) {
      scope.setUser({ id: secret, email: `${secret}@example.invalid`, ip_address: '192.0.2.1' })
      scope.setTag('private-tag', secret)
      scope.setExtra('sql', secret)
      scope.setContext('request', { url: `https://example.invalid/?token=${secret}`, body: secret })
      scope.addBreadcrumb({ message: secret, data: { sql: secret } })
      scope.addAttachment({ filename: `${secret}.txt`, data: secret })
    }
    startSession({ release: secret, user: { id: secret, ip_address: '192.0.2.1' } })
    getGlobalScope().addEventProcessor((event, hint) => {
      hint.originalException = new Error(secret)
      hint.attachments = [{ filename: `${secret}.txt`, data: secret }]
      return {
        ...event, event_id: secret, timestamp: 123, environment: secret, message: secret,
        logentry: { message: secret }, transaction: secret, server_name: secret, release: secret,
        tags: { category: secret }, user: { id: secret }, extra: { sql: secret },
        request: { url: `https://example.invalid/?token=${secret}`, cookies: { session: secret }, data: secret },
        exception: { values: [{ type: 'Error', value: secret, stacktrace: { frames: [{ filename: secret }] } }] },
        contexts: { trace: { trace_id: secret, span_id: 'b'.repeat(16) }, private: { sql: secret } },
        sdkProcessingMetadata: { dynamicSamplingContext: { trace_id: secret } },
      }
    })
    try {
      const recording = recorder()
      const notify = createFailureNotifier({ transport: recording.transport, now: () => 1767225600000 })
      assert.equal(await notify(`webhooks/stripe?access_token=${secret}`, 500), 'sent')
      assert.equal(recording.bodies.length, 1)
      const body = recording.bodies[0]!
      assert.ok(!body.includes(secret))
      const event = eventFrom(body)
      assert.deepEqual(Object.keys(event).sort(), ['environment', 'event_id', 'level', 'message', 'sdk', 'tags', 'timestamp'].sort())
      assert.equal(event.message, 'Exam Practice Stripe webhook processing failure')
      assert.equal(event.environment, 'verification')
      assert.equal(event.level, 'error')
      assert.equal(event.timestamp, 1767225600)
      assert.match(String(event.event_id), /^[a-f0-9]{32}$/)
      assert.deepEqual(event.tags, { category: 'stripe_webhook' })
      assert.equal((event.sdk as Record<string, unknown>).name, 'sentry.javascript.node')
      const destination = new URL(recording.destinations[0]!)
      assert.equal(destination.origin + destination.pathname, 'https://o1.ingest.sentry.io/api/1/envelope/')
      assert.equal(destination.searchParams.get('sentry_key'), 'a'.repeat(32))
      assert.equal(getGlobalScope(), scopes[0])
      assert.equal(getIsolationScope(), scopes[1])
      assert.equal(getCurrentScope(), scopes[2])
      assert.equal(getClient(), priorClient, 'the notification client must not replace the application scope client')
      assert.equal(process.listenerCount('uncaughtException'), uncaughtListeners)
      assert.equal(process.listenerCount('unhandledRejection'), rejectionListeners)
    } finally { for (const scope of scopes) clearSyntheticScope(scope) }
  })
})

test('notifications preserve per-environment/category hourly suppression and expected-unavailability rules', async () => {
  await withEnvironment(notificationEnvironment, async () => {
    const recording = recorder()
    let now = 0
    const notify = createFailureNotifier({ transport: recording.transport, now: () => now })
    assert.equal(await notify('health', 404), 'ignored')
    assert.equal(await notify('payments/checkout_sessions', 503, true), 'ignored')
    assert.equal(await notify('auth', 500), 'sent', 'the first report at clock zero must be delivered')
    assert.equal(await notify('other-api', 502), 'throttled')
    assert.equal(await notify('payments/checkout_sessions', 500), 'sent')
    assert.equal(await notify('webhooks/stripe', 500), 'sent')
    assert.equal(await notify('webhooks/stripe', 503), 'throttled', 'unexpected 503 remains in the API category')
    now = 3_599_999
    assert.equal(await notify('auth', 500), 'throttled')
    now = 3_600_000
    assert.equal(await notify('auth', 500), 'sent')
    process.env.ERROR_NOTIFICATION_ENVIRONMENT = 'production'
    assert.equal(await notify('auth', 500), 'sent')
    assert.equal(recording.bodies.length, 5)
    assert.deepEqual(recording.bodies.map(body => eventFrom(body).message), [
      'Exam Practice API server failure', 'Exam Practice Stripe API connection failure',
      'Exam Practice Stripe webhook processing failure', 'Exam Practice API server failure',
      'Exam Practice API server failure',
    ])
  })
})

test('notifications stay opt-in and reject invalid destinations or notification environments before transport creation', async () => {
  await withEnvironment(notificationEnvironment, async () => {
    const recording = recorder()
    for (const enabled of [undefined, '', 'false', '1', 'TRUE']) {
      await withEnvironment({ ERROR_NOTIFICATIONS_ENABLED: enabled }, async () => {
        const notify = createFailureNotifier({ transport: recording.transport })
        assert.equal(await notify('auth', 500), 'ignored')
      })
    }
    for (const dsn of ['', 'not-a-dsn', syntheticDsn.replace('https:', 'http:'),
      syntheticDsn.replace('o1.ingest.sentry.io', 'o1.ingest.sentry.io.example.invalid'),
      syntheticDsn.replace('o1.ingest.sentry.io', '127.0.0.1'),
      syntheticDsn.replace('/1', ':8443/1'), syntheticDsn.replace('@', ':synthetic-password@'),
      syntheticDsn + '?token=synthetic', syntheticDsn + '#synthetic', syntheticDsn + '/other']) {
      await withEnvironment({ SENTRY_ERROR_DSN: dsn }, async () => {
        const notify = createFailureNotifier({ transport: recording.transport })
        assert.equal(await notify('auth', 500), 'failed')
      })
    }
    await withEnvironment({ ERROR_NOTIFICATION_ENVIRONMENT: 'synthetic-private-environment' }, async () => {
      assert.equal(await createFailureNotifier({ transport: recording.transport })('auth', 500), 'failed')
    })
    assert.equal(recording.destinations.length, 0)
  })
})

test('notification environments retain explicit verification and production defaults', async () => {
  for (const [nodeEnvironment, expected] of [['test', 'verification'], ['production', 'production']]) {
    await withEnvironment({ ...notificationEnvironment, NODE_ENV: nodeEnvironment, ERROR_NOTIFICATION_ENVIRONMENT: undefined }, async () => {
      const recording = recorder()
      assert.equal(await createFailureNotifier({ transport: recording.transport })('auth', 500), 'sent')
      assert.equal(eventFrom(recording.bodies[0]!).environment, expected)
    })
  }
})

test('SDK HTTP failures, network rejection and transport setup failures never escape the notifier', async () => {
  await withEnvironment(notificationEnvironment, async () => {
    for (const status of [400, 429, 500, 503]) {
      const recording = recorder(status)
      const notify = createFailureNotifier({ transport: recording.transport })
      assert.equal(await notify('auth', 500), 'failed')
      assert.equal(await notify('auth', 500), 'throttled')
      assert.equal(recording.bodies.length, 1)
    }
    const networkFailure: TransportFactory = options => createTransport(options, async () => { throw new Error('synthetic-network-error') })
    const setupFailure: TransportFactory = () => { throw new Error('synthetic-setup-error') }
    for (const transport of [networkFailure, setupFailure]) {
      assert.equal(await createFailureNotifier({ transport })('auth', 500), 'failed')
    }
  })
})

test('SDK internal processing failures still pass the final fixed-payload allowlist', async () => {
  await withEnvironment(notificationEnvironment, async () => {
    const secret = 'synthetic-private-internal-exception'
    getGlobalScope().addEventProcessor(() => { throw new Error(secret) })
    try {
      const recording = recorder()
      const result = await createFailureNotifier({ transport: recording.transport })('auth', 500)
      assert.ok(['sent', 'failed'].includes(result))
      for (const body of recording.bodies) {
        assert.ok(!body.includes(secret))
        assert.equal(eventFrom(body).message, 'Exam Practice API server failure')
      }
    } finally { clearSyntheticScope(getGlobalScope()) }
  })
})

test('the SDK network executor aborts stalled I/O and refuses redirects', async () => {
  await withEnvironment(notificationEnvironment, async () => {
    let signal: AbortSignal | undefined
    let redirect: RequestRedirect | undefined
    let credentials: RequestCredentials | undefined
    let body = ''
    const request: typeof fetch = async (_url, options) => {
      signal = options?.signal ?? undefined
      redirect = options?.redirect
      credentials = options?.credentials
      body = String(options?.body)
      return new Promise((_resolve, reject) => {
        signal!.addEventListener('abort', () => reject(signal!.reason), { once: true })
      })
    }
    const notify = createFailureNotifier({ request })
    assert.equal(await notify('auth', 500), 'failed')
    // close() and the I/O signal share a deadline; give the signal its next timer turn.
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(signal?.aborted, true)
    assert.equal(redirect, 'error')
    assert.equal(credentials, 'omit')
    assert.equal(eventFrom(body).message, 'Exam Practice API server failure')
  })
})

test('an unresponsive SDK transport is bounded to one second and does not block subsequent API work', async () => {
  await withEnvironment(notificationEnvironment, async () => {
    const transport: TransportFactory = options => createTransport(options, () => new Promise(() => {}))
    const notify = createFailureNotifier({ transport })
    const started = performance.now()
    assert.equal(await notify('auth', 500), 'failed')
    assert.ok(performance.now() - started < 2500)
    assert.equal(await notify('auth', 500), 'throttled')
    assert.equal(await notify('health', 200), 'ignored')
  })
})
