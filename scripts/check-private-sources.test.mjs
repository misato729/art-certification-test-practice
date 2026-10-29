import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { inspect, isPrivateSource, main } from './check-private-sources.mjs'

const ZERO = '0'.repeat(40)
const write = (path, content = 'Synthetic fixture only; no private source material.\n') => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}
const policyFor = (directories = ['local-only'], prefixes = []) => ({
  schema_version: 1, local_only: { directory_names: directories, filename_prefixes: prefixes },
})

function fixture(t, policy) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'template-private-source-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const git = args => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  })
  git(['init', '--quiet'])
  write(join(root, 'README.md'), '# Synthetic repository\n')
  write(join(root, '.gitignore'), '**/local-only/\n')
  if (policy !== undefined) write(join(root, 'docs/workflow/policy.json'), JSON.stringify(policy) + '\n')
  git(['add', 'README.md', '.gitignore', ...(policy === undefined ? [] : ['docs/workflow/policy.json'])])
  const commit = message => git(['-c', 'user.name=Private Source Test', '-c', 'user.email=private-source-test@example.invalid', 'commit', '--quiet', '-m', message])
  commit('Synthetic public fixture')
  const head = () => git(['rev-parse', 'HEAD']).trim()
  return { root, git, commit, head }
}

function capture(action) {
  const oldLog = console.log, oldError = console.error, output = []
  console.log = (...args) => output.push(args.join(' '))
  console.error = (...args) => output.push(args.join(' '))
  try { return { code: action(), output: output.join('\n') } }
  finally { console.log = oldLog; console.error = oldError }
}

test('generic local-only directories are distinguished from public code and documentation', () => {
  for (const path of ['local-only/reference.pdf', 'nested/local-only/image.png', 'nested/LOCAL-ONLY/notes.txt', 'nested\\local-only\\scan.png']) {
    assert.equal(isPrivateSource(path), true, path)
  }
  for (const path of ['README.md', 'scripts/check-private-sources.mjs', 'docs/local-only-notes.md', 'frontend/public/images/logo.svg', 'content/questions.json']) {
    assert.equal(isPrivateSource(path), false, path)
  }
})

test('custom directory names and filename prefixes can be matched without hard-coded subject names', () => {
  const policy = policyFor(['reference-materials', 'derived-local'], ['source-capture-'])
  for (const path of ['reference-materials/source.pdf', 'nested/derived-local/notes.txt', 'source-capture-01.pdf', 'nested/SOURCE-CAPTURE-backup.zip']) {
    assert.equal(isPrivateSource(path, policy), true, path)
  }
  assert.equal(isPrivateSource('docs/reference-materials-plan.md', policy), false)
  assert.equal(isPrivateSource('docs/source-capture-notes.md', policy), true)
})

test('untracked local-only material is not read or included in a clean repository scan', t => {
  const f = fixture(t)
  const path = 'local-only/reference.pdf'
  write(join(f.root, path))
  const before = readFileSync(join(f.root, path), 'utf8')
  assert.deepEqual(inspect(f.root), { tracked: [], history: [] })
  assert.equal(capture(() => main([], f.root)).code, 0)
  assert.equal(readFileSync(join(f.root, path), 'utf8'), before)
})

test('forced staging cannot bypass source protection despite ignore rules', t => {
  const f = fixture(t)
  const paths = ['local-only/reference.pdf', 'local-only/derived/notes.txt', 'nested/local-only/scan.png']
  for (const path of paths) write(join(f.root, path))
  f.git(['add', '--force', ...paths])
  const result = inspect(f.root)
  assert.deepEqual([...result.tracked].sort(), [...paths].sort())
  assert.deepEqual(result.history, [])
  assert.equal(capture(() => main([], f.root)).code, 1)
})

test('configured directories and prefixes are applied to the actual repository scan', t => {
  const f = fixture(t, policyFor(['reference-materials'], ['source-capture-']))
  const paths = ['reference-materials/source.pdf', 'nested/source-capture-image.png']
  for (const path of paths) write(join(f.root, path))
  f.git(['add', '--force', ...paths])
  assert.deepEqual([...inspect(f.root).tracked].sort(), [...paths].sort())
  const result = capture(() => main([], f.root))
  assert.equal(result.code, 1)
  assert(!result.output.includes('source.pdf'))
  assert(!result.output.includes('source-capture-image.png'))
})

