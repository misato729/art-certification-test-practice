import { defineApiHandler, routeId } from '../../../../../core/api-handler.ts'
import { readBody, setResponseStatus } from 'h3'
import { createQuestionGroup } from '../../../../../services/learning-structure.ts'

export default defineApiHandler(async (event) => { const body = await readBody<Record<string, unknown>>(event); const data = await createQuestionGroup(routeId(event, 'examNumber'), body?.group); setResponseStatus(event, 201); return { data } }, { authentication: 'admin' })
