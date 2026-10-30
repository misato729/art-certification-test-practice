<script setup lang="ts">
import type { AdminQuestionInput, AdminChoice, ApiResponse } from '~/types/adminQuestion'
import type { input as SchemaInput } from 'zod'
import type { Form, FormError, FormErrorWithId } from '@nuxt/ui'
import { questionFormSchema } from '../../../shared/schemas/content.ts'
import { questionFormFields, focusFormError } from '~/utils/apiFormErrors'
import { choiceLabelsForQuestion, questionCountForExam } from '../../../shared/schemas/exam.ts'
import { reconcileQuestionChoices } from '~/utils/adminQuestionChoices'
import type { ExamSet, QuestionGroup, PassageReference } from '../../../shared/types/learning'
import { normalizeAdminQuestion, prepareAdminQuestion, referenceKey, setPassageReference } from '~/utils/adminQuestionForm'

const props = defineProps<{
  initialValue: AdminQuestionInput
  submitLabel: string
  submitting: boolean
  errorMessage?: string
  fieldErrors?: FormError[]
}>()

const emit = defineEmits<{
  submit: [value: AdminQuestionInput]
}>()

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value))
const form = reactive<AdminQuestionInput>(normalizeAdminQuestion(props.initialValue))
const choiceCache = new Map<string, AdminChoice>()
const previewOpen = ref(false)
const schema = questionFormSchema(EXAM_CONFIG)
// Renderers/editors use the shared broad Block type; UForm validates this same
// live draft with the canonical discriminated input schema on every submission.
const formState = computed(() => form as unknown as SchemaInput<typeof schema>)
const questionForm = useTemplateRef<Form<typeof schema>>('questionForm')
const validationErrors = computed<FormErrorWithId[]>(() => questionForm.value?.getErrors() ?? [])
watch(() => props.fieldErrors, errors => questionForm.value?.setErrors(errors ?? []))
const errorLabel = (name?: string) => questionFormFields[name?.split('.')[0] as keyof typeof questionFormFields] ?? '入力内容'

watch(() => props.initialValue, (value) => {
  choiceCache.clear()
  Object.assign(form, normalizeAdminQuestion(value))
}, { deep: true })

const { $api: api } = useNuxtApp()
const { authHeaders } = useAuth()
const exam = ref<ExamSet | null>(null)
const group = ref<QuestionGroup | null>(null)
const contextError = ref('')
let examRequest = 0
let groupRequest = 0
const loadExam = async () => {
  const request = ++examRequest
  if (import.meta.server) return
  exam.value = null
  try {
    const response = await api<ApiResponse<ExamSet>>(`/api/v1/admin/exams/${form.exam_number}`, { headers: authHeaders.value })
    if (request === examRequest) { exam.value = response.data; contextError.value = '' }
  } catch { if (request === examRequest) contextError.value = '模擬試験の構成を読み込めませんでした。' }
}
const loadGroup = async () => {
  const request = ++groupRequest
  group.value = null
  if (import.meta.server || !form.group_id) return
  try {
    const response = await api<ApiResponse<QuestionGroup>>(`/api/v1/admin/question_groups/${form.group_id}`, { headers: authHeaders.value })
    if (request === groupRequest) { group.value = response.data; contextError.value = '' }
  } catch { if (request === groupRequest) contextError.value = '共通本文を読み込めませんでした。' }
}
watch(() => form.exam_number, loadExam, { immediate: true })
watch(() => form.group_id, loadGroup, { immediate: true })
const selectedGroup = computed({
  get: () => form.group_id ?? 0,
  set: (value: number) => {
    form.group_id = value || null
    form.group_question_number = value ? 1 : null
    form.passage_references = []
  },
})
const groupOptions = computed(() => [{ value: 0, label: '所属なし' }, ...(exam.value?.groups ?? []).map(item => ({ value: item.id, label: `大問${item.group_number} ${item.title}` }))])
const groupQuestionNumber = computed({ get: () => form.group_question_number ?? 1, set: (value: string | number) => { form.group_question_number = Number(value) } })
const referenceOptions = computed(() => (group.value?.passages ?? []).flatMap(passage => [
  { passage_id: passage.id, anchor_id: null, label: `【${passage.label}】 全体` },
  ...passage.content_blocks.flatMap(block => (block.inlines ?? []).filter(part => part.type !== 'text').map(part => ({ passage_id: passage.id, anchor_id: part.id, label: `【${passage.label}】 ${part.type === 'blank' ? '空欄' : '参照箇所'}（${part.label}）` }))),
]))
const hasReference = (reference: PassageReference) => (form.passage_references ?? []).some(item => referenceKey(item) === referenceKey(reference))
const toggleReference = (reference: PassageReference, event: Event) => { form.passage_references = setPassageReference(form.passage_references ?? [], reference, (event.target as HTMLInputElement).checked) }

