import { defineApiHandler } from '../../core/api-handler.ts'
import { fail } from '../../core/errors.ts'

export default defineApiHandler(() => fail(404, 'not_found', '対象が見つかりません'), { authentication: 'none' })
