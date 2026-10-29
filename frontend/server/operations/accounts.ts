import { createAuth } from '../core/better-auth.ts'
import { query, transaction, isUniqueViolation, type Database } from '../core/db.ts'
import { OperationError } from './content.ts'

const normalizedEmail = (value: string | undefined) => (value || '').trim().toLowerCase()
const emailValid = (value: string) => value.length <= 255 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
export async function createAdmin(input: { email?: string, password?: string, name?: string }, db?: Database) {
  const email = normalizedEmail(input.email)
  const password = input.password || ''
  const name = input.name?.trim() || '管理者'
  if (!emailValid(email) || password.length < 8 || password.length > 128 || Array.from(name).length > 100) throw new OperationError('有効なADMIN_EMAIL、8〜128文字のADMIN_PASSWORD、100文字以内のADMIN_NAMEを指定してください')
  return transaction(async connection => {
    await query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))::text', ['admin:create', email], connection)
    if (await connection.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } })) throw new OperationError('このメールアドレスは登録済みです。既存の権限・パスワードは変更しません')
    try {
      const context = await createAuth(connection).$context
      const passwordHash = await context.password.hash(password)
      const created = await context.internalAdapter.createUser({ email, name, emailVerified: false, role: 'admin' }, { method: 'email-password' })
      if (!created) throw new OperationError('管理者を作成できませんでした')
      await context.internalAdapter.createAccount({ userId: created.id, providerId: 'credential', accountId: created.id, password: passwordHash })
    } catch (error) {
      if (isUniqueViolation(error)) throw new OperationError('このメールアドレスは登録済みです。既存の権限・パスワードは変更しません')
      throw error
    }
    return { status: 'created' as const }
  }, db)
}

async function userByEmail(email: string | undefined, db: Database) {
  const normalized = normalizedEmail(email)
  if (!emailValid(normalized)) throw new OperationError('USER_EMAILを指定してください')
  const found = await db.user.findFirst({ where: { email: { equals: normalized, mode: 'insensitive' } }, select: { id: true } })
  if (found) await query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [found.id], db)
  const user = found ? await db.user.findUnique({ where: { id: found.id }, select: { id: true, role: true } }) : null
  if (!user) throw new OperationError('対象ユーザーが見つかりません')
  return user
}
export async function grantVerification(input: { email?: string, expiresAt?: string, reason?: string, grantedBy?: string }, db?: Database) {
  const reason = input.reason?.trim() || ''
  const grantedBy = input.grantedBy?.trim() || ''
  const rawExpiry = input.expiresAt || ''
  const expiresAt = new Date(rawExpiry)
  if (!reason || Array.from(reason).length > 255 || !grantedBy || Array.from(grantedBy).length > 100 || !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(rawExpiry) || !Number.isFinite(expiresAt.getTime())) throw new OperationError('REASON、GRANTED_BY、タイムゾーン付きISO形式のEXPIRES_ATを指定してください')
  return transaction(async connection => {
    const user = await userByEmail(input.email, connection)
    if (user.role === 'admin') throw new OperationError('管理者には検証用利用資格を追加しません')
    const [clock] = await query<{ now: Date }>('SELECT CURRENT_TIMESTAMP AS now', [], connection)
    const now = new Date(clock!.now)
    if (expiresAt <= now || expiresAt.getTime() > now.getTime() + 7 * 86400000) throw new OperationError('検証用利用資格の期限は付与時刻から7日以内にしてください')
    if (await connection.verificationAccessGrant.findUnique({ where: { user_id: user.id }, select: { id: true } })) throw new OperationError('このユーザーの検証用利用資格は登録済みです')
    await connection.verificationAccessGrant.create({ data: { user_id: user.id, reason, granted_by: grantedBy, expires_at: expiresAt, created_at: now, updated_at: now } })
    return { status: 'granted' as const, expires_at: expiresAt.toISOString() }
  }, db)
}
export async function revokeVerification(email?: string, db?: Database) {
  return transaction(async connection => {
    const user = await userByEmail(email, connection)
    const grant = await connection.verificationAccessGrant.findUnique({ where: { user_id: user.id } })
    if (!grant) throw new OperationError('検証用利用資格が登録されていません')
    if (!grant.revoked_at) {
      const [clock] = await query<{ now: Date }>('SELECT CURRENT_TIMESTAMP AS now', [], connection)
      await connection.verificationAccessGrant.update({ where: { id: grant.id }, data: { revoked_at: clock!.now, updated_at: clock!.now } })
    }
    return { status: 'revoked' as const }
  }, db)
}