const categories = computed(() => getCategoriesByMajorCategory(form.major_category_code))
const questionLimit = computed(() => questionCountForExam(EXAM_CONFIG, Number(form.exam_number)) || EXAM_CONFIG.exam.questions_per_exam)
const choiceLabels = computed(() => {
  const examNumber = Number(form.exam_number)
  const questionNumber = Number(form.question_number)
  if (!Number.isInteger(questionNumber) || questionNumber < 1 || questionNumber > questionCountForExam(EXAM_CONFIG, examNumber)) return []
  return choiceLabelsForQuestion(EXAM_CONFIG, examNumber, questionNumber)
})
const isExistingQuestion = computed(() => props.initialValue.choices.some(choice => choice.id !== undefined))
const incompatiblePosition = computed(() => isExistingQuestion.value && choiceLabels.value.length > 0
  && JSON.stringify(choiceLabels.value) !== JSON.stringify(props.initialValue.choices.map(choice => choice.choice_label)))

watch(() => form.exam_number, (current, previous) => {
  if (Number(current) === Number(previous) || (Number(current) === Number(props.initialValue.exam_number) && form.group_id === props.initialValue.group_id)) return
  form.group_id = null; form.group_question_number = null; form.passage_references = []
})

watch([() => form.exam_number, () => form.question_number], () => {
  // Temporarily invalid coordinates must not erase an editor's choices.
  if (!choiceLabels.value.length) return
  for (const choice of form.choices) choiceCache.set(choice.choice_label, clone(choice))
  form.choices = reconcileQuestionChoices(form.choices, choiceLabels.value, {
    preserveExisting: isExistingQuestion.value,
    cachedChoices: [...choiceCache.values()],
  })
})

watch(() => form.major_category_code, () => {
  if (!categories.value.some(item => item.value === form.category_code)) {
    form.category_code = categories.value[0]?.value ?? ''
  }
})

const setCorrectChoice = (index: number) => {
  form.choices.forEach((choice, choiceIndex) => { choice.is_correct = choiceIndex === index })
}

const submit = () => {
  emit('submit', prepareAdminQuestion(form))
}
</script>

