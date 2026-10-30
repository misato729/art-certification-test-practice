import { defineApiHandler, routeId } from '../../../../core/api-handler.ts'
import { readBody } from 'h3'
import { saveExamSet } from '../../../../services/learning-structure.ts'

export default defineApiHandler(async (event) => { const body = await readBody<Record<string, any>>(event); return { data: await saveExamSet({ ...body?.exam, exam_number: routeId(event, 'examNumber') }) } }, { authentication: 'admin' })
