<script setup lang="ts">
import { PAYMENTS_ENABLED } from '~/utils/examConfig'

definePageMeta({ middleware: PAYMENTS_ENABLED ? ['auth'] : [] })

useSeoMeta({
  title: `決済確認｜${SITE.name}`,
  robots: 'noindex',
})

const { isLoggedIn, user, ensureCurrentUser } = useAuth()
const state = ref<'checking' | 'complete' | 'pending'>('checking')
let stopped = false

const checkMembership = async () => {
  if (!PAYMENTS_ENABLED || !isLoggedIn.value) return

  state.value = 'checking'
  for (let attempt = 0; attempt < 8 && !stopped && isLoggedIn.value; attempt += 1) {
    await ensureCurrentUser(true)
    if (stopped || !isLoggedIn.value) return
    if (user.value?.paid_content_access) {
      state.value = 'complete'
      return
    }
    if (attempt < 7) await new Promise(resolve => window.setTimeout(resolve, 1500))
  }
  if (!stopped) state.value = 'pending'
}

onMounted(() => { void checkMembership() })
onBeforeUnmount(() => { stopped = true })
</script>

<template>
  <div class="page-wrap complete-page">
    <div v-if="!PAYMENTS_ENABLED" class="completion-card">
      <h1>有料機能は無効です</h1><p>すべての公開問題を無料で利用できます。</p>
      <NuxtLink class="primary-link" to="/#practice-launcher">問題演習へ</NuxtLink>
    </div>
    <div v-else-if="!isLoggedIn" class="completion-card">
      <UIcon class="state-icon" name="i-lucide-log-in" />
      <h1>ログインして決済結果を確認してください</h1>
      <p>購入時に使用したアカウントでログインすると、プレミアム会員資格の反映を確認できます。</p>
      <NuxtLink class="primary-link" to="/login?redirect=/premium/complete">ログイン</NuxtLink>
    </div>

    <div v-else-if="state === 'checking'" class="completion-card" aria-live="polite">
      <UIcon class="state-icon spin" name="i-lucide-loader-circle" />
      <h1>決済を確認しています</h1>
      <p>Stripeからの安全な完了通知を確認しています。この画面を閉じずに少しお待ちください。</p>
    </div>

    <div v-else-if="state === 'complete'" class="completion-card success-card" aria-live="polite">
      <UIcon class="state-icon" name="i-lucide-circle-check-big" />
      <h1>プレミアム会員になりました</h1>
      <p>購入が確認できました。公開中の全問題を利用できます。</p>
      <NuxtLink class="primary-link" :to="`/practice/${Math.min(EXAM_CONFIG.payments.free_exam_count + 1, EXAM_CONFIG.exam.set_count)}/1`">問題演習へ進む</NuxtLink>
    </div>

    <div v-else class="completion-card" aria-live="polite">
      <UIcon class="state-icon pending-icon" name="i-lucide-clock-3" />
      <h1>決済の反映を待っています</h1>
      <p>決済完了通知に時間がかかっています。二重に購入せず、少し時間をおいて再確認してください。解決しない場合は、<NuxtLink to="/commercial-disclosure">問い合わせ先</NuxtLink>へご連絡ください。</p>
      <div class="completion-actions">
        <button class="secondary-link" type="button" @click="checkMembership">もう一度確認する</button>
        <NuxtLink class="primary-link" to="/account">アカウントを確認する</NuxtLink>
      </div>
    </div>
  </div>
</template>

<style scoped>
.complete-page { min-height: 60vh; display: grid; place-items: center; padding-top: 64px; }
.completion-card { width: min(680px, 100%); display: grid; justify-items: center; padding: clamp(32px, 7vw, 64px); border: 1px solid var(--line); border-radius: 10px; background: #fff; text-align: center; box-shadow: 0 16px 50px rgba(25, 54, 60, .08); }
.state-icon { width: 52px; height: 52px; color: var(--teal); }
.pending-icon { color: #c78b00; }
.completion-card h1 { margin: 22px 0 0; font-size: clamp(26px, 5vw, 38px); }
.completion-card p { max-width: 530px; margin: 14px 0 26px; color: var(--muted); line-height: 1.85; }
.completion-card p a { color: var(--teal-dark); font-weight: 700; }
.completion-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
