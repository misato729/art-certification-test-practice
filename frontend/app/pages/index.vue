<script setup lang="ts">
import { FREE_EXAM_MAX, catalogExamStartNumber, type ExamCatalogEntry } from '~/utils/examCatalog'
import { createPracticeSeed, selectPracticePositions, shufflePracticeSequence, type PracticeOrder } from '~/utils/practiceSequence'

type LauncherMode = 'exam' | 'conditions'
useSeoMeta({ title: SITE.name, description: SITE.description, ogTitle: SITE.name, ogDescription: SITE.description })
const { user } = useAuth()
const { data: publicCatalog, status: catalogStatus, error: catalogError, refresh: refreshCatalog } = await usePublicExamCatalog()
const launcherMode = ref<LauncherMode>('exam')
const hasFullAccess = computed(() => hasFullExamAccess(user.value))
const catalogExams = computed(() => publicCatalog.value?.data ?? [])
const availableExams = computed(() => catalogExams.value.filter(exam => exam.access !== 'paid_membership_required' && (hasFullAccess.value || exam.exam_number <= FREE_EXAM_MAX) && catalogExamStartNumber(exam) !== undefined))
const availableExamNumbers = computed(() => availableExams.value.map(exam => exam.exam_number))
const selectedExamNumbers = ref<number[]>([])
let initializedSelection = false
watch(availableExamNumbers, (numbers, previous = []) => {
  const selectedAll = !initializedSelection || (previous.length > 0 && previous.every(number => selectedExamNumbers.value.includes(number)))
  selectedExamNumbers.value = selectedAll ? [...numbers] : selectedExamNumbers.value.filter(number => numbers.includes(number))
  if (numbers.length) initializedSelection = true
}, { immediate: true })
const totalQuestionCount = computed(() => catalogExams.value.reduce((total, exam) => total + (exam.published_question_count ?? exam.question_numbers.length), 0))
const catalogLoading = computed(() => catalogStatus.value === 'idle' || catalogStatus.value === 'pending')
const allExamsSelected = computed({
  get: () => availableExamNumbers.value.length > 0 && availableExamNumbers.value.every(number => selectedExamNumbers.value.includes(number)),
  set: (selected: boolean) => { selectedExamNumbers.value = selected ? [...availableExamNumbers.value] : [] },
})
const someExamsSelected = computed(() => selectedExamNumbers.value.length > 0 && !allExamsSelected.value)
const sortedSelectedExamNumbers = computed(() => [...selectedExamNumbers.value].sort((a, b) => a - b))
const conditionSequence = computed(() => selectPracticePositions(availableExams.value, sortedSelectedExamNumbers.value))
const selectedQuestionCount = computed(() => conditionSequence.value.length)
const hasConditionSelection = computed(() => !catalogLoading.value && !catalogError.value && selectedQuestionCount.value > 0)
const examIsLocked = (number: number) => catalogExams.value.find(exam => exam.exam_number === number)?.access === 'paid_membership_required' || (number > FREE_EXAM_MAX && !hasFullAccess.value)
const examTarget = (exam: ExamCatalogEntry) => examIsLocked(exam.exam_number) ? '/premium' : `/practice/${exam.exam_number}/${catalogExamStartNumber(exam)}`
const starting = ref(false)
const startConditionalPractice = async (order: PracticeOrder) => {
  if (!hasConditionSelection.value || starting.value) return
  starting.value = true
  try {
    await refreshCatalog()
    await nextTick()
    if (catalogError.value || !conditionSequence.value.length) return
    const query: Record<string, string> = { exams: sortedSelectedExamNumbers.value.join(',') }
    let sequence = conditionSequence.value
    if (order === 'random') {
      const seed = createPracticeSeed()
      sequence = shufflePracticeSequence(sequence, seed)
      query.order = 'random'; query.seed = String(seed)
    }
    const first = sequence[0]
    if (first) await navigateTo({ path: `/practice/${first.examNumber}/${first.questionNumber}`, query })
  } finally { starting.value = false }
}
</script>

