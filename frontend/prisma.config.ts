import { defineConfig } from 'prisma/config'
import { databaseURL } from './server/core/database-url.ts'

const url = databaseURL()
const schema = new URL(url).searchParams.get('schema') || 'public'
if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) throw new Error('Unsupported database schema name')

// Retain only known historical bookkeeping tables outside Prisma ownership.
// Application tables, unknown tables and their drift remain fully checked.
const legacyLedgers = ['pgmigrations', 'nitro_schema_migrations', 'schema_migrations', 'ar_internal_metadata']

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url },
  experimental: { externalTables: true },
  tables: { external: legacyLedgers.map(table => `${schema}.${table}`) },
})
