import { configuration, environment } from '../core/config.ts'
import type { ExamConfiguration } from '../../app/utils/examConfig.ts'

export type PaymentSettings = ReturnType<typeof paymentSettings>
type Environment = Record<string, string | undefined>
const required = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_ID', 'FRONTEND_URL', 'NUXT_PUBLIC_SELLER_NAME', 'NUXT_PUBLIC_SELLER_REPRESENTATIVE', 'NUXT_PUBLIC_SELLER_EMAIL']
// Match ActiveModel::Type::Boolean for existing deployment settings.
export const settingEnabled = (value: string | undefined) => value !== undefined && value !== '' && !['0', 'f', 'false', 'off'].includes(value.toLowerCase())
const present = (value: unknown) => typeof value === 'string' && value.trim().length > 0

export function validFrontendOrigin(value: string, runtimeEnvironment: string) {
  try {
    if (!/^https?:\/\/[^/?#\\\s]+\/?$/i.test(value)) return false
    const origin = new URL(value)
    return Boolean(origin.hostname) && !origin.username && !origin.password &&
      (origin.pathname === '' || origin.pathname === '/') && !origin.search && !origin.hash &&
      (origin.protocol === 'https:' || (runtimeEnvironment !== 'production' && origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname)))
  } catch { return false }
}

/** Only seller fields are returned by the public endpoint; never return settings wholesale. */
export function paymentSettings(env: Environment = process.env, config: ExamConfiguration = configuration, runtimeEnvironment = environment()) {
  const featureEnabled = config.payments.enabled
  const salesEnabled = settingEnabled(env.PAID_MEMBERSHIP_ENABLED)
  const livemode = settingEnabled(env.STRIPE_LIVEMODE)
  const mode = env.SELLER_CONTACT_DISCLOSURE_MODE === undefined ? 'public' : env.SELLER_CONTACT_DISCLOSURE_MODE
  const contactReady = mode === 'on_request' && env.SELLER_CONTACT_DISCLOSURE_READY === 'true'
  const issues: string[] = []
  if (featureEnabled) {
    for (const key of required) if (!present(env[key])) issues.push(`missing:${key}`)
    if (mode === 'public') {
      for (const key of ['NUXT_PUBLIC_SELLER_ADDRESS', 'NUXT_PUBLIC_SELLER_PHONE']) if (!present(env[key])) issues.push(`missing:${key}`)
    } else if (mode === 'on_request') {
      if (!contactReady) issues.push('seller_contact_disclosure_not_ready')
    } else issues.push('invalid_seller_contact_disclosure_mode')
    if (present(env.STRIPE_SECRET_KEY) && !new RegExp(`^(?:sk|rk)_${livemode ? 'live' : 'test'}_`).test(env.STRIPE_SECRET_KEY!)) issues.push('stripe_key_mode_mismatch')
    if (present(env.FRONTEND_URL) && !validFrontendOrigin(env.FRONTEND_URL!, runtimeEnvironment)) issues.push('invalid_frontend_origin')
    if (runtimeEnvironment === 'production' && !livemode) issues.push('production_requires_live_mode')
  }
  return {
    featureEnabled, salesEnabled, enabled: featureEnabled && salesEnabled && issues.length === 0,
    issues, livemode, amount: config.payments.amount, currency: config.payments.currency,
    freeExamMax: config.payments.free_exam_count, siteName: config.site.name,
    secretKey: env.STRIPE_SECRET_KEY || '', webhookSecret: env.STRIPE_WEBHOOK_SECRET || '', priceId: env.STRIPE_PRICE_ID || '',
    frontendUrl: (env.FRONTEND_URL || 'http://localhost:3100').replace(/\/$/, ''),
    seller: {
      name: env.NUXT_PUBLIC_SELLER_NAME || '', representative: env.NUXT_PUBLIC_SELLER_REPRESENTATIVE || '',
      address: mode === 'public' ? env.NUXT_PUBLIC_SELLER_ADDRESS || '' : '',
      phone: mode === 'public' ? env.NUXT_PUBLIC_SELLER_PHONE || '' : '', email: env.NUXT_PUBLIC_SELLER_EMAIL || '',
      contact_disclosure_mode: ['public', 'on_request'].includes(mode) ? mode : 'unconfigured', contact_disclosure_ready: contactReady,
    },
  }
}

export function publicPaymentConfiguration(settings = paymentSettings()) {
  return { enabled: settings.enabled, feature_enabled: settings.featureEnabled, amount: settings.amount, currency: settings.currency,
    purchase_type: 'one_time', free_exam_max: settings.freeExamMax, seller: settings.seller }
}
