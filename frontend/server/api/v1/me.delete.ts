import { defineApiHandler } from '../../core/api-handler.ts'
import { deleteAccount } from '../../services/accounts.ts'

export default defineApiHandler(deleteAccount, { authentication: 'required' })
