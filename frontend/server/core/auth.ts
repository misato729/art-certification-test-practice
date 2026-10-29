import { fromNodeHeaders } from 'better-auth/node'
import type { H3Event } from 'h3'
import { getDatabase, record, type Database } from './db.ts'
import { paymentsEnabled } from './config.ts'
import { fail } from './errors.ts'
import { createAuth, getAuth } from './better-auth.ts'
import type { AuthUser } from '../../shared/types/auth.ts'

export type User = {
  id: number, name: string, email: string,
  role: 'user' | 'admin', created_at: Date | string, updated_at?: Date | string,
}
const iso = (value: Date | string) => new Date(value).toISOString()

export async function authenticate(event: H3Event, required = false, db?: Database): Promise<User | null> {
  const auth = db ? createAuth(db) : getAuth()
  const session = await auth.api.getSession({ headers: fromNodeHeaders(event.node.req.headers),
    query: { disableCookieCache: true, disableRefresh: true } })
  const id = session ? Number(session.user.id) : NaN
  // Session authentication is delegated to Better Auth. Application permissions
  // always use the current DB row, including a role change after sign-in.
  const user = Number.isSafeInteger(id) && id > 0 ? record(await (db ?? getDatabase()).user.findUnique({ where: { id } })) as User | null : null
  if (!user && required) fail(401, 'unauthorized', 'ログインが必要です')
  if (user && !['user', 'admin'].includes(user.role)) fail(401, 'unauthorized', 'ログインが必要です')
  return user || null
}

export async function requireAdmin(event: H3Event): Promise<User> {
  const user = (await authenticate(event, true))!
  if (user.role !== 'admin') fail(403, 'forbidden', '管理者権限が必要です')
  return user
}

export async function hasPaidAccess(user: User | null | undefined, db?: Database): Promise<boolean> {
  if (!paymentsEnabled) return true
  if (!user) return false
  if (user.role === 'admin') return true
  const connection = db ?? getDatabase()
  const [membership, grant] = await Promise.all([
    connection.membership.findFirst({ where: { user_id: user.id, status: 'active' }, select: { id: true } }),
    connection.verificationAccessGrant.findFirst({ where: { user_id: user.id, revoked_at: null, expires_at: { gt: new Date() } }, select: { id: true } }),
  ])
  return membership !== null || grant !== null
}

export async function userPayload(user: User, db?: Database): Promise<AuthUser> {
  const connection = db ?? getDatabase()
  const [membership, grant, access] = await Promise.all([
    connection.membership.findUnique({ where: { user_id: user.id } }),
    connection.verificationAccessGrant.findFirst({ where: { user_id: user.id, revoked_at: null, expires_at: { gt: new Date() } } }),
    hasPaidAccess(user, connection),
  ])
  const favorites = access ? record(await connection.favorite.findMany({ where: { user_id: user.id, question: { publication_status: 'published' } },
    select: { question: { select: { id: true, exam_number: true, question_number: true } } },
    orderBy: [{ question: { exam_number: 'asc' } }, { question: { question_number: 'asc' } }] })).map(favorite => favorite.question) : []
  const membershipStatus = membership?.status === 'active' || membership?.status === 'revoked' ? membership.status : 'free'
  return {
    id: user.id, name: user.name, email: user.email, role: user.role,
    paid_content_access: access, favorite_questions: favorites,
    membership: { status: membershipStatus, purchased_at: membership?.activated_at ? iso(membership.activated_at) : null, expires_at: null },
    verification_access: grant ? { expires_at: iso(grant.expires_at) } : null,
    created_at: iso(user.created_at),
  }
}
