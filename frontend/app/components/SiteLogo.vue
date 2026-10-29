<template>
  <span class="site-logo">
    <img :src="SITE.logo_path" alt="" width="44" height="44" />
    <span>{{ SITE.name }}</span>
  </span>
</template>

<style scoped>
.site-logo { display: inline-flex; min-width: 0; align-items: center; gap: 10px; font-size: clamp(18px, 2.4vw, 26px); font-weight: 900; color: var(--ink); }
.site-logo img { flex: 0 0 auto; width: 44px; height: 44px; object-fit: contain; }
.site-logo span { overflow-wrap: anywhere; }
@media (max-width: 420px) { .site-logo { gap: 6px; font-size: 16px; } .site-logo img { width: 32px; height: 32px; } }
</style>
