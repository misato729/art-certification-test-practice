import { defineApiHandler, routeId } from '../../../core/api-handler.ts'
import { getHistory } from '../../../services/learning.ts'

export default defineApiHandler((event, user) => getHistory(routeId(event), user))
