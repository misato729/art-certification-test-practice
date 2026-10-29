import { randomBytes } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, chmod, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { hashPassword, verifyPassword } from 'better-auth/crypto'
import { query, record, createDatabase, type Database, type RawDatabase } from '../core/db.ts'
import { configuration, environment } from '../core/config.ts'
import { userPayload, type User } from '../core/auth.ts'
import { createAuth } from '../core/better-auth.ts'
import { migrate } from '../database/migrate.ts'
import { saveQuestion } from '../services/learning-writer.ts'
import { nextQuestion, listHistory, listFavorites, listAdminQuestions } from '../services/learning.ts'
import { publicPaymentConfiguration, settingEnabled } from '../services/payment-settings.ts'
import { digest, OperationError } from './content.ts'

const LOCAL_HOSTS = ['db', 'localhost', '127.0.0.1', '::1']
const identifier = (value: string) => '"' + value.replaceAll('"', '""') + '"'
type LocalConnection = { host: string, port: number, user: string, password: string }

/** No supplied database name is ever used: all writes target two fresh disposable DBs. */
export function restoreDrillConnection(env: NodeJS.ProcessEnv = process.env, mode = environment()): LocalConnection {
  if (mode !== 'test' || settingEnabled(env.PAID_MEMBERSHIP_ENABLED) || settingEnabled(env.ERROR_NOTIFICATIONS_ENABLED)) throw new OperationError('復元演習には販売・外部通知を無効にしたローカルのtest環境が必要です')
  let settings: LocalConnection
  try {
    if (env.DATABASE_URL) {
      const url = new URL(env.DATABASE_URL)
      if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error()
      settings = { host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || 5432),
        user: decodeURIComponent(url.username), password: decodeURIComponent(url.password) }
    } else settings = { host: env.PGHOST || env.DB_HOST || 'localhost', port: Number(env.PGPORT || env.DB_PORT || 5432),
      user: env.PGUSER || env.POSTGRES_USER || 'exam_practice', password: env.PGPASSWORD || env.POSTGRES_PASSWORD || '' }
  } catch { throw new OperationError('復元演習のローカルDB接続設定を確認してください') }
  if (!LOCAL_HOSTS.includes(settings.host) || !Number.isSafeInteger(settings.port) || settings.port < 1 || settings.port > 65535 || !settings.user) throw new OperationError('復元演習の接続先はローカルtest用PostgreSQLに限定されます')
  return settings
}

