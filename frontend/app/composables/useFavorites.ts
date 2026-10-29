import { canUseFavoriteFeature, PAYMENTS_ENABLED } from '../utils/examConfig.ts'
import type { FavoriteQuestion } from './useAuth'

type FavoriteResponse = { data: { question: FavoriteQuestion } }

export const useFavorites = () => {
  const { $api: api } = useNuxtApp()
  const { user, sessionVersion, isLoggedIn, authHeaders } = useAuth()
  const canUseFavorites = computed(() => canUseFavoriteFeature(isLoggedIn.value, user.value))
  const favorites = computed(() => canUseFavorites.value ? user.value?.favorite_questions ?? [] : [])
  const favoriteIds = computed(() => favorites.value.map(question => question.id))

  const isFavorite = (questionId: number) => favoriteIds.value.includes(questionId)

  const isFavoriteAt = (examNumber: number, questionNumber: number) => (
    favorites.value.some(question => question.exam_number === examNumber && question.question_number === questionNumber)
  )

  const setFavorite = (question: FavoriteQuestion, favorite: boolean) => {
    if (!canUseFavorites.value || !user.value) return
    const remaining = favorites.value.filter(item => item.id !== question.id)
    user.value.favorite_questions = favorite
      ? [{ id: question.id, exam_number: question.exam_number, question_number: question.question_number }, ...remaining]
      : remaining
  }

  const disableFavorites = () => {
    if (!user.value) return
    user.value.favorite_questions = []
    user.value.paid_content_access = false
  }

  const toggleFavorite = async (question: FavoriteQuestion) => {
    if (!canUseFavorites.value) throw new Error(PAYMENTS_ENABLED ? 'お気に入りの利用にはプレミアム会員資格が必要です。' : 'お気に入りの利用にはログインが必要です。')
    const owner = user.value
    const version = sessionVersion.value
    const adding = !isFavorite(question.id)

    try {
      const response = await api<FavoriteResponse | undefined>(`/api/v1/questions/${question.id}/favorite`, {
        method: adding ? 'PUT' : 'DELETE',
        headers: authHeaders.value,
      })
      if (user.value?.id === owner?.id && sessionVersion.value === version) {
        setFavorite(response?.data.question ?? question, adding)
      }
      return adding
    }
    catch (error: any) {
      if (sessionVersion.value === version && error?.data?.error?.code === 'paid_membership_required') disableFavorites()
      throw error
    }
  }

  return {
    canUseFavorites,
    favoriteIds,
    isFavorite,
    isFavoriteAt,
    setFavorite,
    disableFavorites,
    toggleFavorite,
  }
}
