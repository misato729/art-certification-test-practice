import type { ContentBlock, ContentBlockType } from '../types/adminQuestion'

export type AdminContentBlockContext = 'question' | 'explanation' | 'choice'

const blockOptions = {
  question: [
    { value: 'text', label: '通常文' },
    { value: 'quote', label: '枠付き引用文' },
    { value: 'fill_in_text', label: '穴埋め問題文' },
    { value: 'fill_in_quote', label: '穴埋め引用文' },
    { value: 'table', label: '表' },
    { value: 'code', label: 'プログラム' },
    { value: 'code_group', label: 'プログラム比較' },
  ],
  explanation: [
    { value: 'text', label: '通常文' },
    { value: 'quote', label: '枠付き引用文' },
    { value: 'table', label: '表' },
    { value: 'code', label: 'プログラム' },
  ],
  choice: [
    { value: 'text', label: '通常文' },
    { value: 'table', label: '表' },
    { value: 'fill_in_choice', label: '穴埋め選択肢' },
  ],
} as const

export const getAdminContentBlockOptions = (context: AdminContentBlockContext) => blockOptions[context]

export const createAdminContentBlock = (type: ContentBlockType): ContentBlock => {
  if (type === 'table') return { type, headers: ['見出し1', '見出し2'], rows: [['', '']] }
  if (type === 'code') return { type, title: '', code: '' }
  if (type === 'code_group') return { type, items: [{ title: 'プログラムA', code: '' }, { title: 'プログラムB', code: '' }] }
  if (type === 'quote') return { type, text: '', source: '' }
  if (type === 'fill_in_choice') return { type, cells: ['', '', ''] }
  return { type, text: '' }
}

export const FILL_IN_CHOICE_LABELS = ['①', '②', '③', '④', '⑤', '⑥'] as const
export const FILL_IN_CHOICE_COLUMN_COUNTS = [1, 2, 3, 4, 5, 6] as const

export const resizeFillInChoiceCells = (
  cells: readonly string[] | undefined,
  columnCount: number,
  retainedCells: readonly string[] = [],
): { cells: string[], retainedCells: string[] } => {
  if (!Number.isInteger(columnCount) || columnCount < 1 || columnCount > FILL_IN_CHOICE_LABELS.length) {
    throw new RangeError('穴埋め選択肢の空欄数は1〜6です')
  }
  const retained = Array.from(
    { length: Math.max(cells?.length ?? 0, retainedCells.length) },
    (_, index) => cells?.[index] ?? retainedCells[index] ?? '',
  )
  return {
    cells: Array.from({ length: columnCount }, (_, index) => retained[index] ?? ''),
    retainedCells: retained,
  }
}
