import { defineApiHandler, routeId } from '../../../../core/api-handler.ts'
import { listExamSets } from '../../../../services/learning-structure.ts'

export default defineApiHandler((_event, _user) => listExamSets().then(data => ({ data })), { authentication: 'admin' })
