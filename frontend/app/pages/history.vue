<script setup lang="ts">
import { examTitle, catalogQuestionLabel } from '~/utils/examCatalog'
definePageMeta({ middleware: 'auth' })
const { data: publicCatalog } = await usePublicExamCatalog()
const positionLabel = (examNumber: number, questionNumber: number) => {
  const exam = publicCatalog.value?.data.find(item => item.exam_number === examNumber)
  return exam ? catalogQuestionLabel(exam, questionNumber) : `問${questionNumber}`
}

type HistoryItem = {
  id: number
  locked: boolean
  question: {
    id: number
    exam_number: number
    question_number: number
    body_excerpt?: string
    major_category_code?: string
    category_code?: string
  }
  selected_choice?: {
    id: number
    choice_label: string
    body_excerpt: string
  }
  question_version?: number
  is_outdated?: boolean
  is_correct?: boolean
  answered_at: string
}

type HistoryMeta = {
  current_page: number
  per_page: number
  total_count: number
  total_pages: number
}

type ApiResponse = {
  data: HistoryItem[]
  meta: HistoryMeta
}

const { $api: api } = useNuxtApp()
const { isLoggedIn, authHeaders } = useAuth()
const histories = ref<HistoryItem[]>([])
const meta = ref<HistoryMeta>({ current_page: 1, per_page: 20, total_count: 0, total_pages: 0 })
const page = ref(1)
const loading = ref(false)
const loadError = ref('')

const loadHistories = async () => {
  if (!isLoggedIn.value) {
    histories.value = []
    loadError.value = ''
    return
  }

  loading.value = true
  loadError.value = ''
  try {
    const response = await api<ApiResponse>('/api/v1/answer_histories', {
      headers: authHeaders.value,
      query: { page: page.value, per_page: 20 },
    })
    histories.value = response.data
    meta.value = response.meta
  }
  catch (error: any) {
    if (error?.statusCode === 401 || error?.status === 401) {
      return
    }
    loadError.value = '解答履歴を読み込めませんでした。もう一度お試しください。'
  }
  finally {
    loading.value = false
  }
}

watch([isLoggedIn, page], loadHistories, { immediate: true })

const formatAnsweredAt = (value: string) => new Intl.DateTimeFormat('ja-JP', {
  dateStyle: 'medium',
  timeStyle: 'short',
}).format(new Date(value))

const majorCategoryLabel = (code?: string) => (
  !code ? '' :
  MAJOR_CATEGORIES.find(item => item.value === code)?.label ?? code
)

const historyLink = (history: HistoryItem) => ({
  path: `/practice/${history.question.exam_number}/${history.question.question_number}`,
  query: history.is_outdated ? {} : { answer_history_id: history.id },
})
</script>

<template>
  <div class="page-wrap">
    <header class="page-intro">
      <h1>解答履歴</h1>
      <p>これまでに回答した問題を、新しい順に確認できます。</p>
    </header>

    <div v-if="!isLoggedIn" class="empty-state">
      <h2>ログインが必要です</h2>
      <p>解答履歴はログインユーザーのみ利用できます。</p>
      <NuxtLink class="primary-link" to="/login?redirect=/history">ログインへ</NuxtLink>
    </div>

    <div v-else-if="loading" class="empty-state" aria-live="polite">
      <UIcon class="empty-icon spin" name="i-lucide-loader-circle" />
      <p>解答履歴を読み込んでいます。</p>
    </div>

    <div v-else-if="loadError" class="empty-state">
      <UIcon class="empty-icon error-icon" name="i-lucide-circle-alert" />
      <h2>解答履歴を読み込めません</h2>
      <p>{{ loadError }}</p>
      <button class="secondary-link" type="button" @click="loadHistories">再読み込み</button>
    </div>

    <div v-else-if="histories.length === 0" class="empty-state">
      <UIcon class="empty-icon" name="i-lucide-history" />
      <h2>まだ解答履歴がありません</h2>
      <p>問題に回答すると、ここに記録されます。</p>
      <NuxtLink class="primary-link" to="/practice/1/1">問題演習を始める</NuxtLink>
    </div>

    <template v-else>
      <div class="history-summary">
        <strong>{{ meta.total_count }}件の解答履歴</strong>
        <span>新しい順</span>
      </div>

      <div class="history-list">
        <article v-for="history in histories" :key="history.id" class="history-card">
          <NuxtLink v-if="!history.locked" :to="historyLink(history)">
            <div class="history-card-head">
              <span class="result-badge" :class="{ correct: !history.is_outdated && history.is_correct, outdated: history.is_outdated }">
                <UIcon :name="history.is_outdated ? 'i-lucide-history' : history.is_correct ? 'i-lucide-circle-check' : 'i-lucide-circle-x'" />
                {{ history.is_outdated ? '更新前の回答' : history.is_correct ? '正解' : '不正解' }}
              </span>
              <time :datetime="history.answered_at">{{ formatAnsweredAt(history.answered_at) }}</time>
            </div>

            <div class="history-question">
              <span>{{ examTitle(history.question.exam_number) }}・{{ positionLabel(history.question.exam_number, history.question.question_number) }}</span>
              <strong v-if="history.question.body_excerpt">{{ history.question.body_excerpt }}</strong>
              <small v-if="history.question.major_category_code || history.question.category_code">
                {{ majorCategoryLabel(history.question.major_category_code) }} /
                {{ getCategoryLabel(history.question.category_code ?? '') }}
              </small>
            </div>

            <div v-if="!history.is_outdated && history.selected_choice" class="selected-answer">
              <span>選択した解答</span>
              <p><b>{{ history.selected_choice?.choice_label }}</b>{{ history.selected_choice?.body_excerpt }}</p>
            </div>

            <p v-if="history.is_outdated" class="history-outdated">回答後に問題が更新されています。現在の問題を解き直せます。</p>
            <span class="review-link">{{ history.is_outdated ? '現在の問題を解く' : '問題と解説を確認する' }} <UIcon name="i-lucide-arrow-right" /></span>
          </NuxtLink>
          <div v-else class="locked-history">
            <div class="history-card-head">
              <span class="result-badge locked-badge"><UIcon name="i-lucide-lock-keyhole" />閲覧制限</span>
              <time :datetime="history.answered_at">{{ formatAnsweredAt(history.answered_at) }}</time>
            </div>
            <div class="history-question">
              <span>{{ examTitle(history.question.exam_number) }}・{{ positionLabel(history.question.exam_number, history.question.question_number) }}</span>
              <strong>この履歴の本文・正誤・解説はプレミアム会員向けです。</strong>
            </div>
            <NuxtLink v-if="PAYMENTS_ENABLED" class="primary-link" to="/premium">プレミアム会員について確認する</NuxtLink>
          </div>
        </article>
      </div>

      <nav v-if="meta.total_pages > 1" class="pagination" aria-label="解答履歴のページ切り替え">
        <button class="secondary-link" type="button" :disabled="page <= 1" @click="page--">前のページ</button>
        <span>{{ meta.current_page }} / {{ meta.total_pages }}</span>
        <button class="secondary-link" type="button" :disabled="page >= meta.total_pages" @click="page++">次のページ</button>
      </nav>
    </template>
  </div>
