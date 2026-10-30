<script setup lang="ts">
import type { NitroFetchOptions } from 'nitropack/types'
import type { LearningBlock as ContentBlock, GroupPassage, PassageReference } from '../../../../shared/types/learning'
import { canRetainPassageContext, isCurrentPracticeRequest, reconcilePassageContext, type PracticePassageContext, type PracticeRequestTag } from '~/utils/practicePassageState'
import { EXAM_CATALOG, FREE_EXAM_MAX, publishedQuestionNumbers } from '~/utils/examCatalog'
import {
  selectPracticePositions,
  shufflePracticeSequence,
  type PracticeOrder,
  type PracticePosition,
} from '~/utils/practiceSequence'

type Choice = {
  id: number
  choice_label: string
  content_blocks: ContentBlock[]
  display_order: number
}

type Question = {
  id: number
  exam_number: number
  question_number: number
  content_blocks: ContentBlock[]
  major_category_code: string
  category_code: string
  choices: Choice[]
  is_favorite?: boolean
  group_question_number?: number | null
  group?: { id: number; group_number: number; title: string; question_numbers: number[] } | null
  shared_passages?: GroupPassage[]
  passage_references?: PassageReference[]
  question_version: number
}

type AnswerResult = {
  question_id: number
  selected_choice_id: number
  is_correct: boolean
  correct_choice: Choice
  explanation_blocks: ContentBlock[]
  source_text: string | null
  answer_history_id: number | null
  question_version?: number
}

type AnswerHistoryDetail = {
  id: number
  question_version?: number
  is_outdated?: boolean
  question: { id: number }
  selected_choice: { id: number }
  is_correct: boolean
  correct_choice: Choice
  explanation_blocks: ContentBlock[]
  source_text: string | null
}

type ApiResponse<T> = { data: T }

type SourceReference = {
  label: string
  url: string | null
}

definePageMeta({ key: route => `practice:${String(route.params.examNumber)}` })

const route = useRoute()
const { $api: api } = useNuxtApp()
const { isLoggedIn, user, sessionVersion, authHeaders } = useAuth()
const { canUseFavorites, isFavorite, setFavorite, toggleFavorite } = useFavorites()
const updatingFavorite = ref(false)

const allExamNumbers = EXAM_CATALOG.map(exam => exam.exam_number)
const { data: matchingCatalog, status: catalogStatus, error: catalogError, refresh: refreshCatalog } = await usePublicExamCatalog()
const allQuestionNumbers = computed(() => publishedQuestionNumbers(matchingCatalog.value?.data ?? []))

const parseNumberSelection = (value: unknown, allowedNumbers: readonly number[]) => {
  const serialized = Array.isArray(value) ? value.join(',') : typeof value === 'string' ? value : ''
  return [...new Set(
    serialized
      .split(',')
      .map(part => Number(part))
      .filter(number => Number.isInteger(number) && allowedNumbers.includes(number)),
  )].sort((left, right) => left - right)
}

const examNumber = computed(() => Number(route.params.examNumber))
const questionNumber = computed(() => Number(route.params.questionNumber))
const currentExam = computed(() => (matchingCatalog.value?.data ?? []).find(exam => exam.exam_number === examNumber.value))
const hasConditionSelection = computed(() => (
  route.query.exams !== undefined || route.query.questions !== undefined
))
const practiceOrder = computed<PracticeOrder>(() => (
  route.query.order === 'random' ? 'random' : 'sequential'
))
const practiceSeed = computed(() => {
  const value = Array.isArray(route.query.seed) ? route.query.seed[0] : route.query.seed
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null

  const seed = Number(value)
  return Number.isSafeInteger(seed) && seed >= 0 && seed <= 0xFFFFFFFF ? seed : null
})
const selectedPracticeExamNumbers = computed(() => {
  const selected = parseNumberSelection(route.query.exams, allExamNumbers)
  return selected.length > 0 ? selected : [examNumber.value]
})
const selectedPracticeQuestionNumbers = computed(() => {
  if (route.query.questions === undefined) return undefined
  const selected = parseNumberSelection(route.query.questions, allQuestionNumbers.value)
  if (selected.length > 0) return selected
  return [...allQuestionNumbers.value]
})
const basePracticeSequence = computed<PracticePosition[]>(() => selectPracticePositions(
  matchingCatalog.value?.data ?? [], selectedPracticeExamNumbers.value, selectedPracticeQuestionNumbers.value,
))
const isRandomPractice = computed(() => (
  hasConditionSelection.value
  && practiceOrder.value === 'random'
  && practiceSeed.value !== null
))
const practiceSequence = computed<PracticePosition[]>(() => (
  isRandomPractice.value
    ? shufflePracticeSequence(basePracticeSequence.value, practiceSeed.value!)
    : basePracticeSequence.value
))
const currentPracticeIndex = computed(() => practiceSequence.value.findIndex(position => (
  position.examNumber === examNumber.value && position.questionNumber === questionNumber.value
)))
const nextPracticePosition = computed(() => (
  currentPracticeIndex.value >= 0
    ? practiceSequence.value[currentPracticeIndex.value + 1] ?? null
    : null
))
const practiceNavigationQuery = computed(() => {
  if (hasConditionSelection.value) {
    const query: Record<string, string> = {
      exams: selectedPracticeExamNumbers.value.join(','),
    }
    if (selectedPracticeQuestionNumbers.value !== undefined) query.questions = selectedPracticeQuestionNumbers.value.join(',')
    if (isRandomPractice.value) {
      query.order = 'random'
      query.seed = String(practiceSeed.value)
    }
    return query
  }
  return {}
})
const validRoutePosition = computed(() => Number.isInteger(examNumber.value) && allExamNumbers.includes(examNumber.value)
  && Number.isInteger(questionNumber.value) && questionNumber.value > 0 && questionNumber.value <= 10000)
