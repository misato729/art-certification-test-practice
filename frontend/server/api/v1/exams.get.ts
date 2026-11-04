import { defineApiHandler } from '../../core/api-handler.ts'
import { listExams } from '../../services/learning.ts'
import { getQuery } from 'h3'

export default defineApiHandler((event, user) => listExams(user, undefined, getQuery(event)))
