<script setup lang="ts">
import type { input as SchemaInput } from 'zod'
import type { Form } from '@nuxt/ui'
import type { ExamSet, QuestionGroup, GroupQuestion } from '../../../../shared/types/learning'
import { examSetInputSchema, questionGroupInputSchema, type ExamSetInput, type QuestionGroupInput } from '../../../../shared/schemas/structure'
import type { AdminQuestion, ApiResponse, PaginatedApiResponse, AdminQuestionSummary } from '~/types/adminQuestion'
import { apiFormErrors, focusFormError } from '~/utils/apiFormErrors'
import { questionCountForExam } from '../../../../shared/schemas/exam'

definePageMeta({ layout: 'admin', middleware: 'admin' })
const route = useRoute()
const examNumber = computed(() => Number(route.params.examNumber))
const { $api: api } = useNuxtApp()
const { authHeaders, clearCurrentUser } = useAuth()
const { data: response, status, error, refresh } = await useFetch<ApiResponse<ExamSet>>(() => `/api/v1/admin/exams/${examNumber.value}`, { $fetch: api, headers: authHeaders, server: false })
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value))
const examSchema = examSetInputSchema(EXAM_CONFIG)
const groupSchema = questionGroupInputSchema(EXAM_CONFIG)
const examForm = useTemplateRef<Form<typeof examSchema>>('examForm')
const groupForm = useTemplateRef<Form<typeof groupSchema>>('groupForm')
const createGroupForm = useTemplateRef<Form<typeof groupSchema>>('createGroupForm')
const examDraft = reactive<ExamSetInput>({ title: '', publication_status: 'draft', lock_version: 0 })
const groupDraft = ref<QuestionGroupInput | null>(null)
const groupFormState = computed(() => groupDraft.value as unknown as SchemaInput<typeof groupSchema>)
const newGroup = reactive<QuestionGroupInput>({ group_number: 1, title: '', planned_question_count: 1, publication_status: 'draft', passages: [] })
const newGroupState = newGroup as unknown as SchemaInput<typeof groupSchema>
const statusItems = PUBLICATION_STATUSES.map(item => ({ ...item }))
const selectedGroupId = ref<number | null>(null)
const groupQuestions = ref<GroupQuestion[]>([])
const loadingGroup = ref(false)
const busy = ref(false)
const actionError = ref('')
const successMessage = ref('')
const validation = ref<{ valid: boolean; errors: string[] } | null>(null)
const previewOpen = ref(false)
const previewLoading = ref(false)
const previewQuestions = ref<AdminQuestion[]>([])
const usedNumbers = ref<number[]>([])
const questionLimit = computed(() => questionCountForExam(EXAM_CONFIG, examNumber.value))
const groupFields = { title: '大問タイトル', group_number: '大問番号', planned_question_count: '予定問数', publication_status: '公開状態', passages: '共通本文', question_ids: '小問の順序', lock_version: '更新状態' }
const examFields = { title: '模擬試験名', publication_status: '公開状態', lock_version: '更新状態' }
let groupRequest = 0

watch(() => response.value?.data, value => {
  if (!value) return
  Object.assign(examDraft, { title: value.title, publication_status: value.publication_status, lock_version: value.lock_version })
  newGroup.group_number = Math.max(0, ...value.groups.map(item => item.group_number)) + 1
  if (!value.groups.some(item => item.id === selectedGroupId.value)) {
    const requestedId = Number(route.query.group_id)
    selectedGroupId.value = value.groups.find(item => item.id === requestedId)?.id ?? value.groups[0]?.id ?? null
  }
}, { immediate: true })