const validPosition = computed(() => validRoutePosition.value && currentPracticeIndex.value >= 0)
const conditionScope = computed(() => JSON.stringify(['exams', 'questions', 'order', 'seed'].map(key => route.query[key] ?? null)))
const scopeGeneration = ref(0)
const navigationGeneration = ref(0)
const requestInstance = useId()
const latestQuestionRequest = ref(0)
let pageActive = true
const passageContext = shallowRef<PracticePassageContext | null>(null)
const requestFailure = shallowRef<{ context: PracticeRequestTag; error: any } | null>(null)
const sharedPassagePanel = ref<{ showReference: (reference: PassageReference, isCurrent?: () => boolean) => Promise<void> } | null>(null)
const currentRequestContext = (): PracticeRequestTag => ({ instance: requestInstance, scope: scopeGeneration.value, navigation: navigationGeneration.value, request: latestQuestionRequest.value, examNumber: examNumber.value, questionNumber: questionNumber.value })
const requestIsCurrent = (context: PracticeRequestTag | undefined) => pageActive && isCurrentPracticeRequest(context, currentRequestContext())
type TaggedQuestionResponse = ApiResponse<Question> & { requestContext: PracticeRequestTag }
type QuestionEndpoint = '/api/v1/questions/next'
const requestQuery = computed(() => ({ exam_number: validRoutePosition.value ? examNumber.value : 0, question_number: validRoutePosition.value ? questionNumber.value : -1 }))
const questionFetch = (async (request: QuestionEndpoint, options?: NitroFetchOptions<QuestionEndpoint>): Promise<TaggedQuestionResponse> => {
  const context = { ...currentRequestContext(), request: ++latestQuestionRequest.value }
  requestFailure.value = null
  try { return { ...await api<ApiResponse<Question>, QuestionEndpoint>(request, options), requestContext: context } }
  catch (error) { if (requestIsCurrent(context)) requestFailure.value = { context, error }; throw error }
}) as typeof api
const { data: questionResponse, status, refresh } = await useFetch<TaggedQuestionResponse>('/api/v1/questions/next', {
  key: `practice-question:${requestInstance}`, $fetch: questionFetch, query: requestQuery, headers: authHeaders,
  server: false, lazy: true, watch: false, getCachedData: () => undefined,
})
const question = computed(() => {
  if (status.value !== 'success' || !requestIsCurrent(questionResponse.value?.requestContext)) return null
  const loaded = questionResponse.value?.data
  return loaded?.exam_number === examNumber.value && loaded.question_number === questionNumber.value ? loaded : null
})
const questionError = computed(() => requestIsCurrent(requestFailure.value?.context) ? requestFailure.value?.error : null)
const retainedPassageContext = computed(() => canRetainPassageContext(passageContext.value, { examNumber: examNumber.value, questionNumber: questionNumber.value, scope: scopeGeneration.value }) ? passageContext.value : null)
const displayedGroup = computed(() => question.value?.group ?? retainedPassageContext.value?.group)
const displayedQuestionNumber = computed(() => question.value?.group_question_number ?? (displayedGroup.value ? displayedGroup.value.question_numbers.indexOf(questionNumber.value) + 1 : questionNumber.value))
const visibleGroupNumbers = computed(() => (displayedGroup.value?.question_numbers ?? []).filter(number => practiceSequence.value.some(position => position.examNumber === examNumber.value && position.questionNumber === number)))
const questionLoading = computed(() => status.value === 'idle' || status.value === 'pending' || catalogStatus.value === 'idle' || catalogStatus.value === 'pending' || (!requestIsCurrent(questionResponse.value?.requestContext) && !questionError.value))
const referenceLabel = (reference: PassageReference) => {
  const passage = question.value?.shared_passages?.find(item => item.id === reference.passage_id)
  const anchor = passage?.content_blocks.flatMap(block => block.inlines ?? []).find(part => part.type !== 'text' && part.id === reference.anchor_id)
  if (anchor?.type === 'blank') return `【${passage?.label ?? ''}】 空欄${anchor.label}`
  return anchor?.type === 'anchor' ? `【${passage?.label ?? ''}】 (${anchor.label})` : `【${passage?.label ?? ''}】`
}
const showReference = async (reference: PassageReference) => {
  const context = currentRequestContext()
  await sharedPassagePanel.value?.showReference(reference, () => requestIsCurrent(context))
}

