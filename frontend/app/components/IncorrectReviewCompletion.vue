<script setup lang="ts">
const { isLoggedIn } = useAuth()
const { totalCount, loading, loaded, error, load, start, starting, sessionKey } = useIncorrectReview()
onMounted(() => { void load({ force: true }) })
watch(sessionKey, () => { void load({ force: true }) })
</script>
<template>
  <section class="review-completion" aria-live="polite">
    <template v-if="!isLoggedIn"><p>復習結果を確認するにはログインしてください。</p><NuxtLink class="primary-link" to="/login">ログインへ</NuxtLink></template>
    <p v-else-if="loading || starting" role="status">復習結果を確認しています。</p>
    <template v-else-if="error"><p role="alert">{{ error }}</p><button class="secondary-link" type="button" @click="load({ force: true })">再読み込み</button></template>
    <template v-else-if="loaded"><h2>{{ totalCount === 0 ? '間違えた問題をすべて正解しました' : `まだ${totalCount}問あります` }}</h2><p>{{ totalCount === 0 ? '今回の解答を反映した結果、復習対象の問題はなくなりました。' : '今回の解答を反映して、復習対象を更新しました。新しい順番でもう一度取り組めます。' }}</p><button v-if="totalCount > 0" class="primary-link" type="button" @click="start">残っている問題をもう一度復習</button><NuxtLink class="secondary-link" to="/history">解答履歴を見る</NuxtLink></template>
  </section>
</template>
<style scoped>.review-completion { margin:24px 0; padding:20px; border:1px solid var(--line); background:var(--surface); overflow-wrap:anywhere; } h2 { font-size:1.25rem; } p { margin:12px 0; line-height:1.7; } .primary-link,.secondary-link { margin:8px 8px 0 0; white-space:normal; } @media(max-width:640px){ .primary-link,.secondary-link { width:100%; } }</style>
