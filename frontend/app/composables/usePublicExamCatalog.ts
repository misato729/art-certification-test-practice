import type { ExamCatalogEntry } from '../utils/examCatalog'

/** Only the server-authorized catalog defines public question positions. */
export const usePublicExamCatalog = () => {
  const { $api: api } = useNuxtApp()
  const { authHeaders, sessionVersion, user } = useAuth()
  return useFetch<{ data: ExamCatalogEntry[] }>('/api/v1/exams', {
    key: 'public-exam-catalog', $fetch: api, headers: authHeaders,
    server: false, lazy: true,
    watch: [sessionVersion, () => user.value?.id, () => user.value?.role, () => user.value?.paid_content_access],
  })
}