const selectedChoiceId = ref<number | null>(null)
const answerResult = ref<AnswerResult | null>(null)
const answerError = ref('')
const submitting = ref(false)
const loadingNext = ref(false)
const completed = ref(false)
const favoriteModalOpen = ref(false)
const favoriteModalCloseButton = ref<HTMLButtonElement | null>(null)
const restoredHistoryId = ref<number | null>(null)

const majorCategoryLabel = computed(() => (
  MAJOR_CATEGORIES.find(item => item.value === question.value?.major_category_code)?.label
  ?? question.value?.major_category_code
  ?? ''
))
const categoryLabel = computed(() => getCategoryLabel(question.value?.category_code ?? ''))
const questionIsFavorite = computed(() => (
  isLoggedIn.value && question.value ? isFavorite(question.value.id) : false
))
const sourceReferences = computed<SourceReference[]>(() => (
  (answerResult.value?.source_text ?? '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separatorIndex = line.lastIndexOf('|')
      if (separatorIndex === -1) return { label: line, url: null }

      const label = line.slice(0, separatorIndex).trim()
      const url = line.slice(separatorIndex + 1).trim()
      if (!/^https:\/\/[^\s]+$/.test(url)) return { label: line, url: null }

      return { label: label || url, url }
    })
))

const questionErrorStatus = computed(() => {
  const error = questionError.value as any
  return error?.statusCode ?? error?.status
})
const questionErrorCode = computed(() => (questionError.value as any)?.data?.error?.code)
const paywallRequired = computed(() => (
  PAYMENTS_ENABLED && examNumber.value > FREE_EXAM_MAX
  && (questionErrorStatus.value === 401 || questionErrorCode.value === 'paid_membership_required')
))
const paywallNeedsLogin = computed(() => questionErrorStatus.value === 401)

const loadErrorMessage = computed(() => {
  if (catalogError.value) return '演習条件を確認できませんでした。もう一度お試しください。'
  if (!validPosition.value) return '試験ナンバーまたは問番号が正しくありません。'
  if (paywallRequired.value) return ''
  if (questionError.value || (questionResponse.value && !question.value)) return '指定された公開問題が見つかりませんでした。'
  return ''
})
const practiceProgress = computed(() => (
  hasConditionSelection.value && currentPracticeIndex.value >= 0
    ? `${isRandomPractice.value ? 'ランダム ' : ''}${currentPracticeIndex.value + 1} / ${practiceSequence.value.length}`
    : ''
))
const completionHeading = computed(() => (
  hasConditionSelection.value
    ? '選択した問題をすべて解き終えました'
    : '公開中の問題はここまでです'
))
const completionMessage = computed(() => {
  if (hasConditionSelection.value) {
    return `${selectedPracticeExamNumbers.value.length}セット、全${practiceSequence.value.length}問の演習が完了しました。`
  }
  return `${currentExam.value?.title ?? '選択したセット'}の公開問題をすべて解き終えました。`
})

