import { defineApiHandler, routeId } from '../../../../core/api-handler.ts'
import { readBody } from 'h3'
import { writeAdminQuestion } from '../../../../services/learning.ts'

export default defineApiHandler(async (event, user) => {
  const body = await readBody<Record<string, unknown>>(event)
  return writeAdminQuestion(body?.question, user, routeId(event))
}, { authentication: 'admin' })
