import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { DEFAULT_WORKSPACE_POLICY, WORKSPACE_POLICY_PATH, isLocalOnlyPath, loadWorkspacePolicy, validateWorkspacePolicy } from './workspace-policy.mjs'

const fixture = t => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'template-workspace-policy-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const repo = join(directory, 'repo')
  mkdirSync(repo)
  const path = join(repo, WORKSPACE_POLICY_PATH)
  const save = value => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value)) }
  return { directory, repo, path, save }
}

test('the default policy is generic, case-insensitive, and independent per checkout', t => {
  const f = fixture(t)
  const policy = loadWorkspacePolicy(f.repo)
  assert.deepEqual(policy, DEFAULT_WORKSPACE_POLICY)
  for (const path of ['local-only/source.pdf', 'nested/LOCAL-ONLY/scan.png', 'nested\\local-only\\ocr.txt']) assert(isLocalOnlyPath(path, policy))
  for (const path of ['docs/local-only-materials.md', 'docs/verification.md', 'content/questions.json', 'frontend/server/operations/cli.ts']) assert(!isLocalOnlyPath(path, policy))
  policy.local_only.directory_names.length = 0
  assert.deepEqual(loadWorkspacePolicy(f.repo), DEFAULT_WORKSPACE_POLICY)
  assert.equal(isLocalOnlyPath(null), false)
})

test('custom literal directory names and filename prefixes apply at any depth', t => {
  const f = fixture(t)
  const policy = { schema_version: 1, local_only: { directory_names: ['restricted-materials'], filename_prefixes: ['reference-'] } }
  f.save(policy)
  const actual = loadWorkspacePolicy(f.repo)
  assert.deepEqual(actual, policy)
  for (const path of ['restricted-materials/source.pdf', 'nested/restricted-materials/ocr.md', 'nested/REFERENCE-book.pdf']) assert(isLocalOnlyPath(path, actual))
  assert(!isLocalOnlyPath('docs/restricted-materials-guide.md', actual))
  assert(!isLocalOnlyPath('reference-directory/public.md', actual))
  assert(!isLocalOnlyPath('local-only/file.pdf', actual))
})

test('invalid policy cannot silently remove protection', async t => {
  const base = () => structuredClone(DEFAULT_WORKSPACE_POLICY)
  const cases = {
    version: value => { value.schema_version = 2 },
    extra_key: value => { value.run = 'never executed' },
    nested_extra: value => { value.local_only.command = 'never executed' },
    empty: value => { value.local_only.directory_names = [] },
    array_type: value => { value.local_only.directory_names = 'local-only' },
    duplicate: value => { value.local_only.directory_names.push('LOCAL-ONLY') },
    traversal: value => { value.local_only.directory_names = ['../outside'] },
    absolute: value => { value.local_only.filename_prefixes = ['/outside'] },
    wildcard: value => { value.local_only.filename_prefixes = ['reference-*'] },
    dot: value => { value.local_only.directory_names = ['..'] },
    whitespace: value => { value.local_only.directory_names = [' '] },
    too_many: value => { value.local_only.directory_names = Array.from({ length: 33 }, (_, i) => `item-${i}`) },
  }
  for (const [name, change] of Object.entries(cases)) await t.test(name, t => {
    const f = fixture(t), policy = base(); change(policy); f.save(policy)
    assert.throws(() => validateWorkspacePolicy(policy))
    assert.throws(() => loadWorkspacePolicy(f.repo))
  })
})

test('malformed JSON errors never disclose file contents', t => {
  const f = fixture(t); f.save(DEFAULT_WORKSPACE_POLICY)
  writeFileSync(f.path, 'synthetic-private-value-not-valid-json')
  assert.throws(() => loadWorkspacePolicy(f.repo), error => !error.message.includes('synthetic-private-value'))
  assert.equal(readFileSync(f.path, 'utf8'), 'synthetic-private-value-not-valid-json')
})

test('policy aliases, outside parents, dangling links, and oversized files are rejected', async t => {
  for (const kind of ['file_link', 'outside_parent', 'dangling', 'oversized']) await t.test(kind, t => {
    const f = fixture(t)
    const outside = join(f.directory, 'outside.json')
    writeFileSync(outside, JSON.stringify(DEFAULT_WORKSPACE_POLICY))
    if (kind === 'outside_parent') {
      symlinkSync(f.directory, join(f.repo, 'docs'))
    } else {
      mkdirSync(dirname(f.path), { recursive: true })
      if (kind === 'file_link') symlinkSync(outside, f.path)
      if (kind === 'dangling') symlinkSync(join(f.directory, 'absent.json'), f.path)
      if (kind === 'oversized') writeFileSync(f.path, ' '.repeat(64 * 1024 + 1))
    }
    assert.throws(() => loadWorkspacePolicy(f.repo))
  })
})
