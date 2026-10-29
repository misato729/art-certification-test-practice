export default defineNuxtRouteMiddleware(async (to) => {
  const currentUser = await useAuth().ensureCurrentUser()
  if (!currentUser) return navigateTo({ path: '/login', query: { redirect: to.fullPath } })
})
