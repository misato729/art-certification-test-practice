<script setup lang="ts">
import type { AdminQuestionInput } from '~/types/adminQuestion'

const props = defineProps<{ question: AdminQuestionInput }>()

const majorCategoryLabel = computed(() => getMasterDataLabel(
  MAJOR_CATEGORIES,
  props.question.major_category_code,
))
</script>

<template>
  <section class="question-preview" aria-label="問題のプレビュー">
    <header class="preview-head">
      <div><span>試験 {{ question.exam_number }}</span><h2>問{{ question.question_number }}</h2></div>
      <p>{{ majorCategoryLabel }} / {{ getCategoryLabel(question.category_code) }}</p>
    </header>

    <div class="preview-paper">
      <div class="preview-question"><QuestionContentBlocks :blocks="question.content_blocks" /></div>
      <div class="preview-choices">
        <div v-for="choice in question.choices" :key="choice.choice_label" :class="{ correct: choice.is_correct }">
          <span class="preview-radio" />
          <strong>{{ choice.choice_label }}</strong>
          <QuestionContentBlocks :blocks="choice.content_blocks" />
          <span v-if="choice.is_correct" class="correct-label"><UIcon name="i-lucide-check" />正答</span>
        </div>
      </div>

      <section class="preview-explanation">
        <h3>解答解説</h3>
        <QuestionContentBlocks :blocks="question.explanation_blocks" />
        <div v-if="question.source_text" class="preview-source"><h3>根拠資料</h3><p>{{ question.source_text }}</p></div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.question-preview {
  --ink: #16232b;
  --muted: #60717a;
  --line: #d8e1e4;
  --teal: var(--brand-primary, #2563eb);
  --teal-dark: var(--brand-primary-dark, #1b47a9);
  overflow: hidden;
  border-radius: 7px;
  background: #eef3f3;
  color: var(--ink);
  color-scheme: light;
}
.preview-head { min-height: 92px; display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; padding: 20px 25px; border-bottom: 1px solid #cad6d8; }
.preview-head span { color: var(--teal); font-size: 12px; font-weight: 800; }
.preview-head h2 { margin: 3px 0 0; font-size: 28px; }
.preview-head p { margin: 0; color: var(--muted); font-size: 13px; }
.preview-paper { margin: 20px; padding: 25px; border: 1px solid var(--line); border-radius: 7px; background: #fff; }
.preview-question { font-size: 18px; font-weight: 700; line-height: 1.8; }
.preview-choices { display: grid; gap: 9px; margin-top: 24px; }
.preview-choices > div { position: relative; min-width: 0; display: grid; grid-template-columns: 18px 28px minmax(0, 1fr) auto; align-items: start; gap: 9px; padding: 13px; border: 1px solid #c8d4d7; border-radius: 5px; }
.preview-choices > div.correct { border-color: #68aaa9; background: #eef8f7; }
.preview-radio { width: 15px; height: 15px; margin-top: 4px; border: 1px solid #839399; border-radius: 50%; }
.preview-choices strong { min-width: 0; overflow-wrap: anywhere; margin-top: 1px; color: var(--teal-dark); }
.correct-label { display: inline-flex; align-items: center; gap: 4px; padding: 3px 7px; border-radius: 4px; background: #d5efec; color: #176861; font-size: 10px; font-weight: 900; white-space: nowrap; }
.preview-explanation { margin-top: 24px; padding: 20px; border-left: 4px solid var(--teal); background: #f3fbfa; }
.preview-explanation h3 { margin: 0 0 13px; color: #30464d; font-size: 14px; }
.preview-source { margin-top: 19px; padding-top: 16px; border-top: 1px solid var(--line); }
.preview-source p { margin: 0; color: #506168; font-size: 13px; line-height: 1.7; white-space: pre-wrap; }
@media (max-width: 640px) {
  .preview-head { align-items: flex-start; flex-direction: column; }
  .preview-paper { margin: 10px; padding: 17px; }
  .preview-question { font-size: 16px; }
  .preview-choices > div { grid-template-columns: 16px 24px minmax(0, 1fr); }
  .correct-label { grid-column: 3; justify-self: start; }
}
</style>
