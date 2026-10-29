<script setup lang="ts">
import type { AdminQuestion, AdminQuestionSummary, ApiResponse, PaginatedApiResponse } from '~/types/adminQuestion'

definePageMeta({ layout: 'admin', middleware: 'admin' })

const { $api: api } = useNuxtApp()
const { authHeaders, clearCurrentUser } = useAuth()

const filters = reactive({
  exam_number: '',
  major_category_code: '',
  category_code: '',
  publication_status: '',
  keyword: '',
})
const appliedFilters = ref({ ...filters })
const page = ref(1)
const updatingId = ref<number | null>(null)
const deletingQuestion = ref<AdminQuestionSummary | null>(null)
const actionError = ref('')

const filteredCategories = computed(() => (
  filters.major_category_code
    ? getCategoriesByMajorCategory(filters.major_category_code)
    : CATEGORIES
))

watch(() => filters.major_category_code, () => {
  if (filters.category_code && !filteredCategories.value.some(item => item.value === filters.category_code)) {
    filters.category_code = ''
  }
})

const query = computed(() => ({
  ...Object.fromEntries(Object.entries(appliedFilters.value).filter(([, value]) => value !== '')),
  page: page.value,
  per_page: 20,
}))

const {
  data: response,
  status,
  error,
  refresh,
} = await useFetch<PaginatedApiResponse<AdminQuestionSummary>>('/api/v1/admin/questions', {
  $fetch: api,
  headers: authHeaders,
  query,
  server: false,
})

const questions = computed(() => response.value?.data ?? [])
const meta = computed(() => response.value?.meta)

const applyFilters = () => {
  page.value = 1
  appliedFilters.value = { ...filters }
}

const clearFilters = () => {
  Object.assign(filters, {
    exam_number: '',
    major_category_code: '',
    category_code: '',
    publication_status: '',
    keyword: '',
  })
  applyFilters()
}

const statusLabel = (value: string) => getMasterDataLabel(PUBLICATION_STATUSES, value as 'draft' | 'published' | 'private')
const statusClass = (value: string) => `status-${value}`
const majorCategoryLabel = (value: string) => getMasterDataLabel(MAJOR_CATEGORIES, value)

const formatDate = (value: string) => new Intl.DateTimeFormat('ja-JP', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
}).format(new Date(value))

const handleUnauthorized = async (requestError: any) => {
  const code = requestError?.statusCode ?? requestError?.status
  if (code !== 401 && code !== 403) return false
  if (code === 403) clearCurrentUser()
  await navigateTo({ path: '/login', query: { redirect: '/admin/questions' } })
  return true
}

const changeStatus = async (question: AdminQuestionSummary, publicationStatus: string) => {
  if (updatingId.value) return
  updatingId.value = question.id
  actionError.value = ''

  try {
    const detailResponse = await api<ApiResponse<AdminQuestion>>(`/api/v1/admin/questions/${question.id}`, {
      headers: authHeaders.value,
    })
    const { id: _id, created_at: _createdAt, updated_at: _updatedAt, ...input } = detailResponse.data
    await api(`/api/v1/admin/questions/${question.id}`, {
      method: 'PATCH',
      headers: authHeaders.value,
      body: { question: { ...input, publication_status: publicationStatus } },
    })
    await refresh()
  }
  catch (requestError: any) {
    if (await handleUnauthorized(requestError)) return
    actionError.value = requestError?.data?.error?.message ?? '公開状態を更新できませんでした。'
  }
  finally {
    updatingId.value = null
  }
}

const deleteQuestion = async () => {
  if (!deletingQuestion.value || updatingId.value) return
  const question = deletingQuestion.value
  updatingId.value = question.id
  actionError.value = ''

  try {
    await api(`/api/v1/admin/questions/${question.id}`, {
      method: 'DELETE',
      headers: authHeaders.value,
    })
    deletingQuestion.value = null
    if (questions.value.length === 1 && page.value > 1) page.value -= 1
    else await refresh()
  }
  catch (requestError: any) {
    if (await handleUnauthorized(requestError)) return
    actionError.value = requestError?.data?.error?.message ?? '問題を削除できませんでした。'
  }
  finally {
    updatingId.value = null
  }
}
</script>

