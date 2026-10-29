import { defineNitroPlugin } from 'nitropack/runtime'
import { authBaseURL, authSecret, authTrustedOrigins } from '../core/config.ts'
import { allowedOrigins } from '../core/http.ts'
import { closeDatabase, getDatabase } from '../core/db.ts'
import { closeRateLimitStore } from '../core/rate-limit.ts'

export default defineNitroPlugin(async (nitro) => {
  authSecret()
  authBaseURL()
  authTrustedOrigins()
  allowedOrigins()
  await getDatabase().$queryRaw`SELECT 1`
  nitro.hooks.hook('close', async () => { await closeRateLimitStore(); await closeDatabase() })
})
