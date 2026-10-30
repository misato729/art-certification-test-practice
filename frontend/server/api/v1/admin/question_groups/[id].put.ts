import { defineApiHandler, routeId } from '../../../../core/api-handler.ts'
import { readBody } from 'h3'
import { saveQuestionGroup } from '../../../../services/learning-structure.ts'

export default defineApiHandler(async (event) => { const body = await readBody<Record<string, unknown>>(event); return { data: await saveQuestionGroup(routeId(event), body?.group) } }, { authentication: 'admin' })
