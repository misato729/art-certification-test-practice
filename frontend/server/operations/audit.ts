import { query, record, transaction, type Database } from '../core/db.ts'
import { environment } from '../core/config.ts'
import { paymentSettings } from '../services/payment-settings.ts'
import type { PaymentStripeClient } from '../services/payment-client.ts'
import { expirePendingCheckouts } from '../services/payment-checkout.ts'
import type { User } from '../core/auth.ts'
import { OperationError } from './content.ts'

export async function auditOperations(db?: Database, now = new Date()) {
  return transaction(async connection => {
    if (!db) await query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY', [], connection)
    const dayAgo = new Date(now.getTime() - 86400000)
    const revokedPayments = await connection.payment.findMany({ where: { status: { in: ['refunded', 'disputed', 'expired', 'pending'] } }, select: { id: true } })
    const safeCounts = {
      stale_pending_checkouts: await connection.payment.count({ where: { status: 'pending', created_at: { lt: dayAgo } } }),
      refund_failures_last_day: await connection.payment.count({ where: { last_refund_failed_at: { gte: dayAgo } } }),
      disputed_payments: await connection.payment.count({ where: { status: 'disputed' } }),
      active_memberships_with_revoked_payment: await connection.membership.count({ where: { status: 'active', source_payment_id: { in: revokedPayments.map(payment => payment.id) } } }),
      processed_webhooks_last_day: await connection.stripeWebhookEvent.count({ where: { processed_at: { gte: dayAgo } } }),
    }
    const warnings = Object.entries(safeCounts).filter(([key, value]) => key !== 'processed_webhooks_last_day' && value > 0).map(([key]) => key)
    const settings = paymentSettings()
    return { checked_at: now.toISOString(), environment: environment(), sales_enabled: settings.enabled,
      payment_configuration_issues: settings.issues, counts: safeCounts, warnings }
  }, db)
}

export async function expirePendingForUser(email: string | undefined, options: { db?: Database, client?: PaymentStripeClient } = {}) {
  const normalized = (email || '').trim().toLowerCase()
  if (!normalized || normalized.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new OperationError('USER_EMAILを指定してください')
  return transaction(async connection => {
    const found = await connection.user.findFirst({ where: { email: { equals: normalized, mode: 'insensitive' } } })
    const user = found ? record(found) as User : null
    if (!user) throw new OperationError('対象ユーザーが見つかりません')
    await query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [user.id], connection)
    const count = await connection.payment.count({ where: { user_id: BigInt(user.id), status: 'pending' } })
    if (!count) return { status: 'ok' as const, expired_count: 0 }
    await expirePendingCheckouts(user, connection, options.client)
    return { status: 'ok' as const, expired_count: count }
  }, options.db)
}
