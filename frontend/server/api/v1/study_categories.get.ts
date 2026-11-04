import { defineApiHandler } from '../../core/api-handler.ts'
import { listStudyCategories } from '../../services/study-categories.ts'

export default defineApiHandler(() => listStudyCategories(), { authentication: 'none' })
