import { defineApiHandler } from '../../core/api-handler.ts'
import { getQuery } from 'h3'
import { listFavorites } from '../../services/learning.ts'

export default defineApiHandler((event, user) => listFavorites(user, getQuery(event)), { authentication: 'required' })
