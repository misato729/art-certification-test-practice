import { defineApiHandler } from '../../../core/api-handler.ts'
import { listIncorrectReviewQuestions } from '../../../services/incorrect-review.ts'

export default defineApiHandler((_event, user) => listIncorrectReviewQuestions(user), { authentication: 'required' })
