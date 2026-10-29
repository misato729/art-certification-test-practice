import { defineApiHandler } from '../../../core/api-handler.ts'
import { checkoutPayment } from '../../../services/payments.ts'

export default defineApiHandler(checkoutPayment, { authentication: 'required', failureRoute: 'payments/checkout_sessions' })
