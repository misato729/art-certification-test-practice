import { defineApiHandler } from '../../../core/api-handler.ts'
import { getQuery } from 'h3'
import { listHistory } from '../../../services/learning.ts'

export default defineApiHandler((event, user) => listHistory(user, getQuery(event)), { authentication: 'required' })