const handleError = async (failure: any, kind?: 'exam' | 'group' | 'create') => {
  const code = failure?.statusCode ?? failure?.status
  if (code === 401 || code === 403) {
    if (code === 403) clearCurrentUser()
    await navigateTo({ path: '/login', query: { redirect: route.fullPath } })
    return
  }
  const form = kind === 'exam' ? examForm.value : kind === 'create' ? createGroupForm.value : groupForm.value
  form?.setErrors(apiFormErrors(failure, kind === 'exam' ? examFields : groupFields))
  actionError.value = failure?.data?.error?.message ?? '保存できませんでした。入力内容と通信状態を確認してください。'
}
const run = async (action: () => Promise<void>, kind?: 'exam' | 'group' | 'create') => {
  if (busy.value) return
  busy.value = true; actionError.value = ''; successMessage.value = ''; validation.value = null
  try { await action() } catch (failure) { await handleError(failure, kind) } finally { busy.value = false }
}
const setGroup = (value: QuestionGroup) => {
  groupDraft.value = { group_number: value.group_number, title: value.title, planned_question_count: value.planned_question_count, publication_status: value.publication_status, lock_version: value.lock_version, passages: clone(value.passages), question_ids: value.questions?.map(question => question.id) ?? [] }
  groupQuestions.value = clone(value.questions ?? [])
  previewOpen.value = false; previewQuestions.value = []
}
const loadGroup = async (id: number | null) => {
  const request = ++groupRequest
  groupDraft.value = null; groupQuestions.value = []; previewOpen.value = false
  if (!id) { loadingGroup.value = false; return }
  loadingGroup.value = true
  try {
    const value = await api<ApiResponse<QuestionGroup>>(`/api/v1/admin/question_groups/${id}`, { headers: authHeaders.value })
    if (request === groupRequest && selectedGroupId.value === id) setGroup(value.data)
  } catch (failure) { if (request === groupRequest) await handleError(failure) }
  finally { if (request === groupRequest) loadingGroup.value = false }
}
watch(selectedGroupId, loadGroup, { immediate: true })
const loadUsedNumbers = async () => {
  const numbers: number[] = []
  try {
    let page = 1
    let totalPages = 1
    do {
      const value = await api<PaginatedApiResponse<AdminQuestionSummary>>('/api/v1/admin/questions', { headers: authHeaders.value, query: { exam_number: examNumber.value, per_page: 100, page } })
      numbers.push(...value.data.map(question => question.question_number))
      totalPages = value.meta.total_pages
      page++
    } while (page <= totalPages)
    usedNumbers.value = numbers
  } catch { /* Duplicate coordinates remain validated by the server. */ }
}
onMounted(loadUsedNumbers)
const nextQuestionNumber = computed(() => {
  for (let number = 1; number <= questionLimit.value; number++) if (!usedNumbers.value.includes(number)) return number
  return null
})
const newQuestionLink = computed(() => ({ path: '/admin/questions/new', query: { exam_number: examNumber.value, question_number: nextQuestionNumber.value ?? undefined, group_id: selectedGroupId.value ?? undefined, group_question_number: groupQuestions.value.length + 1 } }))
const saveExam = () => run(async () => {
  await api(`/api/v1/admin/exams/${examNumber.value}`, { method: 'PATCH', headers: authHeaders.value, body: { exam: clone(examDraft) } })
  await refresh(); successMessage.value = '模擬試験の設定を保存しました。'
}, 'exam')
const addGroup = () => run(async () => {
  const value = await api<ApiResponse<QuestionGroup>>(`/api/v1/admin/exams/${examNumber.value}/groups`, { method: 'POST', headers: authHeaders.value, body: { group: clone(newGroup) } })
  await refresh(); selectedGroupId.value = value.data.id; newGroup.title = ''; successMessage.value = '大問の下書きを作成しました。'
}, 'create')
const addPassage = () => {
  if (!groupDraft.value) return
  const passages = groupDraft.value.passages ?? []
  const labels = new Set(passages.map(passage => passage.label))
  let index = 0
  while (labels.has(String.fromCharCode(65 + index))) index++
  groupDraft.value.passages = [...passages, { label: String.fromCharCode(65 + index), display_order: passages.length + 1, content_blocks: [{ type: 'text', text: '' }] }]
}
const movePassage = (index: number, direction: -1 | 1) => {
  const passages = groupDraft.value?.passages
  if (!passages || index + direction < 0 || index + direction >= passages.length) return
  const [passage] = passages.splice(index, 1)
  if (passage) passages.splice(index + direction, 0, passage)
  passages.forEach((item, order) => { item.display_order = order + 1 })
}
const removePassage = (index: number) => {
  if (!groupDraft.value) return
  groupDraft.value.passages = groupDraft.value.passages?.filter((_, offset) => offset !== index).map((passage, offset) => ({ ...passage, display_order: offset + 1 }))
}
const moveQuestion = (index: number, direction: -1 | 1) => {
  if (!groupDraft.value || index + direction < 0 || index + direction >= groupQuestions.value.length) return
  const [question] = groupQuestions.value.splice(index, 1)
  if (question) groupQuestions.value.splice(index + direction, 0, question)
  groupDraft.value.question_ids = groupQuestions.value.map(item => item.id)
}
const saveGroup = () => run(async () => {
  if (!groupDraft.value || !selectedGroupId.value) return
  const input = clone(groupDraft.value)
  input.passages?.forEach((passage, index) => { passage.display_order = index + 1 })
  const value = await api<ApiResponse<QuestionGroup>>(`/api/v1/admin/question_groups/${selectedGroupId.value}`, { method: 'PUT', headers: authHeaders.value, body: { group: input } })
  setGroup(value.data); await refresh(); await loadUsedNumbers(); successMessage.value = '大問と共通本文を保存しました。'
}, 'group')
const validateExam = () => run(async () => {
  const value = await api<ApiResponse<{ valid: boolean; errors: string[] }>>(`/api/v1/admin/exams/${examNumber.value}/validate`, { method: 'POST', headers: authHeaders.value, body: { lock_version: examDraft.lock_version } })
  validation.value = value.data
})
const publishExam = () => run(async () => {
  await api(`/api/v1/admin/exams/${examNumber.value}/publish`, { method: 'POST', headers: authHeaders.value, body: { lock_version: examDraft.lock_version } })
  await refresh(); await loadGroup(selectedGroupId.value); successMessage.value = '公開条件を確認し、模擬試験を公開しました。'
})
const deleteGroup = () => run(async () => {
  if (!selectedGroupId.value || groupQuestions.value.length) return
  await api(`/api/v1/admin/question_groups/${selectedGroupId.value}`, { method: 'DELETE', headers: authHeaders.value })
  selectedGroupId.value = null; groupDraft.value = null; await refresh(); successMessage.value = '空の大問を削除しました。'
})
const togglePreview = async () => {
  if (previewOpen.value) { previewOpen.value = false; return }
  if (!selectedGroupId.value || previewLoading.value) return
  const id = selectedGroupId.value
  previewLoading.value = true
  try {
    const values = await Promise.all(groupQuestions.value.map(question => api<ApiResponse<AdminQuestion>>(`/api/v1/admin/questions/${question.id}`, { headers: authHeaders.value })))
    if (selectedGroupId.value === id) { previewQuestions.value = values.map(value => value.data); previewOpen.value = true }
  } catch (failure) { await handleError(failure) } finally { previewLoading.value = false }
}
</script>

