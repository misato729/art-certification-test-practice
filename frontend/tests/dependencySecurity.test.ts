import assert from 'node:assert/strict'
import { constants, createHash, generateKeyPairSync, privateEncrypt, sign, verify } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { after, test } from 'node:test'
import { NODE_FORGE_SECURITY_PATCH, applyRsaSecurityPatch, assertSupportedForgeLockfile, patchNodeForge, sha256 } from '../scripts/patch-node-forge.mjs'

const require = createRequire(import.meta.url)
const installedDirectory = dirname(require.resolve('node-forge/package.json'))
const installedSource = readFileSync(resolve(installedDirectory, 'lib/rsa.js'), 'utf8')
assert.equal(sha256(installedSource), NODE_FORGE_SECURITY_PATCH.patchedSha256,
  'Run the dependency postinstall step before testing; the installed Forge must be patched.')

// Reconstruct the exact published source as a negative control, in a temporary
// package only. No vulnerable source is restored into the application's install.
function publishedSource(patched: string): string {
  const lines = patched.split('\n')
  const diff = readFileSync(new URL('../patches/node-forge-1.4.0.patch', import.meta.url), 'utf8').trimEnd().split('\n')
  const output: string[] = []
  let cursor = 0
  for (let index = 0; index < diff.length; index++) {
    const hunk = /^@@ -\d+,\d+ \+(\d+),\d+ @@/.exec(diff[index]!)
    if (!hunk) continue
    const start = Number(hunk[1]) - 1
    output.push(...lines.slice(cursor, start))
    cursor = start
    while (index + 1 < diff.length && !diff[index + 1]!.startsWith('@@')) {
      const line = diff[++index]!
      if (line[0] === ' ' || line[0] === '+') assert.equal(lines[cursor++], line.slice(1))
      if (line[0] === ' ' || line[0] === '-') output.push(line.slice(1))
    }
  }
  output.push(...lines.slice(cursor))
  const original = output.join('\n')
  assert.equal(sha256(original), NODE_FORGE_SECURITY_PATCH.originalSha256)
  return original
}

const originalSource = publishedSource(installedSource)
const temporaryRoot = mkdtempSync(join(tmpdir(), 'exam-forge-security-'))
after(() => rmSync(temporaryRoot, { recursive: true, force: true }))

function isolatedForge(name: string, source: string) {
  const directory = join(temporaryRoot, name)
  mkdirSync(directory)
  cpSync(resolve(installedDirectory, 'lib'), join(directory, 'lib'), { recursive: true })
  writeFileSync(join(directory, 'lib/rsa.js'), source)
  return require(join(directory, 'lib/index.js'))
}

const vulnerableForge = isolatedForge('original', originalSource)
const securedForge = isolatedForge('patched', installedSource)
const message = Buffer.from('Dependency security regression: synthetic RSA test data only.')
const hashes = ['sha256', 'sha384', 'sha512'] as const
type Hash = typeof hashes[number]
const identifiers: Record<Hash, string> = {
  sha256: '0609608648016503040201',
  sha384: '0609608648016503040202',
  sha512: '0609608648016503040203'
}
const keyPairs = [3, 65537].map((exponent) => ({
  exponent,
  ...generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent: exponent })
}))

function der(tag: number, value: Buffer, nonMinimalLength = false): Buffer {
  assert.ok(value.length < 128, 'The synthetic DER fixtures use short lengths.')
  return Buffer.concat([Buffer.from(nonMinimalLength ? [tag, 0x81, value.length] : [tag, value.length]), value])
}

function digestInfo(hash: Hash, parameters: Buffer | null = Buffer.from('0500', 'hex'),
  extra: Buffer = Buffer.alloc(0), outerLong = false, innerLong = false): Buffer {
  const identifier = Buffer.concat([Buffer.from(identifiers[hash], 'hex'), parameters ?? Buffer.alloc(0), extra])
  const digest = createHash(hash).update(message).digest()
  return der(0x30, Buffer.concat([der(0x30, identifier, innerLong), der(0x04, digest)]), outerLong)
}

function signRawDigestInfo(info: Buffer, privateKey: typeof keyPairs[number]['privateKey']): Buffer {
  // Deliberately sign a malformed EMSA block using a disposable private key.
  // This tests verification acceptance without relying on a probabilistic
  // cube-root forgery generator or disabling any Forge verification checks.
  const block = Buffer.concat([Buffer.from([0, 1]), Buffer.alloc(256 - info.length - 3, 0xff), Buffer.from([0]), info])
  return privateEncrypt({ key: privateKey, padding: constants.RSA_NO_PADDING }, block)
}

function publicForgeKey(forge: any, keyPair: typeof keyPairs[number]) {
  return forge.pki.publicKeyFromPem(keyPair.publicKey.export({ type: 'spki', format: 'pem' }))
}

test('the installed dependency has the reviewed backport and retains its published version', () => {
  assert.equal(patchNodeForge({ checkOnly: true }), 'already-patched')
  const metadata = JSON.parse(readFileSync(resolve(installedDirectory, 'package.json'), 'utf8'))
  assert.equal(metadata.version, '1.4.0')
  assert.equal(applyRsaSecurityPatch(originalSource), installedSource)
  assert.throws(() => applyRsaSecurityPatch(`${originalSource}\n`), /Unexpected original/)
  const lockfile = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'))
  assert.doesNotThrow(() => assertSupportedForgeLockfile(lockfile))
  lockfile.packages['node_modules/unexpected-package/node_modules/node-forge'] = { version: '1.4.0' }
  assert.throws(() => assertSupportedForgeLockfile(lockfile), /Unexpected node-forge dependency graph/)
})

