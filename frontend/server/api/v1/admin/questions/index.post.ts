import { defineApiHandler } from '../../../../core/api-handler.ts'
import { readBody, setResponseStatus } from 'h3'
import { writeAdminQuestion } from '../../../../services/learning.ts'

export default defineApiHandler(async (event, user) => {
  const body = await readBody<Record<string, unknown>>(event)
  const result = await writeAdminQuestion(body?.question, user)
  setResponseStatus(event, 201)
  return result
}, { authentication: 'admin' })