<template>
  <div class="admin-page">
    <header class="admin-page-head"><div><h1>模擬試験・大問を編集</h1><p>模擬試験 {{ examNumber }} の構成と共通本文を管理します。</p></div><NuxtLink class="admin-secondary-button" to="/admin/exams">模擬試験一覧</NuxtLink></header>
    <p v-if="successMessage" class="editor-success" role="status">{{ successMessage }}</p>
    <p v-if="actionError" class="admin-inline-error" role="alert">{{ actionError }}</p>
    <div v-if="status === 'pending'" class="admin-panel admin-loading" role="status"><div>模擬試験を読み込んでいます。</div></div>
    <div v-else-if="error || !response?.data" class="admin-panel admin-empty" role="alert"><div><h2>模擬試験を読み込めませんでした</h2><button class="admin-secondary-button" type="button" @click="() => refresh()">再読み込み</button></div></div>
    <template v-else>
      <section class="admin-panel">
        <div class="admin-panel-head"><div><h2>模擬試験の設定</h2><p>名称と公開状態を管理します。</p></div></div>
        <UForm ref="examForm" :schema="examSchema" :state="examDraft" :transform="false" class="admin-panel-body exam-settings" novalidate @error="focusFormError" @submit="saveExam">
          <FormTextField id="exam-title" v-model="examDraft.title" admin name="title" label="模擬試験名" />
          <UFormField name="publication_status" label="公開状態" class="admin-field" :ui="{ error: 'form-field-error' }"><USelect id="exam-status" v-model="examDraft.publication_status" :items="statusItems" value-key="value" label-key="label" class="w-full" /></UFormField>
          <button class="admin-primary-button" type="submit" :disabled="busy">模擬試験を保存</button>
        </UForm>
      </section>
      <div class="group-workspace">
        <aside class="admin-panel group-navigation">
          <details open><summary>大問の構成</summary><nav aria-label="大問の構成"><button v-for="item in response.data.groups" :key="item.id" type="button" :class="{ selected: selectedGroupId === item.id }" :disabled="busy" @click="selectedGroupId = item.id"><strong>大問{{ item.group_number }}</strong><span>{{ item.title }}</span><small>{{ item.questions?.length ?? 0 }} / {{ item.planned_question_count }}問</small></button></nav></details>
          <details class="new-group"><summary>大問を追加</summary><UForm ref="createGroupForm" :schema="groupSchema" :state="newGroupState" :transform="false" novalidate @error="focusFormError" @submit="addGroup"><FormTextField id="new-group-number" v-model="newGroup.group_number" admin name="group_number" label="大問番号" type="number" min="1" /><FormTextField id="new-group-title" v-model="newGroup.title" admin name="title" label="大問タイトル" /><FormTextField id="new-group-size" v-model="newGroup.planned_question_count" admin name="planned_question_count" label="予定問数" type="number" min="1" :max="questionLimit" /><button class="admin-primary-button" type="submit" :disabled="busy">下書きを作成</button></UForm></details>
        </aside>
        <div class="group-content">
          <div v-if="loadingGroup" class="admin-panel admin-loading" role="status"><div>大問を読み込んでいます。</div></div>
          <UForm v-else-if="groupDraft" ref="groupForm" :key="selectedGroupId ?? 'none'" :schema="groupSchema" :state="groupFormState" :transform="false" class="group-form" novalidate @error="focusFormError" @submit="saveGroup">
            <section class="admin-panel"><div class="admin-panel-head"><h2>大問の設定</h2></div><div class="admin-panel-body admin-form-grid"><FormTextField id="group-title" v-model="groupDraft.title" admin name="title" label="大問タイトル" /><FormTextField id="group-number" v-model="groupDraft.group_number" admin name="group_number" label="大問番号" type="number" min="1" /><FormTextField id="group-size" v-model="groupDraft.planned_question_count" admin name="planned_question_count" label="予定問数" type="number" min="1" :max="questionLimit" /><UFormField name="publication_status" label="公開状態" class="admin-field" :ui="{ error: 'form-field-error' }"><USelect id="group-status" v-model="groupDraft.publication_status" :items="statusItems" value-key="value" label-key="label" class="w-full" /></UFormField></div></section>
            <section class="admin-panel"><div class="admin-panel-head"><div><h2>共通本文</h2><p>同じ大問の複数の小問から参照できます。</p></div><button class="admin-secondary-button" type="button" @click="addPassage">本文を追加</button></div><div class="admin-panel-body"><UFormField name="passages" :error-pattern="/^passages(?:\.|$)/" :ui="{ error: 'form-field-error' }"><div class="passages-editor"><article v-for="(passage, index) in groupDraft.passages ?? []" :key="passage.id ?? `new-${index}`" class="passage-editor"><header><FormTextField :id="`passage-label-${index}`" v-model="passage.label" admin :name="`passages.${index}.label`" label="本文のラベル" /><div class="passage-actions"><button class="admin-icon-button" type="button" :disabled="index === 0" aria-label="本文を上へ" @click="movePassage(index, -1)"><UIcon name="i-lucide-arrow-up" /></button><button class="admin-icon-button" type="button" :disabled="index === (groupDraft.passages?.length ?? 0) - 1" aria-label="本文を下へ" @click="movePassage(index, 1)"><UIcon name="i-lucide-arrow-down" /></button><button class="admin-icon-button" type="button" aria-label="本文を削除" @click="removePassage(index)"><UIcon name="i-lucide-trash-2" /></button></div></header><UFormField :name="`passages.${index}.content_blocks`" :error-pattern="new RegExp(`^passages\\.${index}\\.content_blocks(?:\\.|$)` )" :ui="{ error: 'form-field-error' }"><AdminContentBlockEditor v-model="passage.content_blocks" context="question" allow-references /></UFormField></article><p v-if="!groupDraft.passages?.length" class="editor-note">共通本文がない大問としても管理できます。</p></div></UFormField></div></section>
            <section class="admin-panel"><div class="admin-panel-head"><div><h2>小問と表示順</h2><p>並べ替えても、URLに使う通し番号は変わりません。</p></div><NuxtLink v-if="nextQuestionNumber !== null" class="admin-secondary-button" :to="newQuestionLink">小問を作成</NuxtLink></div><div class="admin-panel-body"><UFormField name="question_ids" :ui="{ error: 'form-field-error' }"><ol class="group-questions"><li v-for="(question, index) in groupQuestions" :key="question.id"><div><strong>問{{ index + 1 }} <small>通し問{{ question.question_number }}</small></strong><p>{{ question.summary }}</p></div><div class="question-actions"><button class="admin-icon-button" type="button" :disabled="index === 0" aria-label="小問を上へ" @click="moveQuestion(index, -1)"><UIcon name="i-lucide-arrow-up" /></button><button class="admin-icon-button" type="button" :disabled="index === groupQuestions.length - 1" aria-label="小問を下へ" @click="moveQuestion(index, 1)"><UIcon name="i-lucide-arrow-down" /></button><NuxtLink class="admin-secondary-button" :to="`/admin/questions/${question.id}/edit`">編集</NuxtLink></div></li></ol></UFormField><p v-if="!groupQuestions.length" class="editor-note">大問と共通本文を保存してから小問を作成してください。</p></div></section>
            <div class="group-save-bar"><p class="editor-note">本文を変更しても回答履歴は残ります。以前の内容への回答は、現在の問題と区別して表示されます。</p><div><button class="admin-secondary-button" type="button" :disabled="previewLoading" @click="togglePreview">{{ previewLoading ? '読み込み中' : previewOpen ? '全体プレビューを閉じる' : '大問全体をプレビュー' }}</button><button class="admin-primary-button" type="submit" :disabled="busy">{{ busy ? '保存中です' : '大問・共通本文を保存' }}</button><button v-if="!groupQuestions.length" class="admin-secondary-button" type="button" :disabled="busy" @click="deleteGroup">空の大問を削除</button></div></div>
          </UForm>
          <section v-if="previewOpen && groupDraft" class="admin-panel"><div class="admin-panel-head"><h2>大問全体のプレビュー</h2></div><div class="admin-panel-body group-preview"><header><h2>{{ groupDraft.title }}</h2><article v-for="passage in groupDraft.passages ?? []" :key="passage.id ?? passage.label"><h3>【{{ passage.label }}】</h3><QuestionContentBlocks :blocks="passage.content_blocks" /></article></header><AdminQuestionPreview v-for="question in previewQuestions" :key="question.id" :question="question" /></div></section>
        </div>
      </div>
      <section class="admin-panel publish-panel"><div class="admin-panel-head"><div><h2>公開前の確認</h2><p>保存済みの構成を検査します。保存前の編集内容は検査に含まれません。</p></div></div><div class="admin-panel-body"><div class="publish-actions"><button class="admin-secondary-button" type="button" :disabled="busy" @click="validateExam">公開条件を検査</button><button class="admin-primary-button" type="button" :disabled="busy" @click="publishExam">検査して模擬試験を公開</button></div><div v-if="validation" class="validation-result" :class="{ valid: validation.valid }" role="status"><strong>{{ validation.valid ? '公開条件を満たしています。' : '次の内容を確認してください。' }}</strong><ul v-if="validation.errors.length"><li v-for="(message, index) in validation.errors" :key="index">{{ message }}</li></ul></div></div></section>
    </template>
  </div>
