<script setup lang="ts">
defineProps<{ admin?: boolean }>()
const { apiStatus } = useApiStatus()
</script>

<template>
  <footer class="site-footer" :class="{ 'admin-footer': admin }">
    <div class="footer-inner">
      <div class="footer-main">
        <NuxtLink class="footer-brand" to="/" :aria-label="`${SITE.name}：ホームへ戻る`">
          <SiteLogo />
        </NuxtLink>
        <div class="footer-copy">
          <strong>{{ SITE.description }}</strong>
        </div>
        <nav class="footer-links" aria-label="サイトポリシー">
          <NuxtLink to="/privacy-policy">プライバシーポリシー</NuxtLink>
          <NuxtLink to="/terms">利用規約</NuxtLink>
          <NuxtLink v-if="PAYMENTS_ENABLED" to="/commercial-disclosure">特定商取引法に基づく表記</NuxtLink>
        </nav>
      </div>
      <div class="api-status" :class="apiStatus" role="status" aria-live="polite">
        <span class="status-dot" aria-hidden="true" />
        <span v-if="apiStatus === 'idle'">API接続は利用時に確認</span>
        <span v-else-if="apiStatus === 'checking'">API接続を確認中</span>
        <span v-else-if="apiStatus === 'failed'">APIに接続できません</span>
        <span v-else>API接続：正常</span>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.site-footer { margin-top: 72px; border-top: 1px solid #d8e1e4; background: #e8eeee; }
.footer-inner {
  width: min(1080px, calc(100% - 40px));
  min-height: 88px;
  margin: 0 auto;
  padding: 18px 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  color: #52636c;
  font-size: 13px;
}
.footer-main, .footer-copy { min-width: 0; display: grid; gap: 6px; }
.footer-main { gap: 10px; }
.footer-brand { justify-self: start; display: inline-flex; text-decoration: none; }
.footer-copy strong { color: #31454c; }
.footer-links { display: flex; flex-wrap: wrap; gap: 8px 18px; }
.footer-links a { color: #40545b; font-weight: 700; text-underline-offset: 3px; }
.footer-links a:hover { color: var(--teal-dark); }
.api-status {
  min-height: 36px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 11px;
  border: 1px solid #c4d0d2;
  border-radius: 6px;
  background: #f7fafa;
  color: #52636c;
  font-weight: 700;
}
.status-dot { width: 9px; height: 9px; flex: 0 0 9px; border-radius: 50%; background: #d29b21; }
.api-status.connected .status-dot { background: #198754; }
.api-status.failed .status-dot { background: #c94d3f; }
.admin-footer { margin-top: 0; border-color: var(--admin-line); background: var(--admin-surface); }
.admin-footer .footer-inner { flex-wrap: wrap; color: var(--admin-muted); }
.admin-footer .footer-copy strong, .admin-footer .footer-links a { color: var(--admin-text); }
.admin-footer .footer-links a:hover { color: var(--admin-accent-hover); }
.admin-footer .api-status { border-color: var(--admin-line-strong); background: var(--admin-bg); color: var(--admin-muted); }
@media (max-width: 640px) {
  .site-footer { margin-top: 52px; }
  .admin-footer { margin-top: 0; }
  .footer-inner {
    width: min(100% - 28px, 1080px);
    align-items: flex-start;
    flex-direction: column;
    justify-content: center;
    gap: 6px;
  }
  .api-status { margin-top: 8px; }
}
</style>
