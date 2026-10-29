import { getHeader, readRawBody, setResponseStatus, type H3Event } from 'h3'
import type { User } from '../core/auth.ts'
import { ApiError, fail } from '../core/errors.ts'
import { throttle } from '../core/rate-limit.ts'
import { createCheckoutSession } from './payment-checkout.ts'
import { verifyStripeWebhook } from './payment-client.ts'
import { paymentSettings, publicPaymentConfiguration } from './payment-settings.ts'
import { PaymentEventMismatchError, processStripeEvent } from './payment-webhooks.ts'

export { createCheckoutSession, expirePendingCheckouts } from './payment-checkout.ts'
export { paymentSettings, publicPaymentConfiguration } from './payment-settings.ts'
export { paymentStripeClient, verifyStripeWebhook } from './payment-client.ts'
export { processStripeEvent } from './payment-webhooks.ts'

export function getPaymentConfiguration() {
  return { data: publicPaymentConfiguration() }
}

export async function checkoutPayment(event: H3Event, user: User | null) {
  if (!user) fail(401, 'unauthorized', 'ログインが必要です')
  await throttle(event, 'checkout_ip')
  await throttle(event, 'checkout_user', String(user.id))
  const data = await createCheckoutSession(user)
  setResponseStatus(event, 201)
  return { data }
}

export async function receiveStripeWebhook(event: H3Event) {
  const settings = paymentSettings()
  if (!settings.webhookSecret.trim()) {
    const error = new ApiError(503, 'webhook_unavailable', 'Webhook設定が完了していません')
    error.expectedUnavailability = true
    throw error
  }
  const rawBody = await readRawBody(event, false)
  let stripeEvent
  try { stripeEvent = verifyStripeWebhook(rawBody || Buffer.alloc(0), getHeader(event, 'stripe-signature') || '', settings.webhookSecret) }
  catch { fail(400, 'invalid_webhook', 'Webhookを検証できません') }
  try { await processStripeEvent(stripeEvent, { settings }) }
  catch (error) {
    if (error instanceof PaymentEventMismatchError) fail(400, 'invalid_webhook', 'Webhookの内容を確認できません')
    // Never log the event, provider response, request body, credentials, or customer data.
    console.error('Stripe webhook processing failed')
    fail(500, 'webhook_processing_failed', 'Webhookを処理できませんでした')
  }
  setResponseStatus(event, 200)
  return ''
}
