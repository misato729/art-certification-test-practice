<script setup lang="ts">
const route = useRoute()
const menuOpen = ref(false)
const { isLoggedIn, user, ensureCurrentUser, logout } = useAuth()

const menuItems = computed(() => [
  { label: 'ホーム', to: '/', icon: 'i-lucide-house' },
  { label: '試験概要', to: '/exam-overview', icon: 'i-lucide-book-open' },
  { label: '問題演習', to: '/#practice-launcher', icon: 'i-lucide-pencil-line' },
  ...(PAYMENTS_ENABLED ? [{ label: 'プレミアム会員', to: '/premium', icon: 'i-lucide-badge-check' }] : []),
  ...(isLoggedIn.value
    ? [
        { label: '解答履歴', to: '/history', icon: 'i-lucide-history' },
        ...(!PAYMENTS_ENABLED || user.value?.paid_content_access
          ? [{ label: 'お気に入り一覧', to: '/favorites', icon: 'i-lucide-star' }]
          : []),
        { label: 'アカウント設定', to: '/account', icon: 'i-lucide-user-round' },
        ...(user.value?.role === 'admin'
          ? [{ label: '管理画面', to: '/admin/questions', icon: 'i-lucide-shield-check' }]
          : []),
      ]
    : [{ label: 'ログイン', to: '/login', icon: 'i-lucide-log-in' }]),
])

watch(() => route.fullPath, () => { menuOpen.value = false })

const closeOnEscape = (event: KeyboardEvent) => {
  if (event.key === 'Escape') menuOpen.value = false
}

onMounted(() => window.addEventListener('keydown', closeOnEscape))
onBeforeUnmount(() => window.removeEventListener('keydown', closeOnEscape))

const openMenu = () => {
  menuOpen.value = true
  void ensureCurrentUser()
}

const handleLogout = async () => {
  menuOpen.value = false
  await logout()
  await navigateTo('/')
}
</script>

<template>
  <header class="site-header">
    <div class="header-inner">
      <NuxtLink
        class="brand"
        to="/"
        :aria-label="`${SITE.name}：ホームへ戻る`"
        :title="SITE.description"
      >
        <SiteLogo />
        <small class="brand-tagline">{{ SITE.exam_name }}</small>
      </NuxtLink>

      <div class="header-actions">
        <NuxtLink v-if="!isLoggedIn" class="login-link" to="/login">ログイン</NuxtLink>
        <NuxtLink v-else class="account-link" to="/account" title="アカウント設定">
          <UIcon name="i-lucide-circle-user-round" />
          <span class="account-label">マイページ</span>
        </NuxtLink>
        <button
          class="menu-button"
          type="button"
          :aria-expanded="menuOpen"
          aria-controls="global-menu"
          title="メニューを開く"
          @click="openMenu"
        >
          <UIcon name="i-lucide-menu" />
          <span class="sr-only">メニューを開く</span>
        </button>
      </div>
    </div>
    <slot />
  </header>

  <Transition name="fade">
    <button
      v-if="menuOpen"
      class="menu-backdrop"
      type="button"
      aria-label="メニューを閉じる"
      @click="menuOpen = false"
    />
  </Transition>

  <Transition name="slide">
    <aside v-if="menuOpen" id="global-menu" class="menu-drawer" aria-label="メインメニュー">
      <div class="drawer-head">
        <strong>メニュー</strong>
        <button type="button" title="メニューを閉じる" @click="menuOpen = false">
          <UIcon name="i-lucide-x" />
          <span class="sr-only">メニューを閉じる</span>
        </button>
      </div>
      <nav>
        <NuxtLink
          v-for="item in menuItems"
          :key="item.to"
          :to="item.to"
          :class="{ active: route.path + route.hash === item.to, 'mobile-login-link': item.to === '/login' }"
          @click="menuOpen = false"
        >
          <UIcon :name="item.icon" />
          <span>{{ item.label }}</span>
          <UIcon class="chevron" name="i-lucide-chevron-right" />
        </NuxtLink>
        <button v-if="isLoggedIn" class="logout-button" type="button" @click="handleLogout">
          <UIcon name="i-lucide-log-out" />
          <span>ログアウト</span>
        </button>
      </nav>
    </aside>
  </Transition>
</template>

<style scoped>
.site-header { position: sticky; top: 0; z-index: 30; border-bottom: 1px solid rgba(5, 94, 98, .24); background: var(--aqua); }
.header-inner {
  width: 100%;
  height: var(--header-height);
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}
.brand, .header-actions, .account-link { display: flex; align-items: center; }
.brand { min-width: 0; align-items: center; gap: 12px; color: #082e32; text-decoration: none; }
.brand-tagline { min-width: 0; overflow-wrap: anywhere; margin-bottom: 4px; font-size: 12px; line-height: 1.4; font-weight: 700; }
.brand-tagline span { display: inline-block; white-space: nowrap; }
.header-actions { flex: 0 0 auto; gap: 18px; }
.login-link, .account-link { color: #082e32; font-weight: 800; text-decoration: none; }
.account-link { gap: 7px; }
.account-link :deep(svg) { width: 22px; height: 22px; }
.menu-button, .drawer-head button { display: grid; place-items: center; border: 0; cursor: pointer; }
.menu-button { width: 46px; height: 46px; border-radius: 6px; background: var(--teal-dark); color: #fff; font-size: 26px; }
.menu-backdrop { position: fixed; inset: 0; z-index: 40; border: 0; background: rgba(10, 31, 36, .42); }
.menu-drawer {
  position: fixed;
  inset: 0 0 0 auto;
  z-index: 50;
  width: min(360px, 88vw);
  padding: 22px;
  overflow-y: auto;
  overscroll-behavior-y: contain;
  background: #f8fbfb;
  box-shadow: -18px 0 50px rgba(18, 42, 48, .2);
}
.drawer-head { min-height: 52px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--line); }
.drawer-head strong { font-size: 20px; }
.drawer-head button { width: 40px; height: 40px; border-radius: 6px; background: #e6eeee; color: var(--ink); font-size: 22px; }
nav { display: grid; gap: 4px; padding-top: 18px; }
nav a, .logout-button {
  width: 100%;
  min-height: 52px;
  display: grid;
  grid-template-columns: 24px 1fr 20px;
  align-items: center;
  gap: 12px;
  padding: 0 12px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #263840;
  font-weight: 700;
  text-decoration: none;
  text-align: left;
  cursor: pointer;
}
nav a:hover, nav a.active, .logout-button:hover { background: #dff2f2; color: var(--teal-dark); }
.logout-button { margin-top: 8px; border-top: 1px solid var(--line); border-radius: 0; }
.chevron { color: #7d9097; }
nav a.mobile-login-link { display: none; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.fade-enter-active, .fade-leave-active, .slide-enter-active, .slide-leave-active { transition: opacity 180ms ease, transform 220ms ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.slide-enter-from, .slide-leave-to { transform: translateX(100%); }

@media (max-width: 760px) {
  .header-inner { padding: 0 12px; gap: 10px; }
  .brand { gap: 10px; }
  .brand-tagline { font-size: 11px; }
  .brand-tagline span { display: inline; white-space: normal; }
  .account-label, .login-link { display: none; }
  nav a.mobile-login-link { display: grid; }
  .header-actions { gap: 10px; }
}
@media (max-width: 420px) {
  .brand { gap: 8px; }
}
</style>
