<template>
  <div class="app-shell">
    <SiteHeader>
      <ExamSidebar />
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
.app-shell { --exam-toggle-height: 44px; --site-navigation-height: var(--header-height); min-height: 100vh; display: flex; flex-direction: column; }
.app-content { flex: 1; display: grid; grid-template-columns: 260px minmax(0, 1fr); align-items: start; }
.main-column { grid-column: 2; min-width: 0; min-height: calc(100vh - var(--site-navigation-height)); display: flex; flex-direction: column; }
main { flex: 1; }

@media (max-width: 760px) {
  .app-shell { --site-navigation-height: calc(var(--header-height) + var(--exam-toggle-height)); }
  .app-content { grid-template-columns: 1fr; }
  .main-column { grid-column: 1; min-height: auto; }
}
</style>
