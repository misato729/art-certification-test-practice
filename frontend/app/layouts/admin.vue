<script setup lang="ts">
const route = useRoute()
const navigationOpen = ref(false)
const { user, logout } = useAuth()

const navigationItems = [
  { label: '問題一覧', to: '/admin/questions', icon: 'i-lucide-list-checks' },
  { label: '問題を作成', to: '/admin/questions/new', icon: 'i-lucide-square-plus' },
]

watch(() => route.fullPath, () => { navigationOpen.value = false })

const signOut = async () => {
  await logout()
  await navigateTo('/admin/login')
}
</script>

<template>
  <div class="admin-layout">
    <header class="admin-topbar">
      <button class="admin-menu-trigger" type="button" aria-label="管理メニューを開く" @click="navigationOpen = true">
        <UIcon name="i-lucide-menu" />
      </button>
      <NuxtLink class="admin-brand" to="/admin/questions">
        <span class="admin-brand-mark"><UIcon name="i-lucide-shield-check" /></span>
        <span><strong>{{ SITE.short_name }}</strong><small>管理画面</small></span>
      </NuxtLink>
      <div class="admin-topbar-actions">
        <NuxtLink class="admin-site-link" to="/" target="_blank">
          <UIcon name="i-lucide-external-link" />
          <span>一般画面を表示</span>
        </NuxtLink>
        <span class="admin-user"><UIcon name="i-lucide-circle-user-round" />{{ user?.name ?? '管理者' }}</span>
      </div>
    </header>

    <div class="admin-frame">
      <button v-if="navigationOpen" class="admin-nav-backdrop" type="button" aria-label="管理メニューを閉じる" @click="navigationOpen = false" />
      <aside class="admin-sidebar" :class="{ open: navigationOpen }">
        <div class="admin-sidebar-title">
          <span>管理メニュー</span>
          <button type="button" aria-label="管理メニューを閉じる" @click="navigationOpen = false"><UIcon name="i-lucide-x" /></button>
        </div>
        <nav class="admin-navigation" aria-label="管理メニュー">
          <NuxtLink
            v-for="item in navigationItems"
            :key="item.to"
            :to="item.to"
            :class="{ active: route.path === item.to || (item.to === '/admin/questions' && /^\/admin\/questions\/\d+\/edit$/.test(route.path)) }"
          >
            <UIcon :name="item.icon" />
            <span>{{ item.label }}</span>
          </NuxtLink>
        </nav>
        <div class="admin-sidebar-bottom">
          <button type="button" @click="signOut"><UIcon name="i-lucide-log-out" />ログアウト</button>
        </div>
      </aside>

      <div class="admin-main-column">
        <main class="admin-main"><slot /></main>
        <SiteFooter admin />
      </div>
    </div>
  </div>
</template>

<style scoped>
.admin-main-column { min-width: 0; display: flex; flex-direction: column; }
.admin-main { flex: 1; }
</style>