</template>

<style scoped>
.editor-success { margin: 0 0 18px; padding: 13px 15px; border: 1px solid #287b78; border-radius: 5px; color: #8dd8d4; background: #112323; font-size: 13px; }
.exam-settings { display: grid; grid-template-columns: 2fr 1fr auto; align-items: end; gap: 14px; }
.group-workspace { display: grid; grid-template-columns: 245px minmax(0, 1fr); align-items: start; gap: 18px; margin-top: 18px; }
.group-navigation { min-width: 0; position: sticky; top: 80px; }
.group-navigation summary { padding: 16px; font-weight: 800; cursor: pointer; font-size: 14px; }
.group-navigation nav { display: grid; gap: 4px; padding: 0 8px 12px; }
.group-navigation nav button { display: grid; gap: 5px; min-width: 0; padding: 12px; border: 1px solid transparent; border-radius: 5px; background: transparent; color: var(--admin-text); text-align: left; cursor: pointer; }
.group-navigation nav button.selected { border-color: var(--admin-line-strong); background: var(--admin-surface-3); }
.group-navigation nav span,.group-navigation nav small { overflow-wrap: anywhere; color: var(--admin-muted); font-size: 12px; }
.new-group { border-top: 1px solid var(--admin-line); }
.new-group form { display: grid; gap: 12px; padding: 0 16px 16px; }
.group-content,.group-form { min-width: 0; display: grid; gap: 18px; }
.passages-editor { display: grid; gap: 18px; }
.passage-editor { min-width: 0; padding: 14px; border: 1px solid var(--admin-line); border-radius: 6px; }
.passage-editor > header { display: flex; align-items: end; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.passage-editor > header .admin-field { width: min(180px, 100%); }
.passage-actions,.question-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.admin-icon-button { width: 34px; min-height: 34px; padding: 0; }
.group-questions { display: grid; gap: 12px; margin: 0; padding: 0; list-style: none; }
.group-questions li { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--admin-line); }
.group-questions li:last-child { border-bottom: 0; }
.group-questions strong { font-size: 14px; }
.group-questions small { color: var(--admin-muted); font-size: 11px; font-weight: 500; }
.group-questions p,.editor-note { margin: 7px 0 0; color: var(--admin-muted); font-size: 12px; line-height: 1.7; overflow-wrap: anywhere; }
.group-save-bar { display: grid; gap: 12px; padding: 16px; border: 1px solid var(--admin-line-strong); border-radius: 6px; background: var(--admin-surface); }
.group-save-bar > div,.publish-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.group-preview { display: grid; gap: 20px; }
.group-preview > header { padding: 22px; background: #fff; color: var(--ink); border-radius: 6px; }
.group-preview > header h2 { margin: 0 0 20px; font-size: 20px; }
.group-preview article + article { margin-top: 24px; }
.publish-panel { margin-top: 18px; }
.validation-result { margin-top: 18px; padding: 16px; border: 1px solid var(--admin-line); border-radius: 5px; font-size: 13px; line-height: 1.8; }
.validation-result.valid { border-color: #287b78; color: #8dd8d4; }
.validation-result ul { margin: 10px 0 0; padding-left: 20px; }
@media (max-width: 1250px) { .exam-settings { grid-template-columns: 1fr 1fr; } .group-workspace { grid-template-columns: 200px minmax(0, 1fr); } }
@media (max-width: 900px) { .group-workspace { grid-template-columns: 1fr; } .group-navigation { position: static; } .group-navigation nav { grid-template-columns: repeat(2, minmax(0, 1fr)); } .group-questions li { grid-template-columns: 1fr; } }
@media (max-width: 640px) { .exam-settings,.group-navigation nav { grid-template-columns: 1fr; } .passage-editor { padding: 10px; } .passage-editor > header { align-items: stretch; flex-direction: column; } .group-save-bar > div,.publish-actions { display: grid; grid-template-columns: 1fr; } .group-preview > header { padding: 16px; } }
</style>