async function runTool(tool: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(tool, args, { env, timeout: 60000, maxBuffer: 1024 * 1024, encoding: 'utf8' }, (error, stdout) => {
      // Tool stderr may contain connection details; never forward it to logs.
      if (error) reject(new OperationError(`${tool}の実行に失敗しました。ツールの配置・権限・バージョンを確認してください`))
      else resolve(stdout)
    })
  })
}
function toolEnvironment(settings: LocalConnection, database: string): NodeJS.ProcessEnv {
  const env = { ...process.env, PGHOST: settings.host, PGPORT: String(settings.port), PGUSER: settings.user,
    PGPASSWORD: settings.password, PGDATABASE: database, PGSSLMODE: 'disable', PGOPTIONS: '-c statement_timeout=60000' }
  for (const key of ['PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE']) delete (env as NodeJS.ProcessEnv)[key]
  return env
}
async function fingerprint(db: RawDatabase) {
  const tables = await query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename", [], db)
  const result: Record<string, { count: number, sha256: string }> = {}
  for (const { tablename } of tables) {
    const rows = await query<{ value: string }>(`SELECT row_to_json(t)::text AS value FROM ${identifier(tablename)} t`, [], db)
    const values = rows.map(row => row.value).sort()
    result[tablename] = { count: values.length, sha256: digest(values) }
  }
  return result
}
/** pg_dump re-parses varchar IN checks as text ANY arrays, adding redundant casts. */
export function normalizeConstraintDefinition(table: string, name: string, definition: string): string {
  if (!['users/users_role_valid', 'memberships/memberships_status_valid', 'payments/payments_status_valid'].includes(`${table}/${name}`)) return definition
  const literals: string[] = []
  const normalized = definition.replace(/'(?:''|[^'])*'/g, literal => {
    literals.push(literal)
    return `$literal${literals.length - 1}$`
  }).replace(/::(?:character varying|text)(?:\[\])?(?![\w\[])/g, '').replace(/[()\s]/g, '')
  return normalized.replace(/\$literal(\d+)\$/g, (_token, index) => literals[Number(index)]!)
}
async function constraints(db: RawDatabase) {
  const rows = await query<{ relname: string, conname: string, definition: string }>(`SELECT c.relname,con.conname,pg_get_constraintdef(con.oid) AS definition
    FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' ORDER BY c.relname,con.conname`, [], db)
  return rows.map(row => ({ ...row, definition: normalizeConstraintDefinition(row.relname, row.conname, row.definition) }))
}
const indexes = (db: RawDatabase) => query("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname", [], db)
async function sequences(db: RawDatabase) {
  const names = await query<{ sequencename: string }>("SELECT sequencename FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename", [], db)
  const result: Record<string, unknown> = {}
  for (const { sequencename } of names) result[sequencename] = await query(`SELECT last_value,is_called FROM ${identifier(sequencename)}`, [], db)
  return result
}
async function createSyntheticRecords(db: Database, password: string) {
  const encoded = await hashPassword(password)
  const now = new Date()
  const user = record(await db.user.create({ data: { name: 'Restore drill', email: 'restore@example.invalid', role: 'user', created_at: now, updated_at: now } })) as User
  const admin = record(await db.user.create({ data: { name: 'Restore admin', email: 'restore-admin@example.invalid', role: 'admin', created_at: now, updated_at: now } })) as User
  for (const account of [user, admin]) await db.authAccount.create({ data: { user_id: BigInt(account.id), account_id: String(account.id), provider_id: 'credential', password: encoded } })
  const category = configuration.categories.minor[0]!
  const question = await saveQuestion({ exam_number: 1, question_number: 1,
    major_category_code: category.major_category_value, category_code: category.value, publication_status: 'published',
    content_blocks: [{ type: 'text', text: 'Synthetic restore question' }], explanation_blocks: [{ type: 'text', text: 'Synthetic explanation' }],
    source_text: 'Synthetic source | https://example.invalid/source',
    choices: configuration.exam.choice_labels.map((choice_label, index) => ({ choice_label, display_order: index + 1,
      is_correct: index === 0, content_blocks: [{ type: 'text', text: `Synthetic choice ${index + 1}` }] })) }, { db, requireCompleteExam: false })
  const correct = question.choices.find(choice => choice.is_correct)!
  await db.answerHistory.create({ data: { user_id: BigInt(user.id), question_id: BigInt(question.id), selected_choice_id: BigInt(correct.id), is_correct: true, created_at: now, updated_at: now } })
  await db.favorite.create({ data: { user_id: BigInt(user.id), question_id: BigInt(question.id), created_at: now, updated_at: now } })
  const payment = await db.payment.create({ data: { user_id: BigInt(user.id), stripe_checkout_session_id: 'cs_test_restore_drill', stripe_payment_intent_id: 'pi_test_restore_drill', stripe_price_id: 'price_test_restore_drill', amount: configuration.payments.amount, currency: 'jpy', status: 'paid', paid_at: now, created_at: now, updated_at: now } })
  await db.membership.create({ data: { user_id: BigInt(user.id), source_payment_id: payment.id, status: 'active', activated_at: now, created_at: now, updated_at: now } })
  await db.verificationAccessGrant.create({ data: { user_id: BigInt(user.id), reason: 'Synthetic restore drill', granted_by: 'local-test', expires_at: new Date(now.getTime() + 86400000), created_at: now, updated_at: now } })
  await db.stripeWebhookEvent.create({ data: { stripe_event_id: 'evt_test_restore_drill', event_type: 'checkout.session.completed', livemode: false, processed_at: now, created_at: now, updated_at: now } })
  // Generate genuine library-signed cookies and persisted sessions before the
  // backup snapshot. The same cookies must authenticate after restoration.
  const auth = createAuth(db)
  const cookies: string[] = []
  for (const account of [user, admin]) {
    const response = await auth.api.signInEmail({ body: { email: account.email, password }, asResponse: true })
    if (!response.ok) throw new OperationError('復元演習用の認証セッションを作成できません')
    const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
    if (!cookie) throw new OperationError('復元演習用の認証Cookieを確認できません')
    cookies.push(cookie)
  }
  return cookies
}

