import { defineApiHandler, routeId } from '../../../core/api-handler.ts'
import { getQuestion } from '../../../services/learning.ts'

export default defineApiHandler((event, user) => getQuestion(routeId(event), user))
