import { defineApiHandler } from '../../core/api-handler.ts'
import { getAccount } from '../../services/accounts.ts'

export default defineApiHandler((_event, user) => getAccount(user), { authentication: 'required' })
