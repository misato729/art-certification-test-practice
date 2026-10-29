import { APIError } from 'better-auth/api'
import { fromNodeHeaders } from 'better-auth/node'
import { appendResponseHeader, readBody, setResponseStatus, type H3Event } from 'h3'
import { query, record, transaction } from '../core/db.ts'
import { userPayload, type User } from '../core/auth.ts'
import { getAuth } from '../core/better-auth.ts'
import { fail } from '../core/errors.ts'
import { expirePendingCheckouts } from './payments.ts'

export async function getAccount(user: User | null) {
  if (!user) fail(401, 'unauthorized', 'ログインが必要です')
  return { data: await userPayload(user) }
}

export async function deleteAccount(event: H3Event, user: User | null) {
  if (!user) fail(401, 'unauthorized', 'ログインが必要です')

  const input = await readBody<{ current_password?: unknown }>(event)
  const invalidPassword = (): never => fail(422, 'validation_error', '現在のパスワードを確認してください', { current_password: ['が正しくありません'] })
  if (typeof input?.current_password !== 'string' || input.current_password.length > 128) return invalidPassword()
  const headers = fromNodeHeaders(event.node.req.headers)
  try {
    // Generic Better Auth deletion stays disabled so this business flow cannot be skipped.
    await getAuth().api.verifyPassword({ headers, body: { password: input.current_password } })
  } catch (error) {
    if (error instanceof APIError && error.statusCode >= 400 && error.statusCode < 500) return invalidPassword()
    throw error
  }
  await transaction(async db => {
    await query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [user.id], db)
    const locked = record(await db.user.findUnique({ where: { id: user.id } })) as User | null
    if (!locked) fail(404, 'not_found', '対象が見つかりません')
    await expirePendingCheckouts(locked, db)
    // Foreign keys also remove the library's sessions and credential accounts.
    await db.user.delete({ where: { id: locked.id } })
  })
  const signedOut = await getAuth().api.signOut({ headers, returnHeaders: true })
  for (const cookie of signedOut.headers.getSetCookie()) appendResponseHeader(event, 'Set-Cookie', cookie)
  setResponseStatus(event, 204)
  return ''
}
