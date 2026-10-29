export class ApiError extends Error {
  status: number
  code: string
  details?: unknown
  expectedUnavailability = false
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}
export function fail(status: number, code: string, message: string, details?: unknown): never {
  throw new ApiError(status, code, message, details)
}
