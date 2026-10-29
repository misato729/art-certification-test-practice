import { defineApiHandler } from '../../core/api-handler.ts'
import { listExams } from '../../services/learning.ts'

export default defineApiHandler((_event, user) => listExams(user))
