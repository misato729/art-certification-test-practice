import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createDatabase, getDatabase, query, type Database } from '../core/db.ts'
import { OperationError } from '../operations/content.ts'

export const BASELINE_MIGRATION = '00000000000000_baseline'
export const MIGRATIONS_TABLE = '_prisma_migrations'
export type MigrationOptions = { databaseUrl?: string, baseline?: boolean }
type Execute = (args: string[], options: MigrationOptions) => Promise<number>
const frontend = fileURLToPath(new URL('../../', import.meta.url))
const cli = fileURLToPath(new URL('../../node_modules/prisma/build/index.js', import.meta.url))

// These PostgreSQL features cannot all be represented or checked by Prisma's
// schema diff. Check their actual expressions before adopting an existing DB.
export const BASELINE_CHECKS: Record<string, string> = {
  'users/users_role_valid': "role IN ('user', 'admin')",
  'questions/questions_exam_number_positive': 'exam_number >= 1',
  'questions/questions_question_number_positive': 'question_number >= 1',
  'question_choices/question_choices_display_order_positive': 'display_order >= 1',
  'payments/payments_amount_positive': 'amount > 0',
  'payments/payments_currency_valid': "currency = 'jpy'",
  'payments/payments_refunded_amount_range': 'refunded_amount >= 0 AND refunded_amount <= amount',
  'payments/payments_status_valid': "status IN ('pending', 'paid', 'expired', 'partially_refunded', 'refunded', 'disputed')",
  'memberships/memberships_status_valid': "status IN ('active', 'revoked')",
  'verification_access_grants/verification_access_grants_audit_required': 'char_length(btrim(reason)) > 0 AND char_length(btrim(granted_by)) > 0',
  'verification_access_grants/verification_access_grants_limited_duration': "expires_at > created_at AND expires_at <= created_at + interval '7 days'",
  'api_rate_limit_buckets/api_rate_limit_count_positive': 'request_count > 0',
}
export const BASELINE_PARTIAL_INDEXES: Record<string, { column: string, predicate: string }> = {
  'question_choices/index_question_choices_one_correct_answer': { column: 'question_id', predicate: 'is_correct = true' },
  'payments/index_payments_on_stripe_payment_intent_id': { column: 'stripe_payment_intent_id', predicate: 'stripe_payment_intent_id IS NOT NULL' },
  'payments/index_payments_on_stripe_charge_id': { column: 'stripe_charge_id', predicate: 'stripe_charge_id IS NOT NULL' },
  'payments/index_payments_on_stripe_dispute_id': { column: 'stripe_dispute_id', predicate: 'stripe_dispute_id IS NOT NULL' },
  'payments/index_payments_one_pending_per_user': { column: 'user_id', predicate: "status = 'pending' AND user_id IS NOT NULL" },
}

