import { defineApiHandler, routeId } from '../../../../core/api-handler.ts'
import { getAdminQuestion } from '../../../../services/learning.ts'

export default defineApiHandler((event, user) => getAdminQuestion(routeId(event), user), { authentication: 'admin' })
