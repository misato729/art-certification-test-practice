import pg from 'pg'
import type { Pool, PoolClient } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, Prisma } from '../../generated/prisma/client.ts'
import { databaseURL } from './database-url.ts'

export { Prisma }
export type Database = Prisma.TransactionClient
export type RawDatabase = Pick<Pool | PoolClient, 'query'>
type DeepRecord<T> = T extends bigint ? number : T extends Date ? Date : T extends readonly (infer U)[] ? DeepRecord<U>[] : T extends object ? { [K in keyof T]: DeepRecord<T[K]> } : T
let client: PrismaClient | undefined
// Legacy catalog/restore queries share the same UTC and safe integer conventions.
pg.defaults.parseInputDatesAsUTC = true
pg.types.setTypeParser(1114, (value: string) => new Date(value.replace(' ', 'T') + 'Z'))
pg.types.setTypeParser(20, (value: string) => safeInteger(BigInt(value)))
function safeInteger(value: bigint): number {
  const result = Number(value)
  if (!Number.isSafeInteger(result)) throw new Error('Database integer exceeds the safe range')
  return result
}
/** Keep the existing numeric API IDs; never stringify BigInt IDs implicitly. */
export function record<T>(value: T): DeepRecord<T> {
  if (typeof value === 'bigint') return safeInteger(value) as DeepRecord<T>
  if (value instanceof Date || value === null || typeof value !== 'object') return value as DeepRecord<T>
  if (Array.isArray(value)) return value.map(record) as DeepRecord<T>
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, record(item)])) as DeepRecord<T>
}
export function json(value: unknown): Prisma.InputJsonValue { return value as Prisma.InputJsonValue }
export function createDatabase(connectionString: string): PrismaClient {
  const url = new URL(connectionString)
  const schema = url.searchParams.get('schema') || 'public'
  url.searchParams.delete('schema')
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) throw new Error('Unsupported database schema name')
  const adapter = new PrismaPg({ connectionString: url.toString(), max: 10, options: `-c timezone=UTC -c search_path=${schema}` }, { schema })
  return new PrismaClient({ adapter })
}
export function getDatabase(): PrismaClient { return client ??= createDatabase(databaseURL()) }

/** SQL escape hatch for PostgreSQL row/advisory locks and administrative catalogs. */
export async function query<T = Record<string, any>>(text: string, values: unknown[] = [], db: Database | RawDatabase = getDatabase()): Promise<T[]> {
  try {
    if ('query' in db) {
      const result = await db.query(text, values)
      return record(Array.isArray(result) ? [] : result.rows || []) as T[]
    }
    if (/^\s*(SELECT|WITH|SHOW|EXPLAIN)\b/i.test(text) || /\bRETURNING\b/i.test(text)) {
      return record(await db.$queryRawUnsafe(text, ...values)) as T[]
    }
    await db.$executeRawUnsafe(text, ...values)
    return []
  } catch (error) {
    // Tests and boundary handlers may still inspect a PostgreSQL SQLSTATE.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2010') {
      // Prisma 7's driver adapter keeps the original code in its cause; older
      // Prisma engines exposed it directly as meta.code.
      const adapter = error.meta?.driverAdapterError as { cause?: { originalCode?: unknown, code?: unknown } } | undefined
      const code = error.meta?.code ?? adapter?.cause?.originalCode ?? adapter?.cause?.code
      if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) Object.defineProperty(error, 'code', { value: code, configurable: true })
    }
    throw error
  }
}
export function isUniqueViolation(error: unknown): boolean {
  const pending = [error]
  const seen = new Set<object>()
  while (pending.length) {
    const current = pending.pop()
    if (!current || typeof current !== 'object' || seen.has(current)) continue
    seen.add(current)
    const item = current as { code?: unknown, originalCode?: unknown, cause?: unknown, meta?: { code?: unknown, driverAdapterError?: unknown } }
    if (item.code === 'P2002' || item.code === '23505' || item.originalCode === '23505' || item.meta?.code === '23505') return true
    pending.push(item.cause, item.meta?.driverAdapterError)
  }
  return false
}
export async function transaction<T>(action: (db: Database) => Promise<T>, existing?: Database): Promise<T> {
  if (existing) return action(existing)
  return getDatabase().$transaction(action, { timeout: 60_000, maxWait: 10_000 })
}
/** Test fixtures use a migrated, isolated database and always roll back. */
export async function isolatedTransaction<T>(action: (db: Database) => Promise<T>): Promise<T> {
  if (process.env.APP_ENV !== 'test') throw new Error('Isolated transactions require APP_ENV=test')
  const rollback = new Error('test transaction rollback')
  let value: T
  try {
    await getDatabase().$transaction(async db => { value = await action(db); throw rollback }, { timeout: 60_000, maxWait: 10_000 })
  } catch (error) { if (error !== rollback) throw error }
  return value!
}
export async function closeDatabase() {
  if (client) await client.$disconnect()
  client = undefined
}
