import { defineApiHandler, routeId } from '../../../../core/api-handler.ts'
import { loadQuestionGroup } from '../../../../services/learning-structure.ts'

export default defineApiHandler((event) => loadQuestionGroup(routeId(event)).then(data => ({ data })), { authentication: 'admin' })