let answerRequestVersion = 0
const resetAnswer = () => {
  answerRequestVersion++
  selectedChoiceId.value = null; answerResult.value = null; answerError.value = ''; completed.value = false
  restoredHistoryId.value = null; submitting.value = false; favoriteModalOpen.value = false
}
watch([sessionVersion, () => user.value?.id, () => user.value?.role, () => user.value?.paid_content_access, conditionScope], () => {
  scopeGeneration.value++; passageContext.value = null; requestFailure.value = null; resetAnswer()
}, { flush: 'sync' })
watch([examNumber, questionNumber], () => {
  navigationGeneration.value++; requestFailure.value = null
  if (!canRetainPassageContext(passageContext.value, { examNumber: examNumber.value, questionNumber: questionNumber.value, scope: scopeGeneration.value })) passageContext.value = null
  resetAnswer()
}, { flush: 'sync' })
watch(() => route.query.answer_history_id, resetAnswer, { flush: 'sync' })
watch([() => question.value?.id, () => question.value?.question_version], resetAnswer, { flush: 'sync' })
watch([scopeGeneration, navigationGeneration], () => { if (pageActive) void refresh() }, { flush: 'post' })
watch(question, (loaded) => {
  if (!loaded) return
  passageContext.value = reconcilePassageContext(passageContext.value, loaded, scopeGeneration.value)
  if (typeof loaded.is_favorite === 'boolean') setFavorite(loaded, loaded.is_favorite)
}, { immediate: true })
watch([questionError, catalogError], ([failure, catalogFailure]) => { if (failure || catalogFailure) passageContext.value = null }, { flush: 'sync' })
onBeforeUnmount(() => { pageActive = false; answerRequestVersion++; passageContext.value = null })

const choiceState = (choice: Choice) => {
  if (!answerResult.value) return { selected: selectedChoiceId.value === choice.id }

  return {
    selected: selectedChoiceId.value === choice.id,
    correct: answerResult.value.correct_choice.id === choice.id,
    incorrect: selectedChoiceId.value === choice.id && !answerResult.value.is_correct,
  }
}

const submitAnswer = async () => {
  if (!question.value || selectedChoiceId.value === null || submitting.value) return

  const context = currentRequestContext()
  const request = ++answerRequestVersion
  const currentQuestion = question.value
  submitting.value = true
  answerError.value = ''

  try {
    const response = await api<ApiResponse<AnswerResult>>(
      `/api/v1/questions/${question.value.id}/answer`,
      {
        method: 'POST',
        headers: authHeaders.value,
        body: { selected_choice_id: selectedChoiceId.value, question_version: currentQuestion.question_version },
      },
    )
    if (request !== answerRequestVersion || !requestIsCurrent(context)) return
    answerResult.value = response.data
  }
  catch (error: any) {
    if (request !== answerRequestVersion || !requestIsCurrent(context)) return
    if ((error?.statusCode ?? error?.status) === 409) { answerError.value = '問題が更新されています。再読み込みしてから回答してください。'; return }
    if (error?.statusCode === 401 || error?.status === 401) {
      answerError.value = 'ログインの有効期限が切れました。もう一度ログインしてください。'
      return
    }
    if (error?.data?.error?.code === 'paid_membership_required') {
      answerError.value = 'プレミアム会員資格を確認できません。プレミアム会員ページをご確認ください。'
      return
    }
    answerError.value = '回答を送信できませんでした。通信状況を確認して、もう一度お試しください。'
  }
  finally {
    if (request === answerRequestVersion) submitting.value = false
  }
}

const answerHistoryId = computed(() => {
  const value = Number(route.query.answer_history_id)
  return Number.isInteger(value) && value > 0 ? value : null
})

const restoreAnswerHistory = async () => {
  if (!question.value || !isLoggedIn.value || !answerHistoryId.value) return
  if (restoredHistoryId.value === answerHistoryId.value) return

  const context = currentRequestContext()
  const historyId = answerHistoryId.value
  const answerVersion = answerRequestVersion
  try {
    const response = await api<ApiResponse<AnswerHistoryDetail>>(
      `/api/v1/answer_histories/${answerHistoryId.value}`,
      {
        headers: authHeaders.value,
      },
    )
    if (!requestIsCurrent(context) || answerVersion !== answerRequestVersion || historyId !== answerHistoryId.value || !question.value) return
    const history = response.data
    if (history.is_outdated || (history.question_version !== undefined && history.question_version !== question.value.question_version)) { answerError.value = 'この回答後に問題が更新されています。現在の問題を解き直してください。'; return }
    if (history.question.id !== question.value.id) {
      answerError.value = 'この解答履歴は表示中の問題と一致しません。'
      return
    }

    selectedChoiceId.value = history.selected_choice.id
    answerResult.value = {
      question_id: history.question.id,
      selected_choice_id: history.selected_choice.id,
      is_correct: history.is_correct,
      correct_choice: history.correct_choice,
      explanation_blocks: history.explanation_blocks,
      source_text: history.source_text,
      answer_history_id: history.id,
    }
    restoredHistoryId.value = history.id
  }
  catch (error: any) {
    if (!requestIsCurrent(context) || answerVersion !== answerRequestVersion || historyId !== answerHistoryId.value) return
    if ((error?.statusCode ?? error?.status) === 409) answerError.value = 'この回答後に問題が更新されています。現在の問題を解き直してください。'
    else if (error?.statusCode !== 401 && error?.status !== 401) answerError.value = '解答履歴を読み込めませんでした。'
  }
}

