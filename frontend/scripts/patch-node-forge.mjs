import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Backport only lib/rsa.js from the still-unreleased upstream fix. Keep the
// published version and npm audit findings visible until upstream releases it.
export const NODE_FORGE_SECURITY_PATCH = Object.freeze({
  version: '1.4.0',
  advisory: 'GHSA-86w9-cpqp-85rv',
  upstream: 'https://github.com/digitalbazaar/forge/pull/1159',
  commit: 'db05494352dd3c9a5a07c5270333dcc78866cad2',
  originalSha256: 'fd4740238145ec26470eb3f06a627c72039538ce1307dbdce40521f94dfd0a50',
  patchedSha256: 'c7b72e7ef41f4fc0e5228dce3e37851e9ca064c789365d5e392c25d1c5f6e710',
  patchSha256: '50535157159e45cd05fb40a900b164b54428bcfbafd5aed9136aeb2866962a4b'
})

const require = createRequire(import.meta.url)
const patchPath = new URL('../patches/node-forge-1.4.0.patch', import.meta.url)
export const sha256 = (value) => createHash('sha256').update(value).digest('hex')

export function assertSupportedForgeLockfile(lockfile) {
  const copies = Object.entries(lockfile.packages ?? {})
    .filter(([path]) => path === 'node_modules/node-forge' || path.endsWith('/node_modules/node-forge'))
  if (copies.length !== 1 || copies[0][0] !== 'node_modules/node-forge' ||
    copies[0][1].version !== NODE_FORGE_SECURITY_PATCH.version) {
    throw new Error('Unexpected node-forge dependency graph; review every copy before updating the security backport.')
  }
}

// This deliberately supports only exact unified hunks, without fuzzy matching
// or shell commands. Both input and output are pinned to independently checked
// upstream hashes, so an upstream change requires a deliberate review.
export function applyRsaSecurityPatch(source) {
  if (sha256(source) !== NODE_FORGE_SECURITY_PATCH.originalSha256) {
    throw new Error('Unexpected original node-forge lib/rsa.js; review the security patch before updating.')
  }
  const patch = readFileSync(patchPath, 'utf8')
  if (sha256(patch) !== NODE_FORGE_SECURITY_PATCH.patchSha256) {
    throw new Error('Unexpected node-forge security patch data.')
  }
  const sourceLines = source.split('\n')
  const patchLines = patch.trimEnd().split('\n')
  const output = []
  let cursor = 0
  let hunks = 0
  for (let index = 0; index < patchLines.length; index++) {
    const header = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@/.exec(patchLines[index])
    if (!header) continue
    hunks++
    const start = Number(header[1]) - 1
    if (start < cursor) throw new Error('Overlapping node-forge security patch hunks.')
    output.push(...sourceLines.slice(cursor, start))
    cursor = start
    let removed = 0
    let added = 0
    while (index + 1 < patchLines.length && !patchLines[index + 1].startsWith('@@')) {
      const line = patchLines[++index]
      const marker = line[0]
      const value = line.slice(1)
      if (marker === ' ' || marker === '-') {
        if (sourceLines[cursor] !== value) throw new Error('node-forge security patch context does not match.')
        cursor++
        removed++
      }
      if (marker === ' ' || marker === '+') {
        output.push(value)
        added++
      }
      if (![' ', '-', '+'].includes(marker)) throw new Error('Invalid node-forge security patch hunk.')
    }
    if (removed !== Number(header[2]) || added !== Number(header[4])) {
      throw new Error('Unexpected node-forge security patch hunk length.')
    }
  }
  output.push(...sourceLines.slice(cursor))
  const patched = output.join('\n')
  if (hunks !== 3 || sha256(patched) !== NODE_FORGE_SECURITY_PATCH.patchedSha256) {
    throw new Error('node-forge security backport does not match the reviewed upstream source.')
  }
  return patched
}

/** @param {{ checkOnly?: boolean, packageDirectory?: string }} [options] */
export function patchNodeForge({ checkOnly = false, packageDirectory } = {}) {
  assertSupportedForgeLockfile(JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8')))
  // Missing or newly hoisted packages must be reviewed rather than silently
  // claiming that the known transitive dependency has been secured.
  const directory = packageDirectory ?? dirname(require.resolve('node-forge/package.json'))
  const metadata = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'))
  if (metadata.name !== 'node-forge' || metadata.version !== NODE_FORGE_SECURITY_PATCH.version) {
    throw new Error('Unexpected node-forge package/version; review and retire or update the security backport.')
  }
  const rsaPath = resolve(directory, 'lib/rsa.js')
  const source = readFileSync(rsaPath, 'utf8')
  const digest = sha256(source)
  if (digest === NODE_FORGE_SECURITY_PATCH.patchedSha256) return 'already-patched'
  if (digest !== NODE_FORGE_SECURITY_PATCH.originalSha256) {
    throw new Error('Unexpected installed node-forge lib/rsa.js; refusing to overwrite it.')
  }
  if (checkOnly) throw new Error('node-forge security backport is missing; run the dependency postinstall step.')
  const patched = applyRsaSecurityPatch(source)
  const temporaryPath = `${rsaPath}.security-${process.pid}-${randomUUID()}`
  try {
    writeFileSync(temporaryPath, patched, { flag: 'wx' })
    renameSync(temporaryPath, rsaPath)
  } finally {
    rmSync(temporaryPath, { force: true })
  }
  return 'patched'
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2)
    if (args.some((arg) => arg !== '--check') || args.length > 1) {
      throw new Error('Usage: node scripts/patch-node-forge.mjs [--check]')
    }
    const result = patchNodeForge({ checkOnly: args.includes('--check') })
    console.log(`node-forge ${NODE_FORGE_SECURITY_PATCH.advisory}: ${result}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'node-forge security patch failed.')
    process.exitCode = 1
  }
}