/** Normalize parser-added casts/parentheses, preserving literal values exactly. */
export function normalizedExpression(expression: string) {
  const literals: string[] = []
  return expression.replace(/interval\s*('(?:''|[^'])*')/gi, '$1::interval')
    .replace(/'(?:''|[^'])*'/g, literal => { literals.push(literal); return `$literal${literals.length - 1}$` })
    .replace(/::(?:character varying|text)(?:\[\])?(?![\w\[])/g, '')
    .replace(/[()\s]/g, '').replace(/=ANYARRAY\[/gi, 'IN').replace(/\]/g, '')
    .replace(/\$literal(\d+)\$/g, (_token, index) => literals[Number(index)]!)
}
export function assertBaselineFeatures(
  checks: { table_name: string, name: string, expression: string }[],
  indexes: { table_name: string, name: string, column_name: string, predicate: string, unique: boolean, columns: number, valid: boolean }[],
) {
  for (const [key, expression] of Object.entries(BASELINE_CHECKS)) {
    const found = checks.find(check => `${check.table_name}/${check.name}` === key)
    if (!found || normalizedExpression(found.expression) !== normalizedExpression(expression)) throw new OperationError('既存DBのCHECK制約が初期スキーマと一致しません。baselineを中止しました')
  }
  for (const [key, expected] of Object.entries(BASELINE_PARTIAL_INDEXES)) {
    const found = indexes.find(index => `${index.table_name}/${index.name}` === key)
    if (!found || !found.unique || !found.valid || found.columns !== 1 || found.column_name !== expected.column || normalizedExpression(found.predicate) !== normalizedExpression(expected.predicate)) throw new OperationError('既存DBの部分一意インデックスが初期スキーマと一致しません。baselineを中止しました')
  }
}
async function verifyBaseline(options: MigrationOptions) {
  const owned = options.databaseUrl ? createDatabase(options.databaseUrl) : undefined
  const db: Database = owned || getDatabase()
  try {
    const checks = await query<{ table_name: string, name: string, expression: string }>(`SELECT c.relname AS table_name, con.conname AS name, pg_get_expr(con.conbin, con.conrelid) AS expression
      FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=current_schema() AND con.contype='c'`, [], db)
    const indexes = await query<{ table_name: string, name: string, column_name: string, predicate: string, unique: boolean, columns: number, valid: boolean }>(`SELECT t.relname AS table_name, c.relname AS name,
      pg_get_indexdef(i.indexrelid,1,true) AS column_name, pg_get_expr(i.indpred,i.indrelid) AS predicate,
      i.indisunique AS unique, i.indnatts::integer AS columns, i.indisvalid AS valid
      FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_class t ON t.oid=i.indrelid
      JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname=current_schema() AND i.indpred IS NOT NULL`, [], db)
    assertBaselineFeatures(checks, indexes)
  } finally { await owned?.$disconnect() }
}
const execute: Execute = (args, options) => new Promise(resolve => {
  execFile(process.execPath, [cli, ...args], { cwd: frontend, env: { ...process.env,
    ...(options.databaseUrl ? { DATABASE_URL: options.databaseUrl } : {}), CHECKPOINT_DISABLE: '1' },
  timeout: 60000, maxBuffer: 1024 * 1024 }, error => {
    // Output can include connection strings or SQL. Never forward it to logs.
    resolve(error ? (typeof error.code === 'number' ? error.code : 1) : 0)
  })
})

/** Exported factory keeps command sequencing testable without starting a DB. */
export function migrationRunner(run: Execute, verify: (options: MigrationOptions) => Promise<void>) {
  return async (options: MigrationOptions = {}) => {
    if (!options || Object.keys(options).some(key => !['databaseUrl', 'baseline'].includes(key)) ||
      (options.databaseUrl !== undefined && (typeof options.databaseUrl !== 'string' || !options.databaseUrl)) ||
      (options.baseline !== undefined && typeof options.baseline !== 'boolean')) throw new OperationError('マイグレーションにはDB接続設定とbaselineの指定だけを使用してください')
    if (options.baseline) {
      const result = await run(['migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/baseline.prisma', '--exit-code'], options)
      if (result !== 0) throw new OperationError('既存DBとPrismaスキーマが一致しないか照合に失敗しました。baselineを中止しました')
      await verify(options)
      if (await run(['migrate', 'resolve', '--applied', BASELINE_MIGRATION], options) !== 0) throw new OperationError('Prismaのbaseline登録に失敗しました。履歴とスキーマを確認してください')
      return { migration_status: 'baselined' as const, baseline: BASELINE_MIGRATION }
    }
    if (await run(['migrate', 'deploy'], options) !== 0) throw new OperationError('Prisma Migrateの適用に失敗しました。DB接続・スキーマ・適用履歴を確認してください')
    return { migration_status: 'up_to_date' as const }
  }
}

// Prisma Migrate owns its connection, locks and migration transactions. It must
// not run inside a caller's Prisma transaction. No reset or automatic adoption.
export const migrate = migrationRunner(execute, verifyBaseline)
