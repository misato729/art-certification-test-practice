<script setup lang="ts">
useSeoMeta({ title: `試験概要｜${SITE.name}`, description: `${SITE.exam_name}の概要をご案内します。` })
</script>

<template>
  <div class="page-wrap overview-page">
    <header class="page-intro"><h1>{{ SITE.exam_name }}</h1><p>{{ SITE.description }}</p></header>
    <section v-for="section in SITE.overview" :key="section.title" class="content-panel">
      <h2>{{ section.title }}</h2><p>{{ section.body }}</p>
    </section>
    <section class="content-panel">
      <h2>本サイトの演習</h2>
      <p>全{{ EXAM_CONFIG.exam.set_count }}セット、各{{ EXAM_CONFIG.exam.questions_per_exam }}問の単一選択式です。各問には{{ CHOICE_LABELS.length }}つの選択肢があり、正答は1つです。</p>
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
.category-group h3 { font-size: 18px; }
.category-group ul { padding-left: 1.4em; }
</style>
