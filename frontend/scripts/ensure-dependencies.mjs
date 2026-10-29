import { createHash } from 'node:crypto'
import { access, readFile, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { patchNodeForge } from './patch-node-forge.mjs'

const digest = createHash('sha256').update(await readFile(new URL('../package-lock.json', import.meta.url))).digest('hex')
const marker = new URL('../node_modules/.exam-template-lock-sha256', import.meta.url)
const prismaMarker = new URL('../generated/prisma/.exam-template-schema-sha256', import.meta.url)
const prismaDigest = createHash('sha256').update(digest).update(await readFile(new URL('../prisma/schema.prisma', import.meta.url))).digest('hex')
let record = process.argv.includes('--record')
if (!record) {
  const installed = await readFile(marker, 'utf8').catch(() => '')
  if (installed !== digest) {
    if (process.env.NODE_ENV === 'production') {
      console.error('Production dependencies do not match the image lockfile. Rebuild the image.')
      process.exit(1)
    }
    console.info('Preparing dependencies for the updated template')
    const result = await new Promise((resolve, reject) => {
      const child = spawn('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { stdio: 'inherit' })
      child.on('error', reject)
      child.on('exit', resolve)
    })
    if (result !== 0) process.exit(1)
    record = true
  }
}
// Existing dependency volumes also need the reviewed fix. Record readiness only
// after its exact source hash is verified, including --ignore-scripts installs.
patchNodeForge()
// The source bind mount can hide the client generated in the image even when
// its dependency volume is current. Regenerate missing or stale source clients.
const installedPrisma = await readFile(prismaMarker, 'utf8').catch(() => '')
const hasClient = await access(new URL('../generated/prisma/client.ts', import.meta.url)).then(() => true, () => false)
if (record || !hasClient || installedPrisma !== prismaDigest) {
  const generated = await new Promise((resolve, reject) => {
    const child = spawn('npm', ['run', 'db:generate'], { stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', resolve)
  })
  if (generated !== 0) process.exit(1)
  await writeFile(prismaMarker, prismaDigest)
}
if (record) await writeFile(marker, digest)
