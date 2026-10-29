export default defineNuxtRouteMiddleware(async (to) => {
  const { ensureCurrentUser } = useAuth()

  const currentUser = await ensureCurrentUser()
  if (!currentUser) {
    return navigateTo({ path: '/admin/login', query: { redirect: to.fullPath } })
  }

  if (currentUser.role !== 'admin') {
    return navigateTo({
      path: '/admin/login',
      query: { redirect: to.fullPath, reason: 'forbidden' },
    })
  }
})
