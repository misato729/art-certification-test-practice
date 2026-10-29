import { defineApiHandler, routeId } from '../../../../core/api-handler.ts'
import { setResponseStatus } from 'h3'
import { removeFavorite } from '../../../../services/learning.ts'

export default defineApiHandler(async (event, user) => {
  await removeFavorite(routeId(event), user)
  setResponseStatus(event, 204)
  return null
})
