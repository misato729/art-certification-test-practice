export const safeRedirectPath = (value: unknown, fallback = '/') => {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return fallback

  try {
    const decoded = decodeURIComponent(value)
    if (decoded.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(decoded)) return fallback
    const url = new URL(value, 'https://exam.invalid')
    if (url.origin !== 'https://exam.invalid') return fallback
    return `${url.pathname}${url.search}${url.hash}`
  }
  catch {
    return fallback
  }
}
