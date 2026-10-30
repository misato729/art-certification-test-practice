import type { FormError, FormErrorEvent } from '@nuxt/ui'

/** Only documented field names and validation strings reach form fields. */
export function apiFormErrors(error: unknown, fields: Record<string, string>): FormError[] {
  const details = (error as { data?: { error?: { details?: unknown } } } | null)?.data?.error?.details
  if (!details || typeof details !== 'object' || Array.isArray(details)) return []
  return Object.entries(fields).flatMap(([name, label]) => {
    const messages = (details as Record<string, unknown>)[name]
    if (!Array.isArray(messages)) return []
    const message = messages.find(value => typeof value === 'string' && value.length > 0 && value.length <= 500)
    return typeof message === 'string' ? [{ name, message: /^[はがを]/.test(message) ? `${label}${message}` : message }] : []
  })
}

export const questionFormFields = {
  exam_number: '試験ナンバー', question_number: '問番号', major_category_code: '大分類', category_code: '小分類',
  publication_status: '公開状態', content_blocks: '問題文', explanation_blocks: '解答解説',
  choices: '選択肢', source_text: '根拠資料', group_id: '所属する大問',
  group_question_number: '大問内の小問番号', passage_references: '共通本文の参照', lock_version: '更新状態',
}

/** The library resolves each field's input id, including custom block editors. */
export function focusFormError(event: FormErrorEvent) {
  for (const error of event.errors) {
    const input = error.id ? document.getElementById(error.id) : null
    if (input) { input.focus(); return }
  }
}
