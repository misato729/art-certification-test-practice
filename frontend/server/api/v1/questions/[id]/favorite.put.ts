import { defineApiHandler, routeId } from '../../../../core/api-handler.ts'
import { setResponseStatus } from 'h3'
import { putFavorite } from '../../../../services/learning.ts'

export default defineApiHandler(async (event, user) => {
  const result = await putFavorite(routeId(event), user)
  setResponseStatus(event, result.created ? 201 : 200)
  return { data: result.data }
})