watch(
  [question, answerHistoryId, isLoggedIn],
  restoreAnswerHistory,
  { immediate: true },
)

const goToNextQuestion = async () => {
  if (!question.value || loadingNext.value) return

  if (!nextPracticePosition.value) {
    completed.value = true
    return
  }

  loadingNext.value = true
  answerError.value = ''

  try {
    await navigateTo({
      path: `/practice/${nextPracticePosition.value.examNumber}/${nextPracticePosition.value.questionNumber}`,
      query: practiceNavigationQuery.value,
    })
  }
  catch (error: any) {
    answerError.value = '次の問題へ移動できませんでした。もう一度お試しください。'
  }
  finally {
    loadingNext.value = false
  }
}

const closeFavoriteModal = () => {
  favoriteModalOpen.value = false
}

const handleFavoriteClick = async () => {
  if (!question.value || updatingFavorite.value || (isLoggedIn.value && !user.value)) return

  if (!canUseFavorites.value) {
    favoriteModalOpen.value = true
    await nextTick()
    favoriteModalCloseButton.value?.focus()
    return
  }

  updatingFavorite.value = true
  try {
    await toggleFavorite(question.value)
  }
  catch (error: any) {
    answerError.value = error?.data?.error?.message ?? 'お気に入りを更新できませんでした。'
  }
  finally {
    updatingFavorite.value = false
  }
}

const handleFavoriteModalKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && favoriteModalOpen.value) closeFavoriteModal()
}