<template>
  <div class="admin-page admin-question-index">
    <header class="admin-page-head">
      <div>
        <p class="admin-page-eyebrow">SC-101</p>
        <h1>問題一覧</h1>
        <p>登録済みの問題を検索し、公開状態や内容を管理します。</p>
      </div>
      <NuxtLink class="admin-primary-button" to="/admin/questions/new"><UIcon name="i-lucide-plus" />問題を作成</NuxtLink>
    </header>

    <section class="admin-panel filter-panel">
      <div class="admin-panel-head">
        <div><h2>絞り込み</h2><p>条件を組み合わせて問題を検索できます。</p></div>
      </div>
      <form class="admin-panel-body filter-form" @submit.prevent="applyFilters">
        <div class="admin-field keyword-field">
          <label for="keyword">キーワード</label>
          <div class="keyword-input"><UIcon name="i-lucide-search" /><input id="keyword" v-model="filters.keyword" type="search" placeholder="問題文を検索"></div>
        </div>
        <div class="admin-field">
          <label for="exam-number">試験ナンバー</label>
          <input id="exam-number" v-model="filters.exam_number" type="number" min="1" placeholder="すべて">
        </div>
        <div class="admin-field">
          <label for="major-category">大分類</label>
          <select id="major-category" v-model="filters.major_category_code">
            <option value="">すべて</option>
            <option v-for="item in MAJOR_CATEGORIES" :key="item.value" :value="item.value">{{ item.label }}</option>
          </select>
        </div>
        <div class="admin-field">
          <label for="category">小分類</label>
          <select id="category" v-model="filters.category_code">
            <option value="">すべて</option>
            <option v-for="item in filteredCategories" :key="item.value" :value="item.value">{{ item.label }}</option>
          </select>
        </div>
        <div class="admin-field">
          <label for="publication-status">公開状態</label>
          <select id="publication-status" v-model="filters.publication_status">
            <option value="">すべて</option>
            <option v-for="item in PUBLICATION_STATUSES" :key="item.value" :value="item.value">{{ item.label }}</option>
          </select>
        </div>
        <div class="filter-actions">
          <button class="admin-secondary-button" type="button" @click="clearFilters">クリア</button>
          <button class="admin-primary-button" type="submit"><UIcon name="i-lucide-search" />検索</button>
        </div>
      </form>
    </section>

    <p v-if="actionError" class="admin-inline-error" role="alert">{{ actionError }}</p>

    <section class="admin-panel question-list-panel">
      <div class="admin-panel-head result-head">
        <div><h2>検索結果</h2><p v-if="meta">全 {{ meta.total_count }} 件</p></div>
        <button class="admin-icon-button" type="button" title="再読み込み" aria-label="再読み込み" @click="() => refresh()"><UIcon name="i-lucide-refresh-cw" /></button>
      </div>

      <div v-if="status === 'pending'" class="admin-loading"><div><UIcon name="i-lucide-loader-circle" /><span>問題を読み込んでいます</span></div></div>
      <div v-else-if="error" class="admin-empty">
        <div><UIcon name="i-lucide-circle-alert" /><h2>問題を読み込めませんでした</h2><p>APIとの接続を確認し、もう一度お試しください。</p><button class="admin-secondary-button" type="button" @click="() => refresh()">再読み込み</button></div>
      </div>
      <div v-else-if="questions.length === 0" class="admin-empty">
        <div><UIcon name="i-lucide-file-search" /><h2>該当する問題がありません</h2><p>絞り込み条件を変更するか、新しい問題を作成してください。</p></div>
      </div>
      <div v-else class="question-table-wrap">
        <table class="question-table">
          <thead><tr><th>問題</th><th>分類</th><th>公開状態</th><th>更新日</th><th><span class="sr-only">操作</span></th></tr></thead>
          <tbody>
            <tr v-for="question in questions" :key="question.id">
              <td data-label="問題">
                <strong class="question-number">試験 {{ question.exam_number }} ・ 問{{ question.question_number }}</strong>
                <p>{{ question.summary }}</p>
              </td>
              <td data-label="分類"><span>{{ majorCategoryLabel(question.major_category_code) }}</span><small>{{ getCategoryLabel(question.category_code) }}</small></td>
              <td data-label="公開状態">
                <div class="status-select-wrap" :class="statusClass(question.publication_status)">
                  <span class="status-dot" />
                  <select :value="question.publication_status" :disabled="updatingId === question.id" :aria-label="`試験${question.exam_number} 問${question.question_number}の公開状態`" @change="changeStatus(question, ($event.target as HTMLSelectElement).value)">
                    <option v-for="item in PUBLICATION_STATUSES" :key="item.value" :value="item.value">{{ item.label }}</option>
                  </select>
                </div>
              </td>
              <td data-label="更新日"><time :datetime="question.updated_at">{{ formatDate(question.updated_at) }}</time></td>
              <td class="row-actions">
                <NuxtLink :to="`/admin/questions/${question.id}/edit`" title="編集" aria-label="編集"><UIcon name="i-lucide-pencil" /></NuxtLink>
                <button type="button" title="削除" aria-label="削除" :disabled="updatingId === question.id" @click="deletingQuestion = question"><UIcon name="i-lucide-trash-2" /></button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <nav v-if="meta && meta.total_pages > 1" class="admin-pagination" aria-label="ページ切り替え">
        <button class="admin-secondary-button" type="button" :disabled="page <= 1" @click="page -= 1"><UIcon name="i-lucide-chevron-left" />前へ</button>
        <span>{{ meta.current_page }} / {{ meta.total_pages }} ページ</span>
        <button class="admin-secondary-button" type="button" :disabled="page >= meta.total_pages" @click="page += 1">次へ<UIcon name="i-lucide-chevron-right" /></button>
      </nav>
    </section>

    <Teleport to="body">
      <div v-if="deletingQuestion" class="admin-dialog-backdrop" @click.self="deletingQuestion = null">
        <section class="admin-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-title">
          <span class="dialog-icon danger"><UIcon name="i-lucide-triangle-alert" /></span>
          <h2 id="delete-title">問題を削除しますか？</h2>
          <p>試験 {{ deletingQuestion.exam_number }} の問{{ deletingQuestion.question_number }}を削除します。解答履歴などの関連データも削除されます。</p>
          <div class="dialog-actions">
            <button class="admin-secondary-button" type="button" @click="deletingQuestion = null">キャンセル</button>
            <button class="admin-danger-button" type="button" :disabled="updatingId === deletingQuestion.id" @click="deleteQuestion">{{ updatingId === deletingQuestion.id ? '削除中です' : '削除する' }}</button>
          </div>
        </section>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.filter-panel { margin-bottom: 18px; }
