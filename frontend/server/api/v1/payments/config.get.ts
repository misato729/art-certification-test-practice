import { defineApiHandler } from '../../../core/api-handler.ts'
import { getPaymentConfiguration } from '../../../services/payments.ts'

export default defineApiHandler(getPaymentConfiguration, { failureRoute: 'payments/checkout_sessions' })