<template>
  <div class="home-main">
    <section class="overview-section">
      <div class="overview-copy">
        <h1 class="section-heading">
          <span>{{ SITE.tagline }}</span>
        </h1>
        <p>
          {{ SITE.description }}
        </p>
        <div class="overview-actions">
          <NuxtLink class="secondary-link" to="/exam-overview">試験概要を見る</NuxtLink>
        </div>
      </div>
    </section>

    <section id="practice-launcher" class="practice-launcher" aria-labelledby="practice-launcher-title">
      <div class="launcher-heading">
        <div>
          <h2 id="practice-launcher-title" class="section-heading">
            <span>問題演習を始める</span>
          </h2>
        </div>
        <p>セットを選ぶか、取り組みたい問題番号を指定して始められます。回答するたびに採点と解説を確認できます。</p>
      </div>

      <div class="launcher-tabs" role="tablist" aria-label="問題演習の開始方法">
        <button
          id="exam-mode-tab"
          type="button"
          role="tab"
          :aria-selected="launcherMode === 'exam'"
          aria-controls="exam-mode-panel"
          :class="{ active: launcherMode === 'exam' }"
          @click="launcherMode = 'exam'"
        >
          <UIcon name="i-lucide-files" />
          セットを選ぶ
        </button>
        <button
          id="conditions-mode-tab"
          type="button"
          role="tab"
          :aria-selected="launcherMode === 'conditions'"
          aria-controls="conditions-mode-panel"
          :class="{ active: launcherMode === 'conditions' }"
          @click="launcherMode = 'conditions'"
        >
          <UIcon name="i-lucide-list-filter" />
          条件を指定
        </button>
      </div>

      <div
        v-if="launcherMode === 'exam'"
        id="exam-mode-panel"
        class="launcher-panel"
        role="tabpanel"
        aria-labelledby="exam-mode-tab"
      >
        <div class="exam-grid-heading">
          <p v-if="!catalogLoading && !catalogError"><strong>全{{ catalogExams.length }}セット</strong><span>合計{{ totalQuestionCount }}問</span></p>
          <NuxtLink v-if="!hasFullAccess" class="premium-info-link" to="/premium">
            <UIcon name="i-lucide-lock-keyhole" />
            模擬試験{{ FREE_EXAM_MAX + 1 }}以降はプレミアム会員向けです
          </NuxtLink>
        </div>
        <p v-if="catalogLoading" role="status">公開中の模擬試験を読み込んでいます。</p>
        <p v-else-if="catalogError" role="alert">模擬試験を読み込めませんでした。<button class="secondary-link" type="button" @click="() => refreshCatalog()">再読み込み</button></p>
        <p v-else-if="!catalogExams.length">公開中の模擬試験はありません。</p>
        <div v-else class="exam-grid">
          <NuxtLink
            v-for="exam in catalogExams"
            :key="exam.exam_number"
            class="exam-card"
            :to="examTarget(exam)"
            :aria-label="examIsLocked(exam.exam_number) ? `${exam.title}はプレミアム会員向けです` : `${exam.title}・${exam.question_numbers.length}問を始める`"
          >
            <strong>{{ exam.title }}</strong>
            <span>{{ exam.groups?.length ? `${exam.groups.length}大問・` : '' }}{{ exam.published_question_count ?? exam.question_numbers.length }}問</span>
            <UIcon v-if="examIsLocked(exam.exam_number)" name="i-lucide-lock-keyhole" aria-hidden="true" />
          </NuxtLink>
        </div>
      </div>

      <div
        v-else
        id="conditions-mode-panel"
        class="launcher-panel"
        role="tabpanel"
        aria-labelledby="conditions-mode-tab"
      >
        <form class="condition-form" @submit.prevent="startConditionalPractice('sequential')">
          <div class="condition-fields">
            <fieldset class="condition-fieldset">
              <legend>対象セット</legend>
              <div class="condition-field-heading">
                <p>複数選択できます</p>
                <label class="all-selector">
                  <input
                    v-model="allExamsSelected"
                    type="checkbox"
                    :indeterminate="someExamsSelected"
                  >
                  <span>全選択</span>
                </label>
              </div>
              <div class="number-checkbox-grid exam-number-grid">
                <label
                  v-for="exam in availableExams"
                  :key="exam.exam_number"
                  :class="{ selected: selectedExamNumbers.includes(exam.exam_number) }"
                >
                  <input
                    v-model="selectedExamNumbers"
                    type="checkbox"
                    name="exam-numbers"
                    :value="exam.exam_number"
                  >
                  <span>{{ exam.title }}<small>{{ exam.question_numbers.length }}問</small></span>
                </label>
              </div>
            </fieldset>

            <div class="condition-fieldset condition-scope-note"><h3>出題範囲</h3><p>選んだ模擬試験の公開小問を、大問の順に演習できます。ランダム出題も選べます。</p></div>
          </div>

          <div class="condition-submit">
            <p v-if="catalogLoading" role="status">出題範囲を確認しています。</p>
            <p v-else-if="catalogError" role="alert">出題範囲を確認できませんでした。</p>
            <p v-else-if="hasConditionSelection">
              <span>選択中</span>
              {{ sortedSelectedExamNumbers.length }}セットから
              <strong>全{{ selectedQuestionCount }}問</strong>
            </p>
            <p v-else class="selection-required">
              <span>選択内容を確認してください</span>
              対象の模擬試験を1つ以上選択してください
            </p>
            <div class="condition-actions">
              <button class="primary-link" type="submit" :disabled="!hasConditionSelection || starting">
                <UIcon name="i-lucide-list-ordered" />
                大問の順に始める
              </button>
              <button
                class="secondary-link"
                type="button"
                :disabled="!hasConditionSelection || starting"
                @click="startConditionalPractice('random')"
              >
                <UIcon name="i-lucide-shuffle" />
                ランダムに始める
              </button>
            </div>
          </div>
        </form>
      </div>
    </section>

    <section id="usage-guide" class="home-section policy-section" aria-labelledby="usage-guide-title">
      <div class="section-title">
        <h2 id="usage-guide-title" class="section-heading">
          <span>利用にあたって</span>
        </h2>
      </div>
      <dl class="usage-details">
        <div class="usage-row">
          <dt>{{ PAYMENTS_ENABLED ? (FREE_EXAM_MAX > 0 ? `模擬試験1〜${FREE_EXAM_MAX}は無料` : '会員資格に応じて演習') : 'すべての公開問題を無料で演習' }}</dt>
          <dd>
            <p>{{ PAYMENTS_ENABLED && FREE_EXAM_MAX === 0 ? '問題の演習にはプレミアム会員資格が必要です。' : '無料の公開問題はログインなしで利用できます。' }}解答履歴の保存にはログインが必要です。</p>
          </dd>
        </div>
        <div v-if="PAYMENTS_ENABLED" class="usage-row">
          <dt>{{ PRICE_LABEL }}の買い切り</dt>
          <dd>
            <p>プレミアム会員は模擬試験{{ FREE_EXAM_MAX + 1 }}以降も利用できます。月額料金や自動更新はありません。</p>
            <NuxtLink class="usage-premium-link" to="/premium">
              <span>プレミアム会員について</span>
              <UIcon name="i-lucide-arrow-right" aria-hidden="true" />
            </NuxtLink>
          </dd>
        </div>
        <div class="usage-row">
          <dt>根拠資料も確認</dt>
          <dd>
            <p>各問題の解説と、出題の根拠となる資料を確認できます。</p>
          </dd>
        </div>
      </dl>
    </section>
  </div>
