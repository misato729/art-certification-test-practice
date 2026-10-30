<script setup lang="ts">
import type { ExamSet } from '../../../../shared/types/learning'
import type { ApiResponse } from '~/types/adminQuestion'

definePageMeta({ layout: 'admin', middleware: 'admin' })
const { $api: api } = useNuxtApp()
const { authHeaders } = useAuth()
const { data: response, status, error, refresh } = await useFetch<ApiResponse<ExamSet[]>>('/api/v1/admin/exams', { $fetch: api, headers: authHeaders, server: false })
</script>

<template>
  <div class="admin-page">
    <header class="admin-page-head"><div><h1>模擬試験・大問</h1><p>模擬試験の構成、共通本文、小問の順序と公開状態を管理します。</p></div><NuxtLink class="admin-secondary-button" to="/admin/questions">問題一覧</NuxtLink></header>
    <div v-if="status === 'pending'" class="admin-panel admin-loading" role="status"><div>模擬試験を読み込んでいます。</div></div>
    <div v-else-if="error" class="admin-panel admin-empty" role="alert"><div><h2>模擬試験を読み込めませんでした</h2><button class="admin-secondary-button" type="button" @click="() => refresh()">再読み込み</button></div></div>
    <section v-else class="exam-list">
      <article v-for="exam in response?.data ?? []" :key="exam.exam_number" class="admin-panel exam-entry">
        <div><span class="exam-label">模擬試験 {{ exam.exam_number }}</span><h2>{{ exam.title }}</h2><p>{{ exam.groups.length }}大問・{{ getMasterDataLabel(PUBLICATION_STATUSES, exam.publication_status) }}</p></div><NuxtLink class="admin-secondary-button" :to="`/admin/exams/${exam.exam_number}`">構成を編集<UIcon name="i-lucide-chevron-right" /></NuxtLink>
      </article>
      <p v-if="!response?.data.length" class="load-message">管理できる模擬試験はありません。</p>
    </section>
  </div>
</template>

<style scoped>
.exam-list { display: grid; gap: 14px; }
.exam-entry { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 22px; min-width: 0; }
.exam-entry h2 { margin: 7px 0; font-size: 20px; overflow-wrap: anywhere; }
.exam-label,.exam-entry p,.load-message { color: var(--admin-muted); font-size: 13px; line-height: 1.7; }
.exam-entry p { margin: 0; }
@media (max-width: 640px) { .exam-entry { align-items: stretch; flex-direction: column; } }
</style>
