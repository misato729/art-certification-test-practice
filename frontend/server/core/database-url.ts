/** Shared connection settings for Prisma Client and Prisma Migrate. */
export function databaseURL(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const url = new URL('postgresql://127.0.0.1')
  url.hostname = process.env.PGHOST || process.env.DB_HOST || '127.0.0.1'
  url.port = process.env.PGPORT || process.env.DB_PORT || '5432'
  url.pathname = '/' + (process.env.PGDATABASE || process.env.DB_NAME || 'exam_practice_development')
  url.username = process.env.PGUSER || process.env.POSTGRES_USER || 'exam_practice'
  url.password = process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD || ''
  return url.toString()
}
