import type { AdminChoice } from '../types/adminQuestion.ts'

/** Keep shared labels intact; an omitted correct choice requires a new explicit selection. */
export function reconcileQuestionChoices(choices: readonly AdminChoice[], labels: readonly string[], options: { preserveExisting?: boolean, cachedChoices?: readonly AdminChoice[] } = {}): AdminChoice[] {
  // Existing records cannot change their label set. Keep every ID and field
  // while the editor types coordinates, including valid intermediate numbers.
  if (options.preserveExisting) return choices.map(choice => ({ ...choice }))
  return labels.map((label, index) => {
    const existing = choices.find(choice => choice.choice_label === label)
    const cached = options.cachedChoices?.find(choice => choice.choice_label === label)
    if (!existing && cached) return { ...cached, is_correct: false, display_order: index + 1 }
    return existing ? { ...existing, display_order: index + 1 } : {
      choice_label: label,
      content_blocks: [{ type: 'text', text: '' }],
      is_correct: false,
      display_order: index + 1,
    }
  })
}
