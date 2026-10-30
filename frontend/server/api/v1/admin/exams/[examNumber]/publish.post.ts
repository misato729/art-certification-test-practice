import { defineApiHandler, routeId } from '../../../../../core/api-handler.ts'
import { readBody } from 'h3'
import { publishExamSet } from '../../../../../services/learning-structure.ts'

export default defineApiHandler(async (event) => { const body = await readBody<Record<string, unknown>>(event); return { data: await publishExamSet(routeId(event, 'examNumber'), Number(body?.lock_version)) } }, { authentication: 'admin' })
