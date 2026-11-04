<script setup lang="ts">
const desktopSidebarOpen = ref(true)
</script>

<template>
  <div class="app-shell" :class="{ 'sidebar-collapsed': !desktopSidebarOpen }">
    <SiteHeader>
      <ExamSidebar
        :desktop-open="desktopSidebarOpen"
        @toggle-desktop="desktopSidebarOpen = !desktopSidebarOpen"
      />
    </SiteHeader>
    <div class="app-content">
      <div class="main-column">
        <main><slot /></main>
        <SiteFooter />
      </div>
    </div>
  </div>
</template>

<style scoped>
.app-shell { --exam-toggle-height: 44px; --exam-sidebar-width: 260px; --site-navigation-height: var(--header-height); min-height: 100vh; display: flex; flex-direction: column; }
.app-shell.sidebar-collapsed { --exam-sidebar-width: 64px; }
.app-content { flex: 1; display: grid; grid-template-columns: var(--exam-sidebar-width) minmax(0, 1fr); align-items: start; transition: grid-template-columns 180ms ease; }
.main-column { grid-column: 2; min-width: 0; min-height: calc(100vh - var(--site-navigation-height)); display: flex; flex-direction: column; }
main { flex: 1; }

@media (max-width: 760px) {
  .app-shell { --site-navigation-height: calc(var(--header-height) + var(--exam-toggle-height)); }
  .app-content { grid-template-columns: 1fr; }
  .main-column { grid-column: 1; min-height: auto; }
}

@media (prefers-reduced-motion: reduce) {
  .app-content { transition: none; }
}
</style>
