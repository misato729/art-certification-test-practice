<script setup lang="ts">
import type { FormError } from '@nuxt/ui'
import { apiFormErrors, questionFormFields } from '~/utils/apiFormErrors'
import type { AdminQuestion, AdminQuestionInput, ApiResponse } from '~/types/adminQuestion'

definePageMeta({ layout: 'admin', middleware: 'admin' })

const route = useRoute()
const { $api: api } = useNuxtApp()
const { authHeaders, clearCurrentUser } = useAuth()
const questionId = computed(() => Number(route.params.questionId))
const submitting = ref(false)
const errorMessage = ref('')
const fieldErrors = ref<FormError[]>([])
const successMessage = ref(route.query.created === '1' ? '問題を作成しました。' : '')

const {
  data: response,
  status,
  error,
  refresh,
} = await useFetch<ApiResponse<AdminQuestion>>(() => `/api/v1/admin/questions/${questionId.value}`, {
  $fetch: api,
  headers: authHeaders,
  server: false,
})

const question = computed(() => response.value?.data)
const questionInput = computed<AdminQuestionInput | null>(() => {
  if (!question.value) return null
  const { id: _id, created_at: _createdAt, updated_at: _updatedAt, shared_passages: _passages, question_version: _questionVersion, ...input } = question.value
  return input
})

const submit = async (input: AdminQuestionInput) => {
  if (submitting.value) return
  submitting.value = true
  errorMessage.value = ''
  fieldErrors.value = []
  successMessage.value = ''

  try {
    await api(`/api/v1/admin/questions/${questionId.value}`, {
      method: 'PATCH',
      headers: authHeaders.value,
      body: { question: input },
    })
    await refresh()
    successMessage.value = '編集内容を保存しました。'
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  catch (requestError: any) {
    const code = requestError?.statusCode ?? requestError?.status
    if (code === 401 || code === 403) {
      if (code === 403) clearCurrentUser()
      await navigateTo({ path: '/login', query: { redirect: route.fullPath } })
      return
    }
    fieldErrors.value = apiFormErrors(requestError, questionFormFields)
    errorMessage.value = requestError?.data?.error?.message ?? '編集内容を保存できませんでした。入力内容を確認してください。'
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="admin-page">
    <header class="admin-page-head">
      <div><p class="admin-page-eyebrow">SC-103</p><h1>問題を編集</h1><p v-if="question">試験 {{ question.exam_number }} の問{{ question.question_number }}を編集しています。</p><p v-else>登録済みの問題を読み込んでいます。</p></div>
      <NuxtLink v-if="question?.group_id" class="admin-secondary-button" :to="{ path: `/admin/exams/${question.exam_number}`, query: { group_id: question.group_id } }"><UIcon name="i-lucide-arrow-left" />大問に戻る</NuxtLink>
      <NuxtLink v-else class="admin-secondary-button" to="/admin/questions"><UIcon name="i-lucide-arrow-left" />一覧に戻る</NuxtLink>
    </header>

    <p v-if="successMessage" class="success-message" role="status"><UIcon name="i-lucide-circle-check" />{{ successMessage }}</p>

    <div v-if="status === 'pending'" class="admin-panel admin-loading"><div><UIcon name="i-lucide-loader-circle" /><span>問題を読み込んでいます</span></div></div>
    <div v-else-if="error || !questionInput" class="admin-panel admin-empty"><div><UIcon name="i-lucide-circle-alert" /><h2>問題を表示できません</h2><p>問題が削除されたか、通信に失敗した可能性があります。</p><button class="admin-secondary-button" type="button" @click="() => refresh()">再読み込み</button></div></div>
    <AdminQuestionForm v-else :initial-value="questionInput" submit-label="編集内容を保存" :submitting="submitting" :error-message="errorMessage" :field-errors="fieldErrors" @submit="submit" />
  </div>
</template>

<style scoped>
.success-message { display: flex; align-items: center; gap: 8px; margin: 0 0 18px; padding: 13px 15px; border: 1px solid rgba(53, 185, 121, .45); border-radius: 5px; background: rgba(53, 185, 121, .09); color: #83d9ad; font-size: 13px; font-weight: 700; }
</style>
