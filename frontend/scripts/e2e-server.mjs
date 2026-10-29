import { access } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import pg from 'pg'
import { e2eSettings, e2eDatabase, e2eServerEnvironment } from './e2e-settings.mjs'
import { loadE2EFixture } from './e2e-fixture.mjs'
import { e2eBuildPaths } from './e2e-build.mjs'

let maintenance
let database
let child
let created = false
let shutdownRequested = false
let forceTimer

function requestShutdown() {
  shutdownRequested = true
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM')
    forceTimer ??= setTimeout(() => child?.kill('SIGKILL'), 5000)
    forceTimer.unref()
  }
}

const checkShutdown = () => { if (shutdownRequested) throw new Error('shutdown requested') }
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, requestShutdown)

async function run(args, env) {
  checkShutdown()
  child = spawn(process.execPath, args, { cwd: new URL('../', import.meta.url), env, stdio: 'inherit' })
  const [code] = await once(child, 'exit')
  child = undefined
  if (forceTimer) clearTimeout(forceTimer)
  forceTimer = undefined
  checkShutdown()
  if (code !== 0) throw new Error('E2E child process failed')
}

try {
  const settings = e2eSettings()
  loadE2EFixture()
  const buildPaths = e2eBuildPaths()
  if (!buildPaths) throw new Error('Use npm run test:e2e to prepare the isolated browser-test build.')
  await access(buildPaths.server)
  checkShutdown()
  database = e2eDatabase(settings)
  const env = e2eServerEnvironment(settings, database.url.toString())
  maintenance = new pg.Client({ connectionString: settings.maintenance.toString(), connectionTimeoutMillis: 10000 })
  maintenance.on('error', () => { console.error('E2E maintenance database connection unavailable.'); process.exitCode = 1; requestShutdown() })
  await maintenance.connect()
  checkShutdown()
  await maintenance.query(`CREATE DATABASE "${database.name}"`)
  // Mark ownership before inspecting a signal delivered while CREATE was running.
  created = true
  checkShutdown()
  for (const command of ['db:migrate', 'questions:import_content']) {
    await run(['--experimental-strip-types', 'server/operations/cli.ts', command], { ...env, CONFIRM: 'IMPORT_INTO_EMPTY_DATABASE' })
  }
  console.log(`E2E isolated server starting at ${settings.origin}.`)
  await run([buildPaths.server], env)
  // A test server is expected to stay alive until Playwright stops it.
  process.exitCode = 1
} catch (error) {
  if (!shutdownRequested) {
    const safeMessages = ['E2E_DATABASE_URL must explicitly name a local PostgreSQL maintenance database ending in _test, without URL options.',
      'E2E_PORT must be an integer between 3200 and 65535.',
      'E2E fixture validation failed. Check the shared configuration and sample content.',
      'Use npm run test:e2e to prepare the isolated browser-test build.',
      'Core browser journeys require a published sample question and payments.enabled=false in the isolated fixture.']
    console.error(safeMessages.includes(error.message) ? error.message : 'E2E startup failed. Check the isolated PostgreSQL URL, build output, and fixture validation.')
    process.exitCode = 1
  }
} finally {
  // Setup is settled before cleanup, including cancellation during CREATE/migrate.
  if (forceTimer) clearTimeout(forceTimer)
  if (maintenance && created) {
    try {
      // The only interpolated identifier was generated here, never user input.
      await maintenance.query(`DROP DATABASE "${database.name}" WITH (FORCE)`)
      console.log('E2E disposable database removed.')
    } catch {
      console.error('Unable to remove the E2E disposable database; inspect local databases with the exam_e2e_ prefix.')
      process.exitCode = 1
    }
  }
  if (maintenance) await maintenance.end().catch(() => {})
}