test('patch application is idempotent, check-only does not repair, and unknown inputs fail closed', () => {
  const directory = join(temporaryRoot, 'patch-lifecycle')
  mkdirSync(join(directory, 'lib'), { recursive: true })
  const metadataPath = join(directory, 'package.json')
  const rsaPath = join(directory, 'lib/rsa.js')
  writeFileSync(metadataPath, JSON.stringify({ name: 'node-forge', version: '1.4.0' }))
  writeFileSync(rsaPath, originalSource)
  assert.throws(() => patchNodeForge({ packageDirectory: directory, checkOnly: true }), /backport is missing/)
  assert.equal(readFileSync(rsaPath, 'utf8'), originalSource)
  assert.equal(patchNodeForge({ packageDirectory: directory }), 'patched')
  assert.equal(patchNodeForge({ packageDirectory: directory }), 'already-patched')
  assert.equal(patchNodeForge({ packageDirectory: directory, checkOnly: true }), 'already-patched')
  assert.equal(sha256(readFileSync(rsaPath)), NODE_FORGE_SECURITY_PATCH.patchedSha256)
  writeFileSync(rsaPath, `${installedSource}\n`)
  assert.throws(() => patchNodeForge({ packageDirectory: directory }), /Unexpected installed/)
  assert.equal(readFileSync(rsaPath, 'utf8'), `${installedSource}\n`)
  writeFileSync(metadataPath, JSON.stringify({ name: 'node-forge', version: '1.4.1' }))
  assert.throws(() => patchNodeForge({ packageDirectory: directory }), /Unexpected node-forge package\/version/)
})

test('patched verification rejects malformed DigestInfo accepted by published 1.4.0, including e=3', () => {
  for (const keyPair of keyPairs) {
    for (const hash of hashes) {
      const digest = createHash(hash).update(message).digest('latin1')
      const originalKey = publicForgeKey(vulnerableForge, keyPair)
      const patchedKey = publicForgeKey(securedForge, keyPair)
      const vectors = {
        'extra nested element': digestInfo(hash, Buffer.from('0500', 'hex'), Buffer.from('0203aabbcc', 'hex')),
        'non-NULL parameter element': digestInfo(hash, Buffer.from('0402abcd', 'hex')),
        'NULL with content bytes': digestInfo(hash, Buffer.from('0502abcd', 'hex')),
        'non-minimal outer length': digestInfo(hash, Buffer.from('0500', 'hex'), Buffer.alloc(0), true),
        'non-minimal inner length': digestInfo(hash, Buffer.from('0500', 'hex'), Buffer.alloc(0), false, true)
      }
      for (const [name, info] of Object.entries(vectors)) {
        const signature = signRawDigestInfo(info, keyPair.privateKey).toString('latin1')
        const context = `${hash}, e=${keyPair.exponent}, ${name}`
        assert.equal(originalKey.verify(digest, signature), true, `Vulnerable negative control: ${context}`)
        assert.throws(() => patchedKey.verify(digest, signature), /DigestInfo/, context)
      }
    }
  }
})

test('SHA-256/384/512 signatures interoperate with Node/OpenSSL and Forge retains parameterless forms', () => {
  for (const keyPair of keyPairs) {
    for (const hash of hashes) {
      const digest = createHash(hash).update(message).digest('latin1')
      for (const forge of [vulnerableForge, securedForge]) {
        const publicKey = publicForgeKey(forge, keyPair)
        const nativeSignature = sign(hash, message, keyPair.privateKey)
        assert.equal(publicKey.verify(digest, nativeSignature.toString('latin1')), true)
        for (const parameters of [Buffer.from('0500', 'hex'), null]) {
          const signature = signRawDigestInfo(digestInfo(hash, parameters), keyPair.privateKey)
          assert.equal(publicKey.verify(digest, signature.toString('latin1')), true)
          // Node/OpenSSL signs and verifies the canonical NULL form. Its current
          // strict verifier rejects the omitted form, while Forge intentionally
          // preserves that existing optional-parameters behavior.
          if (parameters !== null) {
            assert.equal(verify(hash, message, keyPair.publicKey, signature), true,
              `${hash}, e=${keyPair.exponent}, OpenSSL ${process.versions.openssl}`)
          }
        }
        const privateKey = forge.pki.privateKeyFromPem(keyPair.privateKey.export({ type: 'pkcs1', format: 'pem' }))
        const forgeDigest = forge.md[hash].create().update(message.toString('latin1'))
        const forgeSignature = Buffer.from(privateKey.sign(forgeDigest), 'latin1')
        assert.equal(verify(hash, message, keyPair.publicKey, forgeSignature), true)
        assert.equal(publicKey.verify(createHash(hash).update('different message').digest('latin1'), nativeSignature.toString('latin1')), false)
      }
    }
  }
})

test('strict trailing-byte and outer-element rejection is retained', () => {
  const keyPair = keyPairs[0]!
  const hash = 'sha256'
  const digest = createHash(hash).update(message).digest('latin1')
  const originalInfo = digestInfo(hash)
  const withOuterExtra = der(0x30, Buffer.concat([originalInfo.subarray(2), Buffer.from('0500', 'hex')]))
  for (const forge of [vulnerableForge, securedForge]) {
    const publicKey = publicForgeKey(forge, keyPair)
    for (const info of [Buffer.concat([originalInfo, Buffer.from([0])]), withOuterExtra]) {
      const signature = signRawDigestInfo(info, keyPair.privateKey).toString('latin1')
      assert.throws(() => publicKey.verify(digest, signature))
    }
  }
})
