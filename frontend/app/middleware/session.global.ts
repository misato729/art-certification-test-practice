export default defineNuxtRouteMiddleware(async () => {
  const cacheControl = import.meta.server ? useResponseHeader('Cache-Control') : null
  const currentUser = await useAuth().ensureCurrentUser()
  if (currentUser && cacheControl) cacheControl.value = 'private, no-store'
})
