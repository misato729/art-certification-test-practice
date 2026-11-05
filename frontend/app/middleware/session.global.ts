export default defineNuxtRouteMiddleware(async () => {
  // Generated HTML is anonymous; the client resolves the session after hydration.
  if (import.meta.prerender) return
  const cacheControl = import.meta.server ? useResponseHeader('Cache-Control') : null
  const currentUser = await useAuth().ensureCurrentUser()
  if (currentUser && cacheControl) cacheControl.value = 'private, no-store'
})
