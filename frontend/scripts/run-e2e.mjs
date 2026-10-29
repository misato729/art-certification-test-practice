import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { e2eSettings, e2eDatabase, e2eServerEnvironment } from './e2e-settings.mjs'
import { loadE2EFixture } from './e2e-fixture.mjs'
import { e2eBuildPaths } from './e2e-build.mjs'

let folder
let child
let buildPaths
let interrupted = false
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { interrupted = true; child?.kill(signal) })

try {
  const settings = e2eSettings()
  loadE2EFixture()
  const env = e2eServerEnvironment(settings, e2eDatabase(settings).url.toString())
  env.EXAM_E2E_RUN_ID = randomBytes(12).toString('hex')
  buildPaths = e2eBuildPaths(env)
  folder = await mkdtemp(join(tmpdir(), 'exam-e2e-build-'))
  const dotenv = join(folder, 'empty.env')
  // Nuxt must not load the normal service's .env while compiling browser tests.
  await writeFile(dotenv, '# Isolated browser-test build; values are supplied by the harness.\n', { mode: 0o600 })
  const commands = [
    ['scripts/patch-node-forge.mjs', '--check'],
    ['node_modules/prisma/build/index.js', 'generate'],
    ['node_modules/nuxt/bin/nuxt.mjs', 'build', '--dotenv', dotenv],
    ['node_modules/@playwright/test/cli.js', 'test', ...process.argv.slice(2)],
  ]
  for (const args of commands) {
    if (interrupted) break
    child = spawn(process.execPath, args, { cwd: fileURLToPath(new URL('../', import.meta.url)), env, stdio: 'inherit' })
    const [code] = await once(child, 'exit')
    child = undefined
    if (code !== 0) { process.exitCode = code ?? 1; break }
  }
  if (interrupted) process.exitCode = 1
} catch {
  console.error('Unable to run isolated browser tests. Check E2E_DATABASE_URL, sample fixtures, dependencies and browser installation.')
  process.exitCode = 1
} finally {
  if (folder) await rm(folder, { recursive: true, force: true })
  if (buildPaths) await rm(buildPaths.root, { recursive: true, force: true })
}
