<script setup lang="ts">
import type { PassageInline } from '../../shared/types/learning'

const props = withDefaults(defineProps<{ text?: string; inlines?: PassageInline[]; anchorPrefix?: string; fill?: boolean }>(), { text: '', anchorPrefix: '', fill: false })
const parts = computed<PassageInline[]>(() => {
  if (props.inlines?.length) return props.inlines
  if (!props.fill) return [{ type: 'text', text: props.text }]
  return props.text.split(/(\{\{[^{}]+\}\})/g).filter(Boolean).map((text, index) => {
    const match = text.match(/^\{\{(.+)\}\}$/)
    return match ? { type: 'blank', id: `blank-${index}`, label: match[1]! } : { type: 'text', text }
  })
})
</script>

<template>
  <template v-for="(part, index) in parts" :key="index">
    <template v-if="part.type === 'text'">{{ part.text }}</template>
    <span v-else-if="part.type === 'blank'" :id="anchorPrefix ? `${anchorPrefix}-${part.id}` : undefined" class="inline-blank" :tabindex="anchorPrefix ? -1 : undefined">{{ part.label }}</span>
    <span v-else :id="anchorPrefix ? `${anchorPrefix}-${part.id}` : undefined" class="reference-anchor" tabindex="-1">
      <small>({{ part.label }})</small><u>{{ part.text }}</u>
    </span>
  </template>
</template>

<style scoped>
.inline-blank { min-width: 3.1em; min-height: 1.75em; display: inline-flex; align-items: center; justify-content: center; margin: 0 .18em; padding: 0 .55em; border: 2px solid var(--muted); background: var(--surface); color: var(--muted); font-size: .82em; font-weight: 700; line-height: 1; vertical-align: middle; }
.reference-anchor { scroll-margin-top: calc(var(--site-navigation-height, var(--header-height)) + 28px); outline-offset: 5px; }
.reference-anchor small { margin-right: .25em; font-weight: 800; }
.reference-anchor u { text-underline-offset: .2em; text-decoration-thickness: 1.5px; }
.reference-anchor:focus { background: var(--surface-soft); outline: 2px solid var(--teal); }
</style>