test('committing then deleting a source still fails because earlier history would be uploaded', t => {
  const f = fixture(t)
  const path = 'local-only/reference.pdf'
  write(join(f.root, path))
  f.git(['add', '--force', path]); f.commit('Synthetic source fixture')
  f.git(['rm', path]); f.commit('Remove synthetic source fixture')
  const result = inspect(f.root)
  assert.deepEqual(result.tracked, [])
  assert(result.history.includes(path))
  assert.equal(capture(() => main([], f.root)).code, 1)
})

test('merge-only local sources cannot bypass outgoing history checks by staging their removal', t => {
  const f = fixture(t)
  const base = f.head()
  f.git(['checkout', '--quiet', '-b', 'synthetic-left'])
  write(join(f.root, 'docs/left.txt'))
  f.git(['add', 'docs/left.txt']); f.commit('Synthetic left branch')
  f.git(['checkout', '--quiet', '-b', 'synthetic-right', base])
  write(join(f.root, 'docs/right.txt'))
  f.git(['add', 'docs/right.txt']); f.commit('Synthetic right branch')
  f.git(['checkout', '--quiet', 'synthetic-left'])
  f.git(['-c', 'user.name=Private Source Test', '-c', 'user.email=private-source-test@example.invalid', 'merge', '--quiet', '--no-commit', '--no-ff', 'synthetic-right'])
  const path = 'local-only/merge-only.pdf'
  write(join(f.root, path))
  f.git(['add', '--force', path]); f.commit('Synthetic merge-only source fixture')
  const outgoing = f.head()
  assert.equal(f.git(['rev-list', '--parents', '-n', '1', outgoing]).trim().split(/\s+/).length, 3)
  f.git(['rm', path])
  const result = inspect(f.root, [outgoing])
  assert.deepEqual(result.tracked, [])
  assert(result.history.includes(path))
  const line = `refs/heads/main ${outgoing} refs/heads/main ${ZERO}\n`
  assert.equal(capture(() => main(['--pre-push'], f.root, line)).code, 1)
})

test('outgoing history checks retain protected sources reachable only through a merge second parent', t => {
  const f = fixture(t)
  const base = f.head()
  f.git(['checkout', '--quiet', '-b', 'synthetic-source-branch'])
  const path = 'local-only/second-parent.pdf'
  write(join(f.root, path))
  f.git(['add', '--force', path]); f.commit('Synthetic second-parent source fixture')
  f.git(['rm', path]); f.commit('Remove second-parent source fixture')
  f.git(['checkout', '--quiet', '-b', 'synthetic-public-branch', base])
  write(join(f.root, 'docs/public-branch.txt'))
  f.git(['add', 'docs/public-branch.txt']); f.commit('Synthetic first-parent public branch')
  f.git(['-c', 'user.name=Private Source Test', '-c', 'user.email=private-source-test@example.invalid', 'merge', '--quiet', '--no-commit', '--no-ff', 'synthetic-source-branch'])
  f.commit('Synthetic merge with clean final tree')
  const outgoing = f.head()
  const result = inspect(f.root, [outgoing])
  assert.deepEqual(result.tracked, [])
  assert(result.history.includes(path))
  const line = `refs/heads/main ${outgoing} refs/heads/main ${ZERO}\n`
  assert.equal(capture(() => main(['--pre-push'], f.root, line)).code, 1)
})

test('history checks protected path names even when the blob also exists at a benign path', t => {
  const f = fixture(t)
  const value = 'Identical synthetic fixture; no real source content.\n'
  write(join(f.root, 'docs/synthetic-note.txt'), value)
  f.git(['add', 'docs/synthetic-note.txt']); f.commit('Synthetic public blob')
  write(join(f.root, 'local-only/copied-note.pdf'), value)
  f.git(['add', '--force', 'local-only/copied-note.pdf']); f.commit('Reuse blob under local-only path')
  f.git(['rm', 'local-only/copied-note.pdf']); f.commit('Remove local-only alias')
  assert.deepEqual(inspect(f.root).tracked, [])
  assert(inspect(f.root).history.includes('local-only/copied-note.pdf'))
  assert.equal(capture(() => main([], f.root)).code, 1)
})

test('configured names protect deleted history as well as currently tracked files', t => {
  const f = fixture(t, policyFor(['reference-materials'], ['source-capture-']))
  const path = 'source-capture-private.pdf'
  write(join(f.root, path))
  f.git(['add', path]); f.commit('Synthetic configured source fixture')
  f.git(['rm', path]); f.commit('Remove configured source fixture')
  assert.deepEqual(inspect(f.root).tracked, [])
  assert(inspect(f.root).history.includes(path))
  assert.equal(capture(() => main([], f.root)).code, 1)
})

