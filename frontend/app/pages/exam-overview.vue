<script setup lang="ts">
import { EXAM_CATALOG } from '~/utils/examCatalog'
import { getExamSet, choiceLabelsForQuestion } from '../../shared/schemas/exam.ts'

useSeoMeta({ title: `試験概要｜${SITE.name}`, description: `${SITE.exam_name}の概要をご案内します。` })
const totalQuestionCount = EXAM_CATALOG.reduce((total, exam) => total + exam.question_numbers.length, 0)
const sets = EXAM_CATALOG.map(exam => ({
  ...exam,
  sections: getExamSet(EXAM_CONFIG, exam.exam_number)?.sections,
  choiceCount: choiceLabelsForQuestion(EXAM_CONFIG, exam.exam_number, 1).length,
}))
</script>

<template>
  <div class="page-wrap overview-page">
    <header class="page-intro"><h1>{{ SITE.exam_name }}</h1><p>{{ SITE.description }}</p></header>
    <section v-for="section in SITE.overview" :key="section.title" class="content-panel">
      <h2>{{ section.title }}</h2><p>{{ section.body }}</p>
    </section>
    <section class="content-panel">
      <h2>本サイトの演習</h2>
      <p>全{{ sets.length }}セット、合計{{ totalQuestionCount }}問の単一選択式です。正答は各問1つで、回答するたびに採点・解説・出典を確認できます。</p>
      <div v-for="exam in sets" :key="exam.exam_number" class="exercise-set">
        <h3>{{ exam.title }}：{{ exam.question_numbers.length }}問</h3>
        <ul v-if="exam.sections?.length">
          <li v-for="section in exam.sections" :key="section.first">{{ section.title }}：問{{ section.first }}～{{ section.last }}（{{ section.choice_labels.length }}択）</li>
        </ul>
        <p v-else>全問{{ exam.choiceCount }}択です。</p>
      </div>
      <div v-for="major in MAJOR_CATEGORIES" :key="major.value" class="category-group">
        <h3>{{ major.label }}</h3>
        <ul><li v-for="category in getCategoriesByMajorCategory(major.value)" :key="category.value">{{ category.label }}</li></ul>
      </div>
      <NuxtLink class="primary-link" to="/#practice-launcher">問題演習を始める</NuxtLink>
    </section>
  </div>
</template>

<style scoped>
.overview-page { padding-bottom: 36px; }
.content-panel p { white-space: pre-line; overflow-wrap: anywhere; }
.category-group { margin: 24px 0; }
.exercise-set { margin-top: 20px; }
.exercise-set h3 { margin: 0 0 8px; font-size: 18px; }
.exercise-set ul { padding-left: 1.4em; }
.category-group h3 { font-size: 18px; }
.category-group ul { padding-left: 1.4em; }
</style>
