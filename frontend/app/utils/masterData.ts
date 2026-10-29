import { EXAM_CONFIG } from './examConfig.ts'

export type MasterDataItem<T extends string = string> = {
  value: T
  label: string
}

export const USER_ROLES = [
  { value: 'user', label: '一般ユーザー' },
  { value: 'admin', label: '管理者' },
] as const satisfies readonly MasterDataItem[]

export const MAJOR_CATEGORIES = EXAM_CONFIG.categories.major
export const CATEGORIES = EXAM_CONFIG.categories.minor.map(item => ({
  value: item.value,
  label: item.label,
  majorCategoryValue: item.major_category_value,
}))

export const PUBLICATION_STATUSES = [
  { value: 'draft', label: '下書き' },
  { value: 'published', label: '公開' },
  { value: 'private', label: '非公開' },
] as const satisfies readonly MasterDataItem[]

export const QUESTION_REPORT_STATUSES = [
  { value: 'unhandled', label: '未対応' },
  { value: 'in_progress', label: '対応中' },
  { value: 'fixed', label: '修正済み' },
  { value: 'rejected', label: '対応しない' },
] as const satisfies readonly MasterDataItem[]

export const PRACTICE_TYPES = [
  { value: 'practice', label: '通常演習' },
  { value: 'mock_exam', label: '模擬試験' },
] as const satisfies readonly MasterDataItem[]

export const QUESTION_CONDITION_TYPES = [
  { value: 'all', label: '全分野' },
  { value: 'major_category', label: '大分類指定' },
  { value: 'category', label: '小分類指定' },
] as const satisfies readonly MasterDataItem[]

export const EXTRA_CONDITIONS = [
  { value: 'none', label: '指定なし' },
  { value: 'favorite', label: 'お気に入り問題のみ' },
  { value: 'incorrect', label: '間違えた問題のみ' },
  { value: 'unanswered', label: '未回答の問題のみ' },
] as const satisfies readonly MasterDataItem[]

export const MEDALS = [
  { value: 'none', label: 'なし' },
  { value: 'bronze', label: '銅メダル' },
  { value: 'silver', label: '銀メダル' },
  { value: 'gold', label: '金メダル' },
] as const satisfies readonly MasterDataItem[]

export const getMasterDataLabel = <T extends string>(
  items: readonly MasterDataItem<T>[],
  value: T,
) => items.find((item) => item.value === value)?.label ?? value

export const getCategoryLabel = (value: string) =>
  CATEGORIES.find((category) => category.value === value)?.label ?? value

export const getCategoriesByMajorCategory = (majorCategoryValue: string) =>
  CATEGORIES.filter((category) => category.majorCategoryValue === majorCategoryValue)

export const getMedalByConsecutiveCorrectCount = (count: number) => {
  if (count >= 3) return 'gold'
  if (count === 2) return 'silver'
  if (count === 1) return 'bronze'
  return 'none'
}
