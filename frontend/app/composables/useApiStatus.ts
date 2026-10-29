type ApiResult = 'idle' | 'connected' | 'failed'

export const useApiStatus = () => {
  const pending = useState<number>('api-pending-count', () => 0)
  const result = useState<ApiResult>('api-connection-result', () => 'idle')
  const apiStatus = computed(() => pending.value > 0 ? 'checking' : result.value)

  const beginRequest = () => { pending.value += 1 }
  const finishRequest = (nextResult?: ApiResult) => {
    pending.value = Math.max(0, pending.value - 1)
    if (nextResult) result.value = nextResult
  }

  return { apiStatus, beginRequest, finishRequest }
}