onMounted(() => window.addEventListener('keydown', handleFavoriteModalKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', handleFavoriteModalKeydown))
</script>

<template>
  <div class="page-wrap practice-wrap">
    <div v-if="questionLoading && !retainedPassageContext" class="state-panel" role="status" aria-live="polite" aria-busy="true">
      <UIcon class="spin" name="i-lucide-loader-circle" aria-hidden="true" />
      <p>問題を読み込んでいます</p>
    </div>

    <div v-else-if="paywallRequired" class="state-panel paywall-panel">
      <UIcon name="i-lucide-lock-keyhole" />
      <h1>模擬試験{{ examNumber }}はプレミアム会員向けです</h1>
      <p v-if="paywallNeedsLogin">模擬試験{{ FREE_EXAM_MAX + 1 }}以降を利用するには、ログインしてプレミアム会員資格を確認してください。</p>
      <p v-else>{{ PRICE_LABEL }}の買い切りで、模擬試験{{ FREE_EXAM_MAX + 1 }}以降の公開問題を利用できます。</p>
      <div class="state-actions">
        <NuxtLink v-if="paywallNeedsLogin" class="secondary-link" :to="{ path: '/login', query: { redirect: route.fullPath } }">ログイン</NuxtLink>
        <NuxtLink class="primary-link" to="/premium">プレミアム会員について確認する</NuxtLink>
      </div>
    </div>

    <div v-else-if="!questionLoading && (loadErrorMessage || !question)" class="state-panel error-panel">
      <UIcon name="i-lucide-circle-alert" />
      <h1>問題を表示できません</h1>
      <p>{{ loadErrorMessage || '指定された公開問題が見つかりませんでした。' }}</p>
      <div class="state-actions">
        <button class="secondary-link" type="button" @click="() => refresh()">再読み込み</button>
        <NuxtLink class="primary-link" to="/practice/1/1">問1から始める</NuxtLink>
      </div>
    </div>

    <template v-else>
      <header class="practice-head">
        <div>
          <div class="practice-context">
            <span class="exam-label">{{ currentExam?.title }}</span>
            <span v-if="practiceProgress" class="practice-progress">{{ practiceProgress }}</span>
          </div>
          <h1 v-if="displayedGroup"><span class="group-number">大問{{ displayedGroup.group_number }}</span> {{ displayedGroup.title }}</h1>
          <h1 v-else>{{ currentExam?.title }}</h1>
        </div>
        <div class="practice-meta">
          <button
            class="favorite-button"
            :class="{ active: questionIsFavorite }"
            type="button"
            :disabled="!question || updatingFavorite || (isLoggedIn && !user)"
            :aria-pressed="isLoggedIn ? questionIsFavorite : false"
            :aria-label="questionIsFavorite ? 'お気に入りから解除する' : 'お気に入りに登録する'"
            :title="questionIsFavorite ? 'お気に入りから解除' : 'お気に入りに登録'"
            @click="handleFavoriteClick"
          >
            <FavoriteStarIcon :filled="questionIsFavorite" :size="34" />
          </button>
          <p>{{ majorCategoryLabel }} / {{ categoryLabel }}</p>
        </div>
      </header>

      <nav v-if="displayedGroup && visibleGroupNumbers.length > 1" class="group-question-nav" aria-label="大問内の小問"><NuxtLink v-for="number in visibleGroupNumbers" :key="number" :to="{ path: `/practice/${examNumber}/${number}`, query: practiceNavigationQuery }" :aria-current="number === questionNumber ? 'page' : undefined">問{{ displayedGroup.question_numbers.indexOf(number) + 1 }}</NuxtLink></nav>
      <div class="practice-columns" :class="{ 'has-passage': Boolean(retainedPassageContext) }">
      <SharedPassagePanel v-if="retainedPassageContext" :key="`${retainedPassageContext.scope}:${retainedPassageContext.key}`" ref="sharedPassagePanel" :passages="retainedPassageContext.passages" />
      <section class="question-panel" :aria-busy="questionLoading">
        <h2 class="question-number">問{{ displayedQuestionNumber }}</h2>
        <div v-if="questionLoading" class="question-loading" role="status">問題を読み込んでいます。</div>
        <template v-else-if="question">
        <div class="question-text">
          <QuestionContentBlocks :blocks="question.content_blocks" />
        </div>

        <div v-if="question.passage_references?.length" class="passage-references" aria-label="参照する本文"><button v-for="reference in question.passage_references" :key="`${reference.passage_id}-${reference.anchor_id ?? 'all'}`" type="button" @click="showReference(reference)">{{ referenceLabel(reference) }}を確認</button></div>
        <div class="choices" role="radiogroup" aria-label="選択肢">
          <label
            v-for="choice in question.choices"
            :key="choice.id"
            :class="choiceState(choice)"
          >
            <input
              v-model="selectedChoiceId"
              type="radio"
              name="answer"
              :value="choice.id"
              :disabled="Boolean(answerResult) || submitting"
            >
            <span class="choice-label">{{ choice.choice_label }}</span>
            <QuestionContentBlocks class="choice-content" :blocks="choice.content_blocks" />
            <UIcon v-if="answerResult?.correct_choice.id === choice.id" class="choice-mark correct-mark" name="i-lucide-circle-check" />
            <UIcon
              v-else-if="answerResult && selectedChoiceId === choice.id"
              class="choice-mark incorrect-mark"
              name="i-lucide-circle-x"
            />
          </label>
        </div>

        <button
          v-if="!answerResult"
          class="primary-link answer-button"
          type="button"
          :disabled="selectedChoiceId === null || submitting"
          @click="submitAnswer"
        >
          <UIcon v-if="submitting" class="spin" name="i-lucide-loader-circle" />
          {{ submitting ? '採点中です' : '回答する' }}
        </button>

        <p v-if="answerError" class="inline-error" role="alert">{{ answerError }}</p>

        <section
          v-if="answerResult"
          class="answer-result"
          :class="{ correct: answerResult.is_correct }"
          aria-live="polite"
        >
          <div class="result-heading">
            <UIcon :name="answerResult.is_correct ? 'i-lucide-circle-check' : 'i-lucide-circle-x'" />
            <strong>{{ answerResult.is_correct ? '正解です' : '不正解です' }}</strong>
          </div>

          <div class="result-section">
            <h2>正答</h2>
            <div class="correct-answer">
              <span>{{ answerResult.correct_choice.choice_label }}</span>
              <QuestionContentBlocks :blocks="answerResult.correct_choice.content_blocks" />
            </div>
          </div>

          <div class="result-section">
            <h2>解答解説</h2>
            <QuestionContentBlocks :blocks="answerResult.explanation_blocks" />
          </div>

          <div v-if="answerResult.source_text" class="result-section source-section">
            <h2>根拠資料</h2>
            <ul>
              <li v-for="(source, index) in sourceReferences" :key="`${source.url ?? source.label}-${index}`">
                <a
                  v-if="source.url"
                  :href="source.url"
                  target="_blank"
                  rel="noopener noreferrer"
                >{{ source.label }}</a>
                <span v-else>{{ source.label }}</span>
              </li>
            </ul>
          </div>

          <div v-if="completed" class="completed-message">
            <strong>{{ completionHeading }}</strong>
            <p>{{ completionMessage }}</p>
            <NuxtLink class="secondary-link" to="/">トップへ戻る</NuxtLink>
          </div>
          <button v-else class="primary-link next-button" type="button" :disabled="loadingNext" @click="goToNextQuestion">
            {{ loadingNext ? '読み込み中です' : '次の問題' }}
            <UIcon name="i-lucide-arrow-right" />
          </button>
        </section>
        </template>
      </section>
      </div>
    </template>

    <Teleport to="body">
      <Transition name="favorite-modal">
        <div
          v-if="favoriteModalOpen"
          class="favorite-modal-backdrop"
          @click.self="closeFavoriteModal"
        >
          <section
            class="favorite-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="favorite-modal-title"
          >
            <button
              ref="favoriteModalCloseButton"
              class="favorite-modal-close"
              type="button"
              aria-label="閉じる"
              @click="closeFavoriteModal"
            >
              <UIcon name="i-lucide-x" />
            </button>
            <span class="favorite-modal-icon" aria-hidden="true">
              <UIcon name="i-lucide-star" />
            </span>
            <h2 id="favorite-modal-title">お気に入り機能について</h2>
            <p>{{ PAYMENTS_ENABLED ? 'お気に入り登録は、プレミアム会員向けの機能です。' : 'お気に入り登録にはログインが必要です。' }}</p>
            <div class="favorite-modal-actions">
              <NuxtLink v-if="PAYMENTS_ENABLED" class="primary-link" to="/premium" @click="closeFavoriteModal">プレミアム会員について</NuxtLink>
              <NuxtLink v-if="!isLoggedIn" class="secondary-link" :to="{ path: '/login', query: { redirect: route.fullPath } }" @click="closeFavoriteModal">ログインへ</NuxtLink>
            </div>
          </section>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.practice-columns { display: grid; align-items: start; gap: 22px; }
.practice-columns.has-passage { grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr); }
.practice-head > div:first-child { min-width: 0; flex: 1; }
.practice-head h1 { overflow-wrap: anywhere; }
.group-number { white-space: nowrap; }
.question-number { margin: 0 0 18px; font-size: 20px; }
.group-question-nav, .passage-references { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 18px; }
.group-question-nav a, .passage-references button { min-height: 40px; display: inline-flex; align-items: center; padding: 8px 12px; border: 1px solid var(--line); border-radius: 5px; background: var(--surface); color: var(--teal-dark); font-weight: 700; text-decoration: none; cursor: pointer; }
.group-question-nav a[aria-current="page"] { border-color: var(--teal); background: var(--surface-soft); }
.question-loading { min-height: 120px; display: grid; place-items: center; color: var(--muted); }
@media (max-width: 1000px) { .practice-columns.has-passage { grid-template-columns: minmax(0, 1fr); } }

.practice-wrap { max-width: 900px; }
.practice-head { padding: 46px 0 22px; display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; }
.practice-context { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; }
.practice-head .exam-label { color: var(--teal); font-size: 14px; font-weight: 800; }
.practice-progress { padding-left: 12px; border-left: 1px solid #bdcbcd; color: var(--muted); font-size: 13px; font-weight: 800; }
.practice-head h1 { margin: 5px 0 0; font-size: 36px; }
.practice-head p { margin: 0; color: var(--muted); }
.practice-meta { display: flex; align-items: center; gap: 10px; }
.favorite-button {
  width: 42px;
  height: 42px;
  flex: 0 0 42px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: #72838a;
  cursor: pointer;
  transition: color .15s, transform .15s;
}
.favorite-button:hover { color: #c78b00; transform: scale(1.08); }
.favorite-button.active { color: #f0b323; }
.favorite-button:disabled { opacity: .6; cursor: wait; }
.question-panel { padding: 32px; border: 1px solid var(--line); border-radius: 8px; background: #fff; }
.question-text { margin: 0; font-size: 19px; font-weight: 700; line-height: 1.8; }
.choices { display: grid; gap: 10px; margin-top: 28px; }
.choices label { position: relative; min-width: 0; min-height: 62px; display: grid; grid-template-columns: 20px 34px minmax(0, 1fr) 24px; align-items: start; gap: 10px; padding: 16px; border: 1px solid #c8d4d7; border-radius: 6px; cursor: pointer; transition: border-color .15s, background .15s; }
.choices label:hover:not(:has(input:disabled)) { border-color: var(--teal); }
.choices input,
.choice-label { margin-top: 3px; }
.choices label.selected { border-color: var(--teal); background: #eaf6f5; }
.choices label.correct { border-color: var(--teal); background: #eaf6f5; }
.choices label.incorrect { border-color: var(--coral); background: #fff4f1; }
.choice-label { min-width: 0; overflow-wrap: anywhere; color: var(--teal-dark); font-weight: 900; }
.choice-content { min-width: 0; line-height: 1.65; }
.choice-mark { width: 22px; height: 22px; margin-top: 1px; }
.correct-mark { color: var(--teal); }
.incorrect-mark { color: var(--coral); }
.answer-button { width: 180px; margin-top: 24px; }
.answer-button:disabled,
.next-button:disabled { opacity: .45; cursor: not-allowed; }
.inline-error { margin: 16px 0 0; color: #a23b2a; font-weight: 700; }
.answer-result { margin-top: 28px; padding: 24px; border-left: 4px solid var(--coral); background: #fff8f6; }
.answer-result.correct { border-color: var(--teal); background: #f3fbfa; }
.result-heading { display: flex; align-items: center; gap: 10px; color: var(--coral); }
.correct .result-heading { color: var(--teal-dark); }
.result-heading :deep(svg) { width: 26px; height: 26px; }
.result-heading strong { font-size: 22px; }
.result-section { margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--line); }
.result-section h2 { margin: 0 0 12px; color: #30464d; font-size: 16px; }
.correct-answer { display: grid; grid-template-columns: 34px minmax(0, 1fr); gap: 10px; align-items: start; }
.correct-answer > span { color: var(--teal-dark); font-weight: 900; }
.source-section ul { display: grid; gap: 8px; margin: 0; padding-left: 1.2em; color: #506168; line-height: 1.7; }
.source-section a { color: var(--teal-dark); font-weight: 700; text-underline-offset: 3px; }
.next-button { margin-top: 24px; }
.completed-message { margin-top: 24px; padding: 18px; border: 1px solid var(--line); background: #fff; }
.completed-message p { color: var(--muted); }
.state-panel { min-height: 360px; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 12px; text-align: center; }
.state-panel :deep(svg) { width: 34px; height: 34px; color: var(--teal); }
.state-panel p { margin: 0; color: var(--muted); }
.error-panel h1 { margin: 4px 0 0; font-size: 26px; }
.error-panel :deep(svg) { color: var(--coral); }
.paywall-panel h1 { margin: 4px 0 0; font-size: 26px; }
.paywall-panel :deep(svg) { color: #64787e; }
.state-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; margin-top: 12px; }
.spin { animation: spin 1s linear infinite; }
.favorite-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(13, 34, 39, .55);
}
.favorite-modal {
  position: relative;
  width: min(460px, 100%);
  padding: 34px;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 22px 60px rgba(13, 34, 39, .24);
  text-align: center;
}
.favorite-modal-close {
  position: absolute;
  top: 14px;
  right: 14px;
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: #edf2f2;
  color: #41555c;
  cursor: pointer;
}
.favorite-modal-icon {
  width: 58px;
  height: 58px;
  display: grid;
  place-items: center;
  margin: 0 auto 18px;
  border-radius: 50%;
  background: #fff4cf;
  color: #c78b00;
}
.favorite-modal-icon :deep(svg) { width: 29px; height: 29px; fill: currentColor; }
.favorite-modal h2 { margin: 0; font-size: 24px; }
.favorite-modal p { margin: 14px 0 0; color: var(--muted); line-height: 1.8; }
.favorite-modal-actions { display: flex; justify-content: center; gap: 10px; margin-top: 26px; }
.favorite-modal-enter-active,
.favorite-modal-leave-active { transition: opacity .16s ease; }
.favorite-modal-enter-active .favorite-modal,
.favorite-modal-leave-active .favorite-modal { transition: transform .18s ease; }
.favorite-modal-enter-from,
.favorite-modal-leave-to { opacity: 0; }
.favorite-modal-enter-from .favorite-modal,
.favorite-modal-leave-to .favorite-modal { transform: translateY(8px) scale(.98); }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 640px) {
  .practice-head { align-items: flex-start; flex-direction: column; }
  .question-panel { padding: 22px; }
  .question-text { font-size: 18px; }
  .choices label { grid-template-columns: 18px 28px minmax(0, 1fr) 22px; padding: 11px; }
  .answer-result { padding: 20px 16px; }
  .favorite-modal { padding: 30px 20px 24px; }
  .favorite-modal-actions { flex-direction: column; }
  .favorite-modal-actions a { width: 100%; }
}
</style>