<template>
  <UForm ref="questionForm" :schema="schema" :state="formState" :transform="false" class="admin-question-form" novalidate @error="focusFormError" @submit="submit">
    <section class="admin-panel">
      <div class="admin-panel-head"><div><h2>基本情報</h2><p>問題の配置、分類、公開状態を設定します。</p></div></div>
      <div class="admin-panel-body admin-form-grid">
        <FormTextField id="question-exam-number" v-model="form.exam_number" admin name="exam_number" label="試験ナンバー" type="number" min="1" :max="EXAM_CONFIG.exam.set_count" />
        <FormTextField id="question-number" v-model="form.question_number" admin name="question_number" label="問番号" title="模擬試験内の通し番号。URLと選択肢数の設定に使用します。" type="number" min="1" :max="questionLimit" />
        <UFormField name="group_id" label="所属する大問" class="admin-field" :ui="{ error: 'form-field-error' }"><USelect id="question-group" v-model="selectedGroup" :items="groupOptions" value-key="value" label-key="label" class="w-full" /><small><NuxtLink :to="`/admin/exams/${form.exam_number}`">模擬試験・共通本文を管理</NuxtLink></small></UFormField>
        <FormTextField v-if="form.group_id" id="group-question-number" v-model="groupQuestionNumber" admin name="group_question_number" label="大問内の小問番号" type="number" min="1" :max="group?.planned_question_count ?? questionLimit" />
        <UFormField name="major_category_code" label="大分類" class="admin-field" :ui="{ error: 'form-field-error' }"><USelect id="question-major-category" v-model="form.major_category_code" :items="MAJOR_CATEGORIES" value-key="value" label-key="label" class="w-full" /></UFormField>
        <UFormField name="category_code" label="小分類" class="admin-field" :ui="{ error: 'form-field-error' }"><USelect id="question-category" v-model="form.category_code" :items="categories" value-key="value" label-key="label" class="w-full" /></UFormField>
        <UFormField name="publication_status" class="publication-form-field" :ui="{ error: 'form-field-error' }">
        <fieldset class="publication-field">
          <legend>公開状態</legend>
          <label v-for="item in PUBLICATION_STATUSES" :key="item.value" :class="[`status-${item.value}`, { selected: form.publication_status === item.value }]">
            <input v-model="form.publication_status" type="radio" name="publication-status" :value="item.value">
            <span class="publication-dot" />
            <span><strong>{{ item.label }}</strong><small v-if="item.value === 'draft'">編集中</small><small v-else-if="item.value === 'published'">一般公開</small><small v-else>公開停止</small></span>
          </label>
        </fieldset>
        </UFormField>
        <p v-if="contextError" class="context-error" role="alert">{{ contextError }}</p>
      </div>
    </section>

    <section v-if="form.group_id" class="admin-panel">
      <div class="admin-panel-head"><div><h2>共通本文の参照</h2><p>設問で使う本文全体、又は下線・空欄の箇所を指定します。</p></div></div>
      <div class="admin-panel-body"><UFormField name="passage_references" :error-pattern="/^passage_references(?:\.|$)/" :ui="{ error: 'form-field-error' }"><div class="reference-list"><p v-if="!referenceOptions.length">共通本文を大問の画面で保存すると、ここで選べるようになります。</p><label v-for="reference in referenceOptions" :key="referenceKey(reference)"><input type="checkbox" :checked="hasReference(reference)" @change="toggleReference(reference, $event)"><span>{{ reference.label }}</span></label></div></UFormField></div>
    </section>

    <section class="admin-panel">
      <div class="admin-panel-head"><div><h2>問題文</h2><p>表示ブロックは上から順に表示されます。</p></div></div>
      <div class="admin-panel-body"><UFormField name="content_blocks" :error-pattern="/^content_blocks(?:\.|$)/" :ui="{ error: 'form-field-error' }"><AdminContentBlockEditor v-model="form.content_blocks" context="question" /></UFormField></div>
    </section>

    <UFormField name="choices" class="admin-panel" :ui="{ error: 'form-field-error' }">
      <div class="admin-panel-head"><div><h2>選択肢と正答</h2><p>{{ form.choices.length }}件の選択肢を入力し、正答を1件選びます。</p></div></div>
      <div class="admin-panel-body choice-list">
        <p v-if="incompatiblePosition" class="choice-position-error" role="alert">選択肢の構成が異なる問題番号へは移動できません。元の番号に戻すか、同じ選択肢の問題番号を指定してください。</p>
        <article v-for="(choice, index) in form.choices" :key="choice.choice_label" class="choice-editor" :class="{ correct: choice.is_correct }">
          <header>
            <span class="choice-label">{{ choice.choice_label }}</span>
            <label class="correct-control"><input :checked="choice.is_correct" type="radio" name="correct-choice" @change="setCorrectChoice(index)"><span><UIcon name="i-lucide-check" />正答に設定</span></label>
          </header>
          <UFormField :name="`choices.${index}.content_blocks`" :error-pattern="new RegExp(`^choices\\.${index}\\.content_blocks(?:\\.|$)` )" :ui="{ error: 'form-field-error' }"><AdminContentBlockEditor v-model="choice.content_blocks" context="choice" /></UFormField>
        </article>
      </div>
    </UFormField>

    <section class="admin-panel">
      <div class="admin-panel-head"><div><h2>解答解説</h2><p>回答後に表示する解説を入力します。</p></div></div>
      <div class="admin-panel-body"><UFormField name="explanation_blocks" :error-pattern="/^explanation_blocks(?:\.|$)/" :ui="{ error: 'form-field-error' }"><AdminContentBlockEditor v-model="form.explanation_blocks" context="explanation" /></UFormField></div>
    </section>

    <section class="admin-panel">
      <div class="admin-panel-head"><div><h2>根拠資料</h2><p>問題作成時に参考にした出題範囲や資料を入力します。</p></div></div>
      <div class="admin-panel-body"><UFormField name="source_text" label="参考にした出題範囲・根拠資料" class="admin-field" :ui="{ error: 'form-field-error' }"><UTextarea id="source-text" v-model="form.source_text" placeholder="資料名・章節 | https://...（1行につき1出典）" class="w-full" /></UFormField></div>
    </section>

    <div v-if="validationErrors.length" class="admin-inline-error" role="alert">
      <p>入力内容を確認してください</p>
      <ul><li v-for="(error, index) in validationErrors" :key="index">{{ errorLabel(error.name) }}：{{ error.message }}</li></ul>
    </div>
    <p v-if="errorMessage" class="admin-inline-error" role="alert">{{ errorMessage }}</p>

    <section v-if="previewOpen" class="admin-panel preview-panel">
      <div class="admin-panel-head"><div><h2>プレビュー</h2><p>一般の問題演習画面に近い表示で確認できます。</p></div><button class="admin-icon-button" type="button" aria-label="プレビューを閉じる" @click="previewOpen = false"><UIcon name="i-lucide-x" /></button></div>
      <div class="admin-panel-body"><AdminQuestionPreview :question="form" :passages="group?.passages" /></div>
    </section>

    <div class="form-action-bar">
      <div><span class="save-status"><UIcon name="i-lucide-info" />保存するまで公開内容は変更されません。</span></div>
      <div class="form-actions">
        <NuxtLink class="admin-secondary-button" to="/admin/questions">キャンセル</NuxtLink>
        <button class="admin-secondary-button" type="button" @click="previewOpen = !previewOpen"><UIcon name="i-lucide-eye" />{{ previewOpen ? 'プレビューを閉じる' : 'プレビュー' }}</button>
        <button class="admin-primary-button" type="submit" :disabled="submitting"><UIcon :name="submitting ? 'i-lucide-loader-circle' : 'i-lucide-save'" :class="{ spin: submitting }" />{{ submitting ? '保存中です' : submitLabel }}</button>
      </div>
    </div>
  </UForm>
