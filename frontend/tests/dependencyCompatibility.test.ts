import assert from 'node:assert/strict'
import { createPrivateKey, X509Certificate } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import type { RequestListener } from 'node:http'
import { get, type RequestOptions } from 'node:https'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TLSSocket } from 'node:tls'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { transform } from 'esbuild'
import { listen, type Listener } from 'listhen'

function localHttpsRequest(port: number, options: RequestOptions = {}): Promise<{
  status: number | undefined
  body: string
  authorized: boolean
  fingerprint: string | undefined
}> {
  return new Promise((resolve, reject) => {
    const request = get({
      hostname: '127.0.0.1', port, path: '/', agent: false,
      headers: { Connection: 'close' }, rejectUnauthorized: true, ...options
    }, (response) => {
      const socket = response.socket as TLSSocket
      const authorized = socket.authorized
      const fingerprint = socket.getPeerX509Certificate()?.fingerprint256
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('error', reject)
      response.on('end', () => resolve({
        status: response.statusCode,
        body: Buffer.concat(chunks).toString('utf8'),
        authorized,
        fingerprint
      }))
    })
    request.setTimeout(5000, () => request.destroy(new Error('Local HTTPS compatibility request timed out.')))
    request.on('error', reject)
  })
}

test('listhen generates and reuses local HTTPS credentials accepted by an explicitly trusting Node client',
  { timeout: 30000 }, async () => {
    // listhen 1.10.1 generates credentials in memory. Persist any reusable test
    // credentials only in this disposable directory, never the user's cache.
    const cache = mkdtempSync(join(tmpdir(), 'exam-listhen-https-'))
    const certificatePath = join(cache, 'localhost.crt')
    const keyPath = join(cache, 'localhost.key')
    const handler: RequestListener = (_request, response) => {
      response.setHeader('Content-Type', 'text/plain; charset=utf-8')
      response.end('local HTTPS compatibility verified')
    }
    const options = {
      hostname: '127.0.0.1', port: 0, public: false,
      isTest: true, isProd: false, showURL: false,
      open: false, clipboard: false, autoClose: false
    }
    let generated: Listener | undefined
    let cached: Listener | undefined
    try {
      generated = await listen(handler, {
        ...options, https: { domains: ['localhost', '127.0.0.1'], validityDays: 1 }
      })
      assert.equal(generated.address.address, '127.0.0.1')
      assert.ok(generated.address.port > 0)
      assert.ok(generated.https)
      const certificate = new X509Certificate(generated.https.cert)
      assert.equal(certificate.checkIP('127.0.0.1'), '127.0.0.1')
      assert.equal(certificate.checkPrivateKey(createPrivateKey(generated.https.key)), true)
      assert.ok((certificate.publicKey.asymmetricKeyDetails?.modulusLength ?? 0) >= 2048)
      writeFileSync(certificatePath, generated.https.cert, { mode: 0o600 })
      writeFileSync(keyPath, generated.https.key, { mode: 0o600 })

      // The generated issuer is deliberately not added to OS/global trust.
      // A client without this local certificate must still reject the server.
      await assert.rejects(localHttpsRequest(generated.address.port, { ca: [] }), (error: NodeJS.ErrnoException) =>
        ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN',
          'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(error.code ?? ''))

      const trust = {
        ca: readFileSync(certificatePath),
        // listhen exposes its leaf certificate, not the generated CA. Pin that
        // leaf explicitly as the local trust anchor and keep TLS/hostname
        // verification enabled (supported by this project's Node versions).
        allowPartialTrustChain: true
      }
      const first = await localHttpsRequest(generated.address.port, trust)
      assert.equal(first.status, 200)
      assert.equal(first.body, 'local HTTPS compatibility verified')
      assert.equal(first.authorized, true)
      assert.equal(first.fingerprint, certificate.fingerprint256)
      await assert.rejects(localHttpsRequest(generated.address.port, { ...trust, servername: 'wrong.invalid' }),
        { code: 'ERR_TLS_CERT_ALTNAME_INVALID' })

      await generated.close()
      cached = await listen(handler, { ...options, https: { key: keyPath, cert: certificatePath } })
      assert.equal(cached.address.address, '127.0.0.1')
      const second = await localHttpsRequest(cached.address.port, trust)
      assert.equal(second.status, 200)
      assert.equal(second.body, first.body)
      assert.equal(second.authorized, true)
      assert.equal(second.fingerprint, certificate.fingerprint256)
    } finally {
      await cached?.close()
      await generated?.close()
      rmSync(cache, { recursive: true, force: true })
    }
  })

test('the updated esbuild transforms TypeScript into executable CommonJS with a source map', async () => {
  const result = await transform('export const answer: number = [20, 22].reduce((sum, value) => sum + value, 0)', {
    loader: 'ts', format: 'cjs', target: 'es2022', sourcefile: 'dependency-smoke.ts', sourcemap: 'external'
  })
  assert.equal(result.warnings.length, 0)
  const module = { exports: {} as Record<string, unknown> }
  runInNewContext(result.code, { module, exports: module.exports }, { timeout: 1000 })
  assert.equal(module.exports.answer, 42)
  assert.deepEqual(JSON.parse(result.map).sources, ['dependency-smoke.ts'])
})


test('serialize-javascript escapes a closing script fragment at the end of a function and preserves ordinary values', () => {
  const serialize = createRequire(import.meta.url)('serialize-javascript') as
    (value: unknown, options?: { space: number }) => string
  function trailingComment() {}
  trailingComment.toString = () => 'function f(){ return 1 }//</script'
  function trailingHtml() {}
  trailingHtml.toString = () => 'function g(x){ return x } > <img src=x onerror=alert(1)>'
  const output = serialize({ nested: { trailingComment }, trailingHtml }, { space: 2 })
  assert.equal(/<\/script/i.test(output), false)
  assert.ok(output.includes('//\\u003C\\u002Fscript\n'))

  const ordinary = serialize({
    increment: function (value: number) { return value + 1 },
    method(value: number) {
      const increment = (input: number) => input + 1
      return increment(value)
    },
    date: new Date('2026-10-24T00:00:00.000Z'),
    expandedYear: new Date('+010000-01-01T00:00:00.000Z'),
    pattern: /history/gi,
    text: '</script><p>世界史</p>'
  })
  assert.equal(/<\/script/i.test(ordinary), false)
  const restored = runInNewContext('(' + ordinary + ')', {}, { timeout: 1000 })
  assert.equal(restored.increment(41), 42)
  assert.equal(restored.method(41), 42)
  assert.equal(restored.date.toISOString(), '2026-10-24T00:00:00.000Z')
  assert.equal(restored.expandedYear.toISOString(), '+010000-01-01T00:00:00.000Z')
  assert.equal(restored.pattern.source, 'history')
  assert.equal(restored.pattern.flags, 'gi')
  assert.equal(restored.text, '</script><p>世界史</p>')
})