</template>

<style scoped>
.home-main { min-width: 0; background: #f8faf9; }
.practice-launcher {
  scroll-margin-top: calc(var(--site-navigation-height, var(--header-height)) + 20px);
  padding: 52px clamp(28px, 6vw, 86px) 58px;
  border-top: 1px solid #d4dfde;
  background: #eef4f3;
}
.launcher-heading { display: flex; align-items: end; justify-content: space-between; gap: 28px; }
.launcher-heading h2 { margin: 0; font-size: 30px; line-height: 1.3; }
.launcher-heading > p { max-width: 480px; margin: 0; color: var(--muted); line-height: 1.8; }
.section-heading { display: flex; align-items: center; gap: 10px; }
.section-heading::before { content: ''; flex: 0 0 4px; width: 4px; height: 26px; background: var(--teal-dark); }
.section-heading > span { min-width: 0; }
.launcher-tabs {
  width: min(400px, 100%);
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-top: 30px;
  border-bottom: 1px solid #bfcfd0;
}
.launcher-tabs button {
  min-height: 48px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 0;
  border-bottom: 3px solid transparent;
  background: transparent;
  color: #52656c;
  font-weight: 800;
  cursor: pointer;
}
.launcher-tabs button.active { border-color: var(--teal); color: var(--teal-dark); }
.launcher-tabs :deep(svg) { width: 19px; height: 19px; }
.launcher-panel { padding-top: 28px; }
.exam-grid-heading {
  min-height: 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 14px;
}
.exam-grid-heading p { display: flex; align-items: baseline; gap: 10px; margin: 0; }
.exam-grid-heading strong { font-size: 16px; }
.exam-grid-heading span { color: var(--muted); font-size: 13px; font-weight: 700; }
.exam-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.exam-card {
  position: relative;
  min-height: 96px;
  display: grid;
  place-items: center;
  padding: 8px;
  border: 1px solid #bdccce;
  border-radius: 6px;
  background: #fff;
  color: var(--ink);
  text-decoration: none;
  transition: border-color .15s, background .15s, transform .15s;
}
.exam-card:hover { border-color: var(--teal); background: #f9ffff; transform: translateY(-1px); }
.exam-card strong { min-width: 0; color: var(--teal-dark); font-size: 17px; line-height: 1.5; text-align: center; overflow-wrap: anywhere; }
.exam-card > span { color: var(--muted); font-size: 13px; font-weight: 700; }
.exam-card :deep(.iconify) { position: absolute; top: 7px; right: 7px; width: 13px; height: 13px; color: #677b81; }
.premium-info-link { display: inline-flex; align-items: center; gap: 5px; color: var(--teal-dark); font-size: 13px; font-weight: 800; }
.condition-form { border: 1px solid #c7d4d5; border-radius: 8px; background: #fff; }
.condition-fields { display: grid; gap: 28px; padding: 28px; }
.condition-fieldset { min-width: 0; margin: 0; padding: 0; border: 0; }
.condition-fieldset + .condition-fieldset { padding-top: 26px; border-top: 1px solid #dce4e4; }
.condition-fieldset legend { padding: 0; color: #253d45; font-size: 17px; font-weight: 900; }
.condition-field-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin: 7px 0 13px;
}
.condition-field-heading p { margin: 0; color: var(--muted); font-size: 13px; }
.all-selector {
  min-height: 36px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid #bdcbcd;
  border-radius: 5px;
  background: #f8faf9;
  color: #344951;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
}
.all-selector input { width: 17px; height: 17px; margin: 0; accent-color: var(--teal); }
.number-checkbox-grid { display: grid; grid-template-columns: repeat(10, minmax(0, 1fr)); gap: 8px; }
.number-checkbox-grid label {
  min-width: 0;
  min-height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 6px;
  border: 1px solid #c5d1d3;
  border-radius: 5px;
  background: #fff;
  color: #3a5057;
  font-weight: 900;
  cursor: pointer;
  transition: border-color .15s, background .15s;
}
.number-checkbox-grid label:hover { border-color: var(--teal); }
.number-checkbox-grid label.selected { border-color: var(--teal); background: #eaf6f5; color: var(--teal-dark); }
.number-checkbox-grid input { width: 16px; height: 16px; flex: 0 0 16px; margin: 0; accent-color: var(--teal); }
.number-checkbox-grid.exam-number-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.exam-number-grid label span { min-width: 0; overflow-wrap: anywhere; text-align: center; }
.exam-number-grid small { display: block; margin-top: 3px; font-size: 12px; font-weight: 500; }
.question-number-grid label { gap: 4px; padding-inline: 4px; }
.question-number-grid label span { white-space: nowrap; }
.condition-submit {
  min-height: 82px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 16px 26px;
  border-top: 1px solid #d8e1e2;
  background: #f4f7f6;
}
.condition-submit p { margin: 0; color: #40545b; font-weight: 800; }
.condition-submit p span { display: block; margin-bottom: 3px; color: var(--muted); font-size: 11px; }
.condition-submit p strong { margin-left: 8px; color: var(--teal-dark); }
.condition-submit .selection-required { color: #a23b2a; }
.condition-actions { display: flex; flex: 0 0 auto; gap: 10px; }
.condition-actions button { white-space: nowrap; }
.condition-actions button:disabled { opacity: .45; cursor: not-allowed; }
.subject-label { white-space: nowrap; }
.overview-section {
  min-height: 280px;
  padding: 52px clamp(28px, 6vw, 86px);
  display: flex;
  align-items: center;
  background: #fff;
}
.overview-copy { max-width: 680px; }
.overview-copy h1 { margin: 0; font-size: 30px; line-height: 1.3; }
.overview-copy > p { margin: 22px 0 0; color: var(--muted); font-size: 16px; line-height: 1.9; }
.overview-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 30px; }
.home-section { padding: 62px clamp(28px, 6vw, 86px); }
.section-title { display: flex; align-items: baseline; gap: 14px; margin-bottom: 26px; }
.section-title h2 { margin: 0; font-size: 30px; }
.updates-section { background: #f1f5f4; }
.update-list { border-top: 1px solid #cbd7d9; }
.update-list article { min-height: 68px; display: grid; grid-template-columns: 120px 1fr; align-items: center; gap: 18px; border-bottom: 1px solid #cbd7d9; }
.update-list time { color: var(--teal-dark); font-weight: 800; }
.update-list p { margin: 0; color: #4f6169; }
.policy-section {
  scroll-margin-top: calc(var(--site-navigation-height, var(--header-height)) + 20px);
  background: #fff;
}
.usage-details { margin: 0; border-top: 1px solid #dce4e4; }
.usage-row {
  display: grid;
  grid-template-columns: minmax(180px, .3fr) minmax(0, 1fr);
  gap: 32px;
  padding: 26px 0;
  border-bottom: 1px solid #dce4e4;
}
.usage-row dt { color: var(--ink); font-size: 16px; font-weight: 700; line-height: 1.9; }
.usage-row dd { min-width: 0; margin: 0; color: #51636c; font-size: 15px; line-height: 1.9; }
.usage-row p { margin: 0; }
.usage-premium-link {
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  color: var(--teal-dark);
  font-size: 14px;
  font-weight: 700;
  text-decoration: underline;
  text-decoration-color: #a3c3c4;
  text-underline-offset: 4px;
}
.usage-premium-link:hover { text-decoration-color: currentColor; }
.usage-premium-link:focus-visible { outline: 2px solid var(--teal-dark); outline-offset: 4px; }
.usage-premium-link :deep(.iconify) { flex: 0 0 16px; width: 16px; height: 16px; }

@media (max-width: 1100px) {
  .exam-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 1200px) {
  .question-number-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); }
}

@media (max-width: 960px) {
  .number-checkbox-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); }
  .usage-row { grid-template-columns: minmax(0, 1fr); gap: 8px; }
}

@media (max-width: 640px) {
  .practice-launcher { padding: 32px 20px 38px; }
  .launcher-heading { align-items: flex-start; flex-direction: column; gap: 12px; }
  .launcher-heading h2 { font-size: 27px; }
  .launcher-heading > p { font-size: 14px; }
  .launcher-tabs { width: 100%; margin-top: 24px; }
  .exam-grid-heading { align-items: flex-start; flex-direction: column; gap: 8px; }
  .exam-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
  .exam-card { min-height: 92px; }
  .exam-card strong { font-size: 15px; }
  .condition-fields { padding: 20px; }
  .condition-field-heading { align-items: flex-end; }
  .number-checkbox-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 7px; }
  .number-checkbox-grid label { min-height: 46px; flex-direction: column; gap: 3px; padding: 5px 2px; }
  .number-checkbox-grid input { width: 15px; height: 15px; flex-basis: 15px; }
  .condition-submit { align-items: stretch; flex-direction: column; padding: 18px 20px 20px; }
  .condition-actions { width: 100%; flex-direction: column; }
  .condition-actions button { width: 100%; }
  .overview-section { min-height: auto; padding: 36px 20px; }
  .overview-actions { align-items: stretch; flex-direction: column; }
  .home-section { padding: 44px 20px; }
  .update-list article { grid-template-columns: 1fr; gap: 5px; padding: 15px 0; }
  .usage-row { padding: 22px 0; }
}
</style>
