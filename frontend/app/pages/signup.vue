<script setup lang="ts">
import { signupFormSchema } from '../../shared/schemas/auth.ts'
import { apiFormErrors, focusFormError } from '~/utils/apiFormErrors'
const route = useRoute()
const { signup } = useAuth()
const state = reactive({ name: '', email: '', password: '', password_confirmation: '' })
const authForm = useTemplateRef('authForm')
const submitting = ref(false)
const errorMessage = ref('')
watch(state, () => { errorMessage.value = '' })

const redirectPath = computed(() => safeRedirectPath(route.query.redirect))

const submit = async (event: { data: typeof state }) => {
  Object.assign(state, event.data)
  if (submitting.value) return

  submitting.value = true
  errorMessage.value = ''
  try {
    await signup({
      name: state.name,
      email: state.email,
      password: state.password,
      password_confirmation: state.password_confirmation,
    })
    await navigateTo(redirectPath.value)
  }
  catch (error: any) {
    authForm.value?.setErrors(apiFormErrors(error, { name: 'ユーザー名', email: 'メールアドレス', password: 'パスワード', password_confirmation: '確認用パスワード' }))
    errorMessage.value = error?.data?.error?.message ?? '会員登録できませんでした。入力内容を確認してください。'
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="page-wrap auth-page">
    <header class="page-intro"><h1>会員登録</h1><p>登録後は、解答履歴を保存できます。</p></header>
    <UForm ref="authForm" :schema="signupFormSchema" :state="state" class="content-panel auth-form" novalidate @error="focusFormError" @submit="submit">
      <FormTextField id="name" v-model="state.name" name="name" label="ユーザー名" autocomplete="name" />
      <FormTextField id="email" v-model="state.email" name="email" label="メールアドレス" autocomplete="email" type="email" />
      <FormTextField id="password" v-model="state.password" name="password" label="パスワード" autocomplete="new-password" type="password" />
      <FormTextField id="password-confirmation" v-model="state.password_confirmation" name="password_confirmation" label="確認用パスワード" autocomplete="new-password" type="password" />
      <p v-if="errorMessage" class="form-error" role="alert">{{ errorMessage }}</p>
      <button class="primary-link" type="submit" :disabled="submitting">{{ submitting ? '登録中です' : '登録する' }}</button>
      <p class="auth-note">登録済みの方は <NuxtLink :to="{ path: '/login', query: { redirect: redirectPath } }">ログイン</NuxtLink></p>
    </UForm>
  </div>
</template>
