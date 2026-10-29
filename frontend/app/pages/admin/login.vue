<script setup lang="ts">
import { loginFormSchema } from '../../../shared/schemas/auth.ts'
import { apiFormErrors, focusFormError } from '~/utils/apiFormErrors'
definePageMeta({ layout: false, middleware: 'admin-guest' })

const route = useRoute()
const { login, logout, user } = useAuth()
const state = reactive({ email: '', password: '' })
const authForm = useTemplateRef('authForm')
const submitting = ref(false)
const errorMessage = ref('')
watch(state, () => { errorMessage.value = '' })

const redirectPath = computed(() => {
  const redirect = safeRedirectPath(route.query.redirect, '/admin/questions')
  return redirect.startsWith('/admin/') ? redirect : '/admin/questions'
})

const nonAdminSession = computed(() => user.value && user.value.role !== 'admin')

const submit = async (event: { data: typeof state }) => {
  Object.assign(state, event.data)
  if (submitting.value) return

  submitting.value = true
  errorMessage.value = ''

  try {
    const loggedInUser = await login({ email: state.email, password: state.password })
    if (loggedInUser.role !== 'admin') {
      await logout()
      errorMessage.value = 'このアカウントには管理者権限がありません。'
      return
    }

    await navigateTo(redirectPath.value)
  }
  catch (error: any) {
    authForm.value?.setErrors(apiFormErrors(error, { name: 'ユーザー名', email: 'メールアドレス', password: 'パスワード', password_confirmation: '確認用パスワード' }))
    errorMessage.value = error?.data?.error?.message ?? 'ログインできませんでした。もう一度お試しください。'
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="admin-layout admin-login-shell">
    <header class="admin-login-header">
      <NuxtLink class="admin-brand" to="/admin/login" aria-label="管理画面ログイン">
        <span class="admin-brand-mark"><UIcon name="i-lucide-shield-check" /></span>
        <span><strong>{{ SITE.short_name }}</strong><small>管理画面</small></span>
      </NuxtLink>
      <NuxtLink class="admin-site-link" to="/"><UIcon name="i-lucide-arrow-left" />一般画面に戻る</NuxtLink>
    </header>

    <main class="admin-login-main">
      <section class="admin-login-card">
        <span class="admin-login-icon" aria-hidden="true"><UIcon name="i-lucide-lock-keyhole" /></span>
        <p class="admin-page-eyebrow">ADMINISTRATOR</p>
        <h1>管理画面ログイン</h1>
        <p class="admin-login-lead">管理者アカウントでログインしてください。</p>

        <p v-if="nonAdminSession || route.query.reason === 'forbidden'" class="admin-session-note">
          <UIcon name="i-lucide-info" />
          <span>現在のアカウントは管理画面を利用できません。管理者アカウントでログインし直してください。</span>
        </p>

        <UForm ref="authForm" :schema="loginFormSchema" :state="state" class="admin-login-form" novalidate @error="focusFormError" @submit="submit">
          <FormTextField id="admin-email" v-model="state.email" admin name="email" label="メールアドレス" autocomplete="email" type="email" icon="i-lucide-mail" placeholder="admin@example.com" />
          <FormTextField id="admin-password" v-model="state.password" admin name="password" label="パスワード" autocomplete="current-password" type="password" icon="i-lucide-key-round" />
          <p v-if="errorMessage" class="admin-inline-error" role="alert">{{ errorMessage }}</p>
          <button class="admin-primary-button admin-login-button" type="submit" :disabled="submitting">
            <UIcon :name="submitting ? 'i-lucide-loader-circle' : 'i-lucide-log-in'" :class="{ spin: submitting }" />
            {{ submitting ? 'ログイン中です' : '管理画面にログイン' }}
          </button>
        </UForm>

        <p class="admin-login-help">一般画面で管理者としてログイン済みの場合、再ログインは不要です。</p>
      </section>
    </main>
    <SiteFooter admin />
  </div>
</template>

<style scoped>
.admin-login-shell { display: flex; flex-direction: column; }
.admin-login-header { min-height: 66px; display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 0 28px; border-bottom: 1px solid var(--admin-line); background: #111a1f; }
.admin-login-main { flex: 1; display: grid; place-items: center; padding: 48px 20px 70px; }
.admin-login-card { width: min(460px, 100%); padding: 36px; border: 1px solid var(--admin-line); border-radius: 8px; background: var(--admin-surface); box-shadow: 0 24px 70px rgba(0, 0, 0, .24); }
.admin-login-icon { width: 48px; height: 48px; display: grid; place-items: center; margin-bottom: 22px; border-radius: 6px; background: #173439; color: var(--admin-accent-hover); font-size: 24px; }
.admin-login-card h1 { margin: 0; font-size: 27px; line-height: 1.35; }
.admin-login-lead { margin: 11px 0 0; color: var(--admin-muted); font-size: 13px; line-height: 1.75; }
.admin-session-note { display: flex; align-items: flex-start; gap: 8px; margin: 20px 0 0; padding: 12px 13px; border: 1px solid #3f565f; border-radius: 5px; background: #1b292f; color: #b9c8cd; font-size: 12px; line-height: 1.7; }
.admin-session-note :deep(svg) { flex: 0 0 auto; margin-top: 2px; color: var(--admin-accent-hover); }
.admin-login-form { display: grid; gap: 17px; margin-top: 26px; }
.admin-login-input { position: relative; }
.admin-login-input :deep(svg) { position: absolute; top: 50%; left: 12px; width: 17px; height: 17px; color: #71858e; transform: translateY(-50%); }
.admin-login-input input { padding-left: 39px; }
.admin-login-button { width: 100%; margin-top: 3px; }
.admin-login-help { margin: 24px 0 0; padding-top: 20px; border-top: 1px solid var(--admin-line); color: #80939b; font-size: 11px; line-height: 1.7; text-align: center; }
.spin { animation: admin-spin 1s linear infinite; }
@media (max-width: 560px) {
  .admin-login-header { min-height: 60px; padding: 0 14px; }
  .admin-login-header .admin-site-link { font-size: 0; }
  .admin-login-header .admin-site-link :deep(svg) { width: 21px; height: 21px; }
  .admin-login-main { align-items: start; padding: 28px 14px 50px; }
  .admin-login-card { padding: 26px 20px; }
  .admin-login-card h1 { font-size: 24px; }
}
</style>
