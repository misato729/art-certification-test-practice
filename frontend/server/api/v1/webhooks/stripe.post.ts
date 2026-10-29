import { defineApiHandler } from '../../../core/api-handler.ts'
import { receiveStripeWebhook } from '../../../services/payments.ts'

export default defineApiHandler(receiveStripeWebhook, { authentication: 'none', failureRoute: 'webhooks/stripe' })
