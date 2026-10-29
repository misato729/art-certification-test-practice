import { defineApiHandler } from '../../../../core/api-handler.ts'
import { getQuery } from 'h3'
import { listAdminQuestions } from '../../../../services/learning.ts'

export default defineApiHandler((event, user) => listAdminQuestions(user, getQuery(event)), { authentication: 'admin' })
