import { defineApiHandler } from '../../../core/api-handler.ts'
import { getQuery } from 'h3'
import { nextQuestion } from '../../../services/learning.ts'

export default defineApiHandler((event, user) => nextQuestion(getQuery(event), user))