async function applicationChecks(db: Database, password: string, cookies: string[]) {
  const foundUser = await db.user.findUnique({ where: { email: 'restore@example.invalid' } })
  const foundAdmin = await db.user.findUnique({ where: { email: 'restore-admin@example.invalid' } })
  const user = foundUser ? record(foundUser) as User : null
  const admin = foundAdmin ? record(foundAdmin) as User : null
  if (!user || !admin) throw new OperationError('復元後の利用者を確認できません')
  const auth = createAuth(db)
  for (const [index, account] of [user, admin].entries()) {
    const credential = await db.authAccount.findFirst({ where: { user_id: BigInt(account.id), provider_id: 'credential' }, select: { password: true } })
    if (!credential?.password || !await verifyPassword({ password, hash: credential.password })) throw new OperationError('復元後のパスワード照合が一致しません')
    const session = await auth.api.getSession({ headers: new Headers({ cookie: cookies[index]! }), query: { disableRefresh: true, disableCookieCache: true } })
    if (!session || String(session.user.id) !== String(account.id) || session.user.role !== account.role) throw new OperationError('復元後の認証セッション検査に失敗しました')
  }
  const me = await userPayload(user, db)
  const { data: question } = await nextQuestion({ exam_number: 1 }, user, db)
  const { data: history } = await listHistory(user, {}, db)
  const { data: favorites } = await listFavorites(user, {}, db)
  const { data: managed } = await listAdminQuestions(admin, {}, db)
  const checks = {
    password_authentication: true, session_authentication: true, paid_content_access: me.paid_content_access === true,
    public_answer_secrecy: !('explanation_blocks' in question) && !('source_text' in question) &&
      Array.isArray(question.choices) && question.choices.length === configuration.exam.choice_labels.length && question.choices.every(choice => !('is_correct' in choice)),
    history_relationship: history.length === 1 && history[0]!.question.id === question.id,
    favorite_relationship: favorites.length === 1 && favorites[0]!.question.id === question.id,
    admin_read: managed.length === 1 && managed[0]!.id === question.id,
    sales_disabled: publicPaymentConfiguration().enabled === false,
  }
  for (const current of [user, null]) {
    try { await listAdminQuestions(current, {}, db); throw new OperationError('復元後の管理者権限検査に失敗しました') }
    catch (error) { if (![401, 403].includes((error as { status?: number }).status || 0)) throw error }
  }
  const now = new Date()
  const historyRows = await db.answerHistory.findMany({ select: { question_id: true, selected_choice_id: true } })
  const correctChoices = await db.questionChoice.findMany({ where: { is_correct: true }, select: { id: true, question_id: true } })
  const membershipRows = await db.membership.findMany({ where: { status: 'active' }, select: { user_id: true, source_payment_id: true } })
  const paidRows = await db.payment.findMany({ where: { status: 'paid' }, select: { id: true, user_id: true } })
  const accountRows = await db.authAccount.findMany({ where: { provider_id: 'credential', password: { not: null } }, select: { user_id: true } })
  const sessionRows = await db.authSession.findMany({ where: { expires_at: { gt: now } }, select: { user_id: true } })
  const relationships = historyRows.some(history => correctChoices.some(choice => choice.id === history.selected_choice_id && choice.question_id === history.question_id)) &&
    membershipRows.some(membership => paidRows.some(payment => payment.id === membership.source_payment_id && payment.user_id === membership.user_id)) &&
    await db.verificationAccessGrant.count({ where: { revoked_at: null, expires_at: { gt: now } } }) > 0 &&
    await db.stripeWebhookEvent.count({ where: { event_type: 'checkout.session.completed', livemode: false } }) > 0 &&
    accountRows.some(account => sessionRows.some(session => session.user_id === account.user_id))
  if (Object.values(checks).some(value => value !== true) || !relationships) throw new OperationError('復元後のサービス検査又は外部キーの関係が一致しません')
  return { ...checks, admin_authorization: true, record_relationships: true }
}

