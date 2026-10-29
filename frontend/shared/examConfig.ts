import rawConfiguration from '../../config/exam.json' with { type: 'json' }

import { parseExamConfig } from './schemas/exam.ts'
export { parseExamConfig } from './schemas/exam.ts'
export type { ExamConfiguration } from './schemas/exam.ts'

export const EXAM_CONFIG = parseExamConfig(rawConfiguration)
export const SITE = EXAM_CONFIG.site
export const authCookieName = (config = EXAM_CONFIG) => `exam-${config.site.id}-access-token`
export const PAYMENTS_ENABLED = EXAM_CONFIG.payments.enabled
export const CHOICE_LABELS = EXAM_CONFIG.exam.choice_labels
export const PRICE_LABEL = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 }).format(EXAM_CONFIG.payments.amount)

export type AccessUser = { role?: string, paid_content_access?: boolean } | null | undefined
export const hasFullExamAccess = (user: AccessUser, config = EXAM_CONFIG) => (
  !config.payments.enabled || user?.role === 'admin' || user?.paid_content_access === true
)
export const canUseFavoriteFeature = (loggedIn: boolean, user: AccessUser, config = EXAM_CONFIG) => (
  loggedIn && Boolean(user) && hasFullExamAccess(user, config)
)

export const themeVariables = (config = EXAM_CONFIG) => {
  const primary = config.site.primary_color
  const dark = '#' + [1, 3, 5].map(index => Math.round(parseInt(primary.slice(index, index + 2), 16) * 0.72).toString(16).padStart(2, '0')).join('')
  const pale = '#' + [1, 3, 5].map(index => Math.round(parseInt(primary.slice(index, index + 2), 16) * 0.15 + 255 * 0.85).toString(16).padStart(2, '0')).join('')
  return `:root{--brand-primary:${primary};--brand-primary-dark:${dark};--brand-header:${pale}}`
}