</template>

<style scoped>
.result-badge.outdated { color: var(--muted); background: var(--surface-soft); }
.history-outdated { margin: 12px 0 0; color: var(--muted); font-size: 13px; line-height: 1.7; }
.empty-icon { width: 34px; height: 34px; color: var(--teal); }
.error-icon { color: var(--coral); }
.history-summary { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 14px; color: var(--muted); }
.history-summary strong { color: var(--ink); }
.history-list { display: grid; gap: 14px; }
.history-card { min-width: 0; border: 1px solid var(--line); border-radius: 8px; background: #fff; transition: border-color .15s, transform .15s, box-shadow .15s; }
.history-card:hover { border-color: #9dbfc1; transform: translateY(-1px); box-shadow: 0 8px 24px rgba(20, 48, 54, .08); }
.history-card a { min-width: 0; display: grid; gap: 18px; padding: 22px 24px; color: var(--ink); text-decoration: none; }
.history-card-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.history-card-head time { color: var(--muted); font-size: 13px; }
.result-badge { min-height: 30px; display: inline-flex; align-items: center; gap: 6px; padding: 0 10px; border-radius: 999px; background: #fff0ec; color: #b44734; font-size: 13px; font-weight: 800; }
.result-badge.correct { background: #e8f6f4; color: var(--teal-dark); }
.locked-badge { background: #eef2f3; color: #53676e; }
.result-badge :deep(svg) { width: 17px; height: 17px; }
.history-question { min-width: 0; display: grid; gap: 7px; }
.history-question > span { color: var(--teal-dark); font-size: 14px; font-weight: 800; }
.history-question strong { overflow-wrap: anywhere; font-size: 18px; line-height: 1.65; }
.history-question small { color: var(--muted); }
.selected-answer { padding: 14px 16px; border-left: 3px solid #b8c8cb; background: #f5f8f8; }
.selected-answer > span { display: block; margin-bottom: 6px; color: var(--muted); font-size: 12px; font-weight: 700; }
.selected-answer p { display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: 8px; margin: 0; color: #40535a; line-height: 1.6; }
.selected-answer b { color: var(--teal-dark); }
.review-link { display: inline-flex; align-items: center; justify-self: end; gap: 6px; color: var(--teal-dark); font-size: 14px; font-weight: 800; }
.locked-history { display: grid; gap: 18px; padding: 22px 24px; }
.locked-history .primary-link { justify-self: end; }
.pagination { display: flex; align-items: center; justify-content: center; gap: 16px; margin-top: 24px; }
.pagination span { color: var(--muted); font-weight: 700; }
.pagination button:disabled { opacity: .45; cursor: not-allowed; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 640px) {
  .history-card a { padding: 18px; }
  .history-card-head { align-items: flex-start; flex-direction: column; }
  .history-question strong { font-size: 16px; }
  .pagination { gap: 8px; }
  .pagination button { padding: 0 12px; }
}
</style>