export async function restoreDrill() {
  const settings = restoreDrillConnection()
  const created: string[] = []
  const clients: pg.Client[] = []
  const applicationDatabases: ReturnType<typeof createDatabase>[] = []
  const admin = new pg.Client({ ...settings, database: 'postgres', ssl: false, connectionTimeoutMillis: 10000, statement_timeout: 60000 })
  let directory: string | undefined
  let connected = false
  const started = performance.now()
  try {
    await admin.connect(); connected = true
    const [version] = await query<{ server_version_num: string }>('SHOW server_version_num', [], admin)
    const major = Math.floor(Number(version!.server_version_num) / 10000)
    for (const tool of ['pg_dump', 'pg_restore']) {
      const output = await runTool(tool, ['--version'], toolEnvironment(settings, 'postgres'))
      if (Number(output.match(/PostgreSQL\) (\d+)/)?.[1]) !== major) throw new OperationError('pg_dump・pg_restoreはtest用DBと同じメジャーバージョンを使用してください')
    }
    const suffix = randomBytes(8).toString('hex')
    const [source, target] = [`exam_practice_drill_source_${suffix}`, `exam_practice_drill_target_${suffix}`]
    for (const name of [source!, target!]) { await admin.query(`CREATE DATABASE ${identifier(name)} TEMPLATE template0`); created.push(name) }
    const connect = async (database: string) => {
      const client = new pg.Client({ ...settings, database, ssl: false, connectionTimeoutMillis: 10000, statement_timeout: 60000, options: '-c timezone=UTC' })
      await client.connect(); clients.push(client); return client
    }
    const databaseUrl = (database: string) => {
      const url = new URL('postgresql://localhost')
      url.hostname = settings.host.includes(':') ? `[${settings.host}]` : settings.host
      url.port = String(settings.port); url.username = settings.user; url.password = settings.password; url.pathname = `/${database}`
      return url.toString()
    }
    // Prisma Migrate owns its transaction; it runs before fixture transactions.
    await migrate({ databaseUrl: databaseUrl(source!) })
    const origin = await connect(source!)
    const sourceDatabase = createDatabase(databaseUrl(source!)); applicationDatabases.push(sourceDatabase)
    const password = randomBytes(24).toString('hex')
    const cookies = await sourceDatabase.$transaction(db => createSyntheticRecords(db, password), { timeout: 60000 })
    const expected = { rows: await fingerprint(origin), constraints: await constraints(origin), indexes: await indexes(origin), sequences: await sequences(origin) }
    directory = await mkdtemp(join(tmpdir(), 'exam-practice-restore-drill-'))
    await chmod(directory, 0o700)
    const file = join(directory, 'synthetic.dump')
    await runTool('pg_dump', ['--format=custom', '--no-owner', '--no-acl', '--file', file], toolEnvironment(settings, source!))
    await chmod(file, 0o600)
    await runTool('pg_restore', ['--dbname', target!, '--exit-on-error', '--single-transaction', '--no-owner', '--no-acl', file], toolEnvironment(settings, target!))
    const restored = await connect(target!)
    const actual = { rows: await fingerprint(restored), constraints: await constraints(restored), indexes: await indexes(restored), sequences: await sequences(restored) }
    if (digest(actual) !== digest(expected)) {
      const mismatches = (Object.keys(expected) as (keyof typeof expected)[]).filter(key => digest(actual[key]) !== digest(expected[key]))
      throw new OperationError(`復元後の比較が一致しません: ${mismatches.map(key => `${key} expected=${digest(expected[key])} actual=${digest(actual[key])}`).join('; ')}`)
    }
    const restoredDatabase = createDatabase(databaseUrl(target!)); applicationDatabases.push(restoredDatabase)
    const checks = await applicationChecks(restoredDatabase, password, cookies)
    if (digest(await fingerprint(restored)) !== digest(expected.rows)) throw new OperationError('サービスの読み取り検査が復元データを変更しました')
    return { status: 'ok', data: 'synthetic_only', tables: Object.keys(expected.rows).length,
      row_counts: Object.fromEntries(Object.entries(expected.rows).map(([key, value]) => [key, value.count])),
      constraints: expected.constraints.length, indexes: expected.indexes.length, sequences: Object.keys(expected.sequences).length,
      application_checks: checks, elapsed_seconds: Math.round((performance.now() - started) / 10) / 100 }
  } catch (error) {
    if (error instanceof OperationError) throw error
    throw new OperationError('復元演習に失敗しました。ローカルtest用DBの接続・DB作成権限・スキーマを確認してください')
  } finally {
    await Promise.allSettled(applicationDatabases.map(db => db.$disconnect()))
    await Promise.allSettled(clients.map(client => client.end()))
    let cleanupFailed = false
    if (connected) for (const name of created) {
      try { await admin.query(`DROP DATABASE ${identifier(name)} WITH (FORCE)`) } catch { cleanupFailed = true }
    }
    if (connected) await admin.end()
    if (directory) await rm(directory, { recursive: true, force: true })
    if (cleanupFailed) throw new OperationError('復元演習で作成した一時DBの削除に失敗しました。ローカルtest用PostgreSQLを確認してください')
  }
}
