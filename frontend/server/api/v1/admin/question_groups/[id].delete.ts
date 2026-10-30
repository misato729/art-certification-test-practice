import { defineApiHandler, routeId } from '../../../../core/api-handler.ts'
import { setResponseStatus } from 'h3'
import { deleteQuestionGroup } from '../../../../services/learning-structure.ts'

export default defineApiHandler(async (event) => { await deleteQuestionGroup(routeId(event)); setResponseStatus(event, 204); return null }, { authentication: 'admin' })
