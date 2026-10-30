import { defineApiHandler, routeId } from '../../../../../core/api-handler.ts'
import { validateExamSet } from '../../../../../services/learning-structure.ts'

export default defineApiHandler((event) => validateExamSet(routeId(event, 'examNumber')).then(data => ({ data })), { authentication: 'admin' })
