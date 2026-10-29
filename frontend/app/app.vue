<script setup lang="ts">
const route = useRoute()
const siteName = SITE.name
const defaultDescription = SITE.description
const noIndexPatterns = [
  /^\/practice(?:\/|$)/,
  /^\/(?:history|favorites|account)(?:\/|$)/,
  /^\/premium\/complete(?:\/|$)/,
  /^\/admin(?:\/|$)/,
  /^\/(?:login|signup)(?:\/|$)/,
]
const robots = computed(() => (
  noIndexPatterns.some(pattern => pattern.test(route.path))
    ? 'noindex, nofollow'
    : 'index, follow'
))

useHead({
  htmlAttrs: { lang: 'ja' },
  title: siteName,
})

useSeoMeta({
  description: defaultDescription,
  ogTitle: siteName,
  ogDescription: defaultDescription,
  ogSiteName: siteName,
  ogLocale: 'ja_JP',
  ogType: 'website',
  twitterCard: 'summary',
  robots,
})
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
