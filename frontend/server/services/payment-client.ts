import Stripe from 'stripe'
import { paymentSettings, type PaymentSettings } from './payment-settings.ts'

// A small structural interface lets tests provide a fake without making network requests.
export type StripeObject = Record<string, any>
export type PaymentStripeClient = {
  prices: { retrieve(id: string): Promise<StripeObject> }
  checkout: { sessions: {
    create(params: StripeObject, options: { idempotencyKey: string }): Promise<StripeObject>
    retrieve(id: string): Promise<StripeObject>
    expire(id: string): Promise<StripeObject>
  } }
  charges: { retrieve(id: string): Promise<StripeObject> }
  paymentIntents: { retrieve(id: string): Promise<StripeObject> }
}

export function paymentStripeClient(settings: PaymentSettings = paymentSettings()): PaymentStripeClient {
  return new Stripe(settings.secretKey) as unknown as PaymentStripeClient
}

/** Verify bytes before parsing; changes in whitespace or encoding invalidate the signature. */
export function verifyStripeWebhook(payload: string | Buffer, signature: string, secret: string): StripeObject {
  return Stripe.webhooks.constructEvent(payload, signature, secret) as unknown as StripeObject
}
export const stripeId = (value: unknown): string | null => typeof value === 'string' && value.length > 0 ? value : value && typeof value === 'object' && typeof (value as StripeObject).id === 'string' ? (value as StripeObject).id : null
