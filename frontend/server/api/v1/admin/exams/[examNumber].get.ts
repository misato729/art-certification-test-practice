import { defineApiHandler, routeId } from '../../../../core/api-handler.ts'
import { loadExamSet } from '../../../../services/learning-structure.ts'

export default defineApiHandler((event) => loadExamSet(routeId(event, 'examNumber')).then(data => ({ data })), { authentication: 'admin' })