.filter-form { display: grid; grid-template-columns: minmax(220px, 1.7fr) 140px 180px 180px 150px auto; align-items: end; gap: 14px; }
.keyword-input { position: relative; }
.keyword-input :deep(svg) { position: absolute; top: 50%; left: 11px; width: 17px; height: 17px; color: #72858d; transform: translateY(-50%); }
.keyword-input input { padding-left: 36px; }
.filter-actions { display: flex; gap: 8px; }
.admin-inline-error { margin: 0 0 18px; }
.result-head .admin-icon-button { width: 38px; min-height: 38px; padding: 0; border-color: var(--admin-line); background: transparent; color: var(--admin-muted); }
.question-table-wrap { overflow-x: auto; }
.question-table { width: 100%; min-width: 860px; border-collapse: collapse; }
.question-table th { padding: 11px 15px; border-bottom: 1px solid var(--admin-line); background: #121b20; color: #85979f; font-size: 11px; letter-spacing: .03em; text-align: left; white-space: nowrap; }
.question-table td { padding: 15px; border-bottom: 1px solid var(--admin-line); color: #cdd9dc; font-size: 13px; vertical-align: middle; }
.question-table tbody tr:last-child td { border-bottom: 0; }
.question-table tbody tr:hover { background: rgba(255, 255, 255, .018); }
.question-table th:first-child { width: 42%; }
.question-table th:last-child { width: 90px; }
.question-number { display: block; color: var(--admin-text); font-size: 13px; }
.question-table td p { max-width: 560px; margin: 6px 0 0; overflow: hidden; color: var(--admin-muted); line-height: 1.55; text-overflow: ellipsis; white-space: nowrap; }
.question-table td:nth-child(2) span,
.question-table td:nth-child(2) small { display: block; }
.question-table td:nth-child(2) { min-width: 118px; }
.question-table td:nth-child(2) span { white-space: nowrap; }
.question-table td:nth-child(2) small { margin-top: 4px; color: var(--admin-muted); }
.question-table time { color: var(--admin-muted); white-space: nowrap; }
.status-select-wrap { min-width: 114px; display: inline-grid; grid-template-columns: 8px 1fr; align-items: center; gap: 7px; padding-left: 10px; border: 1px solid var(--admin-line); border-radius: 5px; background: #10191e; }
.status-select-wrap .status-dot { width: 7px; height: 7px; border-radius: 50%; background: #9cabb1; }
.status-select-wrap.status-published .status-dot { background: #35b979; }
.status-select-wrap.status-draft .status-dot { background: #d4aa4b; }
.status-select-wrap.status-private .status-dot { background: #829199; }
.status-select-wrap select { min-height: 35px; padding: 0 7px 0 0; border: 0; background: transparent; color: #d3dee0; font-size: 12px; font-weight: 700; }
.row-actions { display: flex; justify-content: flex-end; gap: 5px; }
.row-actions a,
.row-actions button { width: 35px; height: 35px; display: grid; place-items: center; padding: 0; border: 1px solid var(--admin-line); border-radius: 5px; background: transparent; color: var(--admin-muted); cursor: pointer; }
.row-actions a:hover { border-color: var(--admin-accent); color: var(--admin-accent-hover); }
.row-actions button:hover { border-color: var(--admin-danger); color: #ef9992; }
.row-actions button:disabled { opacity: .4; }
.admin-pagination { min-height: 68px; display: flex; align-items: center; justify-content: flex-end; gap: 14px; padding: 12px 18px; border-top: 1px solid var(--admin-line); }
.admin-pagination span { color: var(--admin-muted); font-size: 12px; }
.admin-pagination .admin-secondary-button { min-height: 36px; padding: 0 12px; font-size: 12px; }
.admin-dialog-backdrop { position: fixed; inset: 0; z-index: 90; display: grid; place-items: center; padding: 20px; background: rgba(2, 7, 9, .76); }
.admin-dialog { width: min(470px, 100%); padding: 28px; border: 1px solid var(--admin-line-strong); border-radius: 7px; background: var(--admin-surface-2); color: var(--admin-text); box-shadow: 0 24px 70px rgba(0, 0, 0, .38); }
.dialog-icon { width: 42px; height: 42px; display: grid; place-items: center; border-radius: 6px; background: rgba(216, 106, 98, .13); color: #ef9992; font-size: 22px; }
.admin-dialog h2 { margin: 18px 0 0; font-size: 21px; }
.admin-dialog p { margin: 12px 0 0; color: var(--admin-muted); font-size: 13px; line-height: 1.8; }
.dialog-actions { display: flex; justify-content: flex-end; gap: 9px; margin-top: 24px; }
@media (max-width: 1500px) {
  .filter-form { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .keyword-field { grid-column: span 2; }
  .filter-actions { justify-content: flex-end; }
}
@media (max-width: 760px) {
  .filter-form { grid-template-columns: 1fr 1fr; }
  .keyword-field { grid-column: 1 / -1; }
  .filter-actions { grid-column: 1 / -1; }
  .filter-actions button { flex: 1; }
  .question-table,
  .question-table tbody { display: block; }
  .question-table { min-width: 0; }
  .question-table thead { display: none; }
  .question-table tr { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding: 18px 15px; border-bottom: 1px solid var(--admin-line); }
  .question-table td { display: block; padding: 0; border: 0; }
  .question-table td::before { content: attr(data-label); display: block; margin-bottom: 6px; color: #758891; font-size: 10px; font-weight: 800; }
  .question-table td:first-child { grid-column: 1 / -1; }
  .question-table td p { white-space: normal; }
  .row-actions { align-items: end; }
  .row-actions::before { display: none !important; }
}
@media (max-width: 480px) {
  .filter-form { grid-template-columns: 1fr; }
  .keyword-field,
  .filter-actions { grid-column: auto; }
  .question-table tr { grid-template-columns: 1fr; }
  .question-table td:first-child { grid-column: auto; }
  .row-actions { justify-content: flex-start; }
  .admin-pagination { justify-content: center; }
  .dialog-actions { flex-direction: column-reverse; }
}
</style>
