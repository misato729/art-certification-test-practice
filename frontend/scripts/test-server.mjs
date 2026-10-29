import { spawn } from 'node:child_process'
import { readdir } from 'node:fs/promises'

const env = { ...process.env, APP_ENV: 'test' }
let databaseUrl = env.TEST_DATABASE_URL || env.DATABASE_URL
if (!databaseUrl) {
  const url = new URL('postgresql://localhost')
  url.hostname = env.PGHOST || env.DB_HOST || '127.0.0.1'
  url.port = env.PGPORT || env.DB_PORT || '5432'
  url.username = env.PGUSER || env.POSTGRES_USER || 'exam_practice'
  url.password = env.PGPASSWORD || env.POSTGRES_PASSWORD || ''
  url.pathname = '/' + (env.PGDATABASE || env.DB_NAME || '')
  databaseUrl = url.toString()
}
try {
  const url = new URL(databaseUrl)
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !/^\/[a-zA-Z0-9_]+_test$/.test(url.pathname)) throw new Error()
} catch {
  console.error('Server tests require an explicitly isolated PostgreSQL database whose name ends in _test.')
  process.exit(1)
}
env.TEST_DATABASE_URL = env.DATABASE_URL = databaseUrl
const tests = (await readdir(new URL('../server-tests/', import.meta.url))).filter(name => name.endsWith('.test.ts')).sort().map(name => `server-tests/${name}`)
const child = spawn(process.execPath, ['--experimental-strip-types', '--test', '--test-concurrency=1', ...tests], { env, stdio: 'inherit' })
child.on('error', () => { console.error('Unable to start server tests'); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
