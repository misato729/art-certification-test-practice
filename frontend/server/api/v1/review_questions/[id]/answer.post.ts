import { readBody } from 'h3'
import { defineApiHandler, routeId } from '../../../../core/api-handler.ts'
import { throttle } from '../../../../core/rate-limit.ts'
import { answerQuestion } from '../../../../services/learning.ts'

export default defineApiHandler(async (event, user) => {
  await throttle(event, 'answer')
  const body = await readBody<Record<string, unknown>>(event)
  return answerQuestion(routeId(event), body?.selected_choice_id, user, undefined, body?.question_version)
}, { authentication: 'required' })
