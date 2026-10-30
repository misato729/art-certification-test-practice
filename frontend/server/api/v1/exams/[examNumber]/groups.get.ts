import { defineApiHandler, routeId } from '../../../../core/api-handler.ts'
import { listPublicGroups } from '../../../../services/learning.ts'

export default defineApiHandler((event, user) => listPublicGroups(routeId(event, 'examNumber'), user))