test('default scanning checks other local refs while explicit revisions stay scoped', t => {
  const f = fixture(t)
  const clean = f.head()
  f.git(['checkout', '--quiet', '-b', 'synthetic-private-branch'])
  write(join(f.root, 'local-only/reference.pdf'))
  f.git(['add', '--force', 'local-only/reference.pdf']); f.commit('Synthetic local-only branch fixture')
  f.git(['checkout', '--quiet', '--detach', clean])
  assert(inspect(f.root).history.includes('local-only/reference.pdf'))
  assert.deepEqual(inspect(f.root, [clean]), { tracked: [], history: [] })
})

test('pre-push examines each outgoing ref history including removed local-only material', t => {
  const f = fixture(t)
  const clean = f.head()
  const path = 'local-only/derived.txt'
  write(join(f.root, path))
  f.git(['add', '--force', path]); f.commit('Synthetic derived fixture')
  f.git(['rm', path]); f.commit('Remove synthetic derived fixture')
  const lines = `refs/heads/public ${clean} refs/heads/public ${ZERO}\nrefs/heads/private ${f.head()} refs/heads/private ${ZERO}\n`
  assert.equal(capture(() => main(['--pre-push'], f.root, lines)).code, 1)
})

test('pre-push accepts public code without requiring local-only files', t => {
  const f = fixture(t)
  write(join(f.root, 'scripts/public-example.mjs'), 'export const synthetic = true\n')
  f.git(['add', 'scripts/public-example.mjs']); f.commit('Synthetic public code')
  const line = `refs/heads/main ${f.head()} refs/heads/main ${ZERO}\n`
  assert.deepEqual(inspect(f.root), { tracked: [], history: [] })
  assert.equal(capture(() => main(['--pre-push'], f.root, line)).code, 0)
})

test('unknown or malformed revisions fail closed instead of reporting an incomplete scan as clean', t => {
  const f = fixture(t)
  const badRef = 'f'.repeat(40)
  const line = `refs/heads/main ${badRef} refs/heads/main ${ZERO}\n`
  assert.equal(capture(() => main(['--pre-push'], f.root, line)).code, 1)
  assert.throws(() => inspect(f.root, ['HEAD']))
  for (const input of ['incomplete metadata', `refs/heads/main invalid refs/heads/main ${ZERO}`, `refs/heads/main ${ZERO} refs/heads/main invalid`]) {
    assert.equal(capture(() => main(['--pre-push'], f.root, input)).code, 1)
  }
})

test('deletion-only pushes still enforce the policy and index without scanning unrelated history', t => {
  const f = fixture(t)
  const line = `refs/heads/main ${ZERO} refs/heads/main ${f.head()}\n`
  assert.equal(capture(() => main(['--pre-push'], f.root, line)).code, 0)
  write(join(f.root, 'local-only/reference.pdf'))
  f.git(['add', '--force', 'local-only/reference.pdf'])
  assert.equal(capture(() => main(['--pre-push'], f.root, line)).code, 1)
})

test('invalid protection configuration fails closed for regular and empty pushes', async t => {
  for (const value of ['{invalid json', JSON.stringify({ schema_version: 99, local_only: { directory_names: ['local-only'], filename_prefixes: [] } })]) {
    await t.test(value.startsWith('{invalid') ? 'invalid_json' : 'unsupported_schema', t => {
      const f = fixture(t)
      write(join(f.root, 'docs/workflow/policy.json'), value)
      assert.throws(() => inspect(f.root))
      assert.equal(capture(() => main([], f.root)).code, 1)
      assert.equal(capture(() => main(['--pre-push'], f.root, '')).code, 1)
    })
  }
})

test('invalid arguments and unavailable Git metadata fail closed without exposing details', t => {
  const f = fixture(t)
  for (const args of [['--unsupported'], ['--pre-push', '--pre-push']]) assert.equal(capture(() => main(args, f.root)).code, 1)
  const missing = mkdtempSync(join(realpathSync(tmpdir()), 'template-no-git-test-'))
  t.after(() => rmSync(missing, { recursive: true, force: true }))
  const result = capture(() => main([], missing))
  assert.equal(result.code, 1)
  assert(!result.output.includes(missing))
})
