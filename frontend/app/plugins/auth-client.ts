import { createAuthClient } from 'better-auth/vue'

export default defineNuxtPlugin({
  name: 'auth-client',
  setup: () => ({
    provide: {
      authClient: createAuthClient({
        baseURL: useRequestURL().origin,
        basePath: '/api/auth',
        fetchOptions: { credentials: 'include' },
      }),
    },
  }),
})