</template>

<style scoped>
.context-error { grid-column: 1 / -1; color: #f1b0a3; }
.reference-list { display: grid; gap: 12px; }
.reference-list label { display: flex; gap: 10px; align-items: baseline; color: var(--admin-text); font-size: 13px; }
.reference-list p { color: var(--admin-muted); font-size: 13px; }
.admin-question-form { display: grid; gap: 18px; padding-bottom: 86px; }
.publication-form-field { grid-column: 1 / -1; }
.publication-field { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 2px 0 0; padding: 0; border: 0; }
.publication-field legend { margin-bottom: 8px; color: #dbe5e7; font-size: 13px; font-weight: 800; }
.publication-field label { min-height: 58px; display: grid; grid-template-columns: 17px 9px 1fr; align-items: center; gap: 9px; padding: 9px 12px; border: 1px solid var(--admin-line); border-radius: 5px; background: #111a1f; cursor: pointer; }
.publication-field label.selected { border-color: var(--admin-line-strong); background: #1a272d; }
.publication-field input { width: 15px; height: 15px; accent-color: var(--admin-accent); }
.publication-dot { width: 8px; height: 8px; border-radius: 50%; background: #819199; }
.status-draft .publication-dot { background: #d4aa4b; }
.status-published .publication-dot { background: #35b979; }
.publication-field strong,
.publication-field small { display: block; }
.publication-field strong { color: var(--admin-text); font-size: 12px; }
.publication-field small { margin-top: 2px; color: var(--admin-muted); font-size: 10px; }
.choice-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.choice-position-error { grid-column: 1 / -1; margin: 0; color: #f1b0a3; }
.choice-editor { min-width: 0; padding: 13px; border: 1px solid var(--admin-line); border-radius: 6px; background: #111a1f; }
.choice-editor.correct { border-color: #287b78; background: #112323; }
.choice-editor > header { min-height: 40px; display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 11px; }
.choice-label { min-width: 34px; max-width: 110px; min-height: 34px; padding: 5px 8px; overflow-wrap: anywhere; display: grid; place-items: center; border-radius: 5px; background: var(--admin-surface-3); color: var(--admin-text); font-weight: 900; }
.correct .choice-label { background: #1d615f; }
.correct-control { cursor: pointer; }
.correct-control input { position: absolute; opacity: 0; pointer-events: none; }
.correct-control span { min-height: 32px; display: inline-flex; align-items: center; gap: 5px; padding: 0 9px; border: 1px solid var(--admin-line); border-radius: 4px; color: var(--admin-muted); font-size: 11px; font-weight: 800; }
.correct-control input:checked + span { border-color: #287b78; background: #153d3c; color: #8dd8d4; }
.preview-panel .admin-icon-button { width: 36px; min-height: 36px; padding: 0; border-color: var(--admin-line); background: transparent; color: var(--admin-muted); }
.form-action-bar { position: sticky; bottom: 14px; z-index: 25; min-height: 66px; display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 11px 14px; border: 1px solid var(--admin-line-strong); border-radius: 7px; background: rgba(17, 26, 31, .96); box-shadow: 0 14px 35px rgba(0, 0, 0, .32); backdrop-filter: blur(10px); }
.save-status { display: inline-flex; align-items: center; gap: 7px; color: var(--admin-muted); font-size: 11px; }
.form-actions { display: flex; gap: 8px; }
.spin { animation: admin-spin 1s linear infinite; }
@media (max-width: 860px) {
  .choice-list { grid-template-columns: 1fr; }
  .form-action-bar { position: static; align-items: stretch; flex-direction: column; }
  .form-actions { display: grid; grid-template-columns: 1fr 1fr; }
  .form-actions .admin-primary-button { grid-column: 1 / -1; }
}
@media (max-width: 640px) {
  .publication-field { grid-template-columns: 1fr; }
  .choice-editor { padding: 10px; }
  .save-status { align-items: flex-start; }
  .form-actions { grid-template-columns: 1fr; }
  .form-actions .admin-primary-button { grid-column: auto; }
}
</style>
