<script setup lang="ts">
withDefaults(defineProps<{
  filled?: boolean
  size?: number
}>(), {
  filled: false,
  size: 34,
})
</script>

<template>
  <svg
    class="favorite-star-icon"
    :class="{ filled }"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path d="M12 2.5l2.94 5.96 6.58.96-4.76 4.64 1.12 6.55L12 17.52l-5.88 3.09 1.12-6.55-4.76-4.64 6.58-.96L12 2.5z" />
  </svg>
</template>

<style scoped>
.favorite-star-icon {
  display: block;
  flex: 0 0 auto;
  fill: transparent;
  stroke: currentColor;
  stroke-linejoin: round;
  stroke-width: 1.8;
}

.favorite-star-icon.filled {
  fill: currentColor;
}
</style>
