import { defineApiHandler } from '../../core/api-handler.ts'
import { configuration } from '../../core/config.ts'

export default defineApiHandler(() => ({ status: 'ok', app: `${configuration.site.name} API` }), { authentication: 'none' })
