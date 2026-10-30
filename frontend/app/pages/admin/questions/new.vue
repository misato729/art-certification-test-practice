<script setup lang="ts">
import type { FormError } from '@nuxt/ui'
import { apiFormErrors, questionFormFields } from '~/utils/apiFormErrors'
import type { AdminQuestion, AdminQuestionInput, ApiResponse } from '~/types/adminQuestion'
import { createEmptyQuestion } from '~/types/adminQuestion'

definePageMeta({ layout: 'admin', middleware: 'admin' })

const { $api: api } = useNuxtApp()
const { authHeaders, clearCurrentUser } = useAuth()
const initialValue = createEmptyQuestion()
const route = useRoute()
for (const key of ['exam_number', 'question_number', 'group_id', 'group_question_number'] as const) {
  const value = Number(route.query[key])
  if (Number.isSafeInteger(value) && value > 0) initialValue[key] = value
}
const submitting = ref(false)
const errorMessage = ref('')
const fieldErrors = ref<FormError[]>([])

const submit = async (question: AdminQuestionInput) => {
  if (submitting.value) return
  submitting.value = true
  errorMessage.value = ''
  fieldErrors.value = []

  try {
    const response = await api<ApiResponse<AdminQuestion>>('/api/v1/admin/questions', {
      method: 'POST',
      headers: authHeaders.value,
      body: { question },
    })
    await navigateTo({ path: `/admin/questions/${response.data.id}/edit`, query: { created: '1' } })
  }
  catch (error: any) {
    const code = error?.statusCode ?? error?.status
    if (code === 401 || code === 403) {
      if (code === 403) clearCurrentUser()
      await navigateTo({ path: '/login', query: { redirect: '/admin/questions/new' } })
      return
    }
    fieldErrors.value = apiFormErrors(error, questionFormFields)
    errorMessage.value = error?.data?.error?.message ?? '問題を保存できませんでした。入力内容を確認してください。'
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="admin-page">
    <header class="admin-page-head">
      <div><p class="admin-page-eyebrow">SC-102</p><h1>問題を作成</h1><p>問題文、選択肢、解答解説を入力し、新しい問題を登録します。</p></div>
      <NuxtLink v-if="initialValue.group_id" class="admin-secondary-button" :to="{ path: `/admin/exams/${initialValue.exam_number}`, query: { group_id: initialValue.group_id } }"><UIcon name="i-lucide-arrow-left" />大問に戻る</NuxtLink>
      <NuxtLink v-else class="admin-secondary-button" to="/admin/questions"><UIcon name="i-lucide-arrow-left" />一覧に戻る</NuxtLink>
    </header>
    <AdminQuestionForm :initial-value="initialValue" submit-label="問題を保存" :submitting="submitting" :error-message="errorMessage" :field-errors="fieldErrors" @submit="submit" />
  </div>
</template>
