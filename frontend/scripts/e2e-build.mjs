import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

/** No caller-supplied filesystem path is accepted for disposable build output. */
export function e2eBuildPaths(env = process.env) {
  const id = env.EXAM_E2E_RUN_ID
  if (id === undefined) return undefined
  if (env.APP_ENV !== 'test' || !/^[a-f0-9]{24}$/.test(id)) throw new Error('E2E build output requires test mode and a generated run identifier.')
  const root = fileURLToPath(new URL(`../.e2e-build/${id}/`, import.meta.url))
  return { root, build: join(root, '.nuxt'), output: join(root, '.output'), server: join(root, '.output/server/index.mjs') }
}

export function e2eBuildConfiguration(env = process.env) {
  const paths = e2eBuildPaths(env)
  return paths ? { buildDir: paths.build, nitro: { output: { dir: paths.output } } } : {}
}
