import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { createCheckpoint, fingerprints, freshness, gitSnapshot, main, readState, runnableTasks, sourcePath } from './context.mjs'

const encoded = value => JSON.stringify(value, null, 2) + '\n'
const write = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, value) }

function fixture(t) {
  const temporary = mkdtempSync(join(realpathSync(tmpdir()), 'workflow-context-test-'))
  t.after(() => rmSync(temporary, { recursive: true, force: true }))
  const repo = join(temporary, 'repo'), workspace = repo
  const path = join(repo, 'docs/workflow/state.json')
  const history = join(repo, 'docs/workflow/handoffs')
  const lock = join(repo, 'docs/workflow/.context.lock')
  write(join(workspace, 'AGENTS.md'), '# Synthetic workspace rules\n')
  write(join(repo, 'docs/workflow/contexts/service.md'), '# Service context\n')
  write(join(repo, 'docs/workflow/contexts/sources.md'), '# Sources context\n')
  write(join(repo, 'evidence.md'), 'Synthetic evidence, no application data.\n')
  mkdirSync(history, { recursive: true })
  const task = (id, fields = {}) => ({
    id, context: 'service', title: id, status: 'todo', authorization: 'requested', request_ref: 'Synthetic user request',
    depends_on: [], next_action: 'Inspect synthetic evidence', evidence: [], last_verified_at: null, verification_scope: 'Unit-test fixture only', ...fields,
  })
  const state = {
    schema_version: 1, revision: 0, updated_at: '2026-10-26T00:00:00Z', workspace_relative_to_repo: '.', active_context: 'service', last_checkpoint: null,
    contexts: [{ id: 'service', title: 'Service', card: 'docs/workflow/contexts/service.md' }, { id: 'sources', title: 'Sources', card: 'docs/workflow/contexts/sources.md' }],
    watch_files: ['AGENTS.md', 'evidence.md'],
    tasks: [
      task('finished', { status: 'done', evidence: ['evidence.md'], last_verified_at: '2026-10-26' }),
      task('ready', { depends_on: ['finished'] }),
      task('material', { context: 'sources', status: 'waiting_for_material' }),
      task('dependent', { context: 'sources', depends_on: ['material'] }),
      task('unrequested', { status: 'waiting_for_request', authorization: 'not_requested', request_ref: null }),
    ],
  }
  const save = () => write(path, encoded(state))
  save()
  const git = args => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  git(['init', '--quiet'])
  git(['add', '.'])
  git(['-c', 'user.name=Context Unit Test', '-c', 'user.email=context-test@example.invalid', 'commit', '--quiet', '-m', 'Synthetic fixture'])
  const checkpoint = (fields = {}) => createCheckpoint(repo, {
    context: 'service', expectedRevision: readState(repo).state.revision,
    summary: 'Synthetic progress checkpoint', next: 'Continue synthetic test', ...fields,
  })
  return { temporary, workspace, repo, path, history, lock, task, state, save, git, checkpoint }
}

function capture(action) {
  const original = console.log, output = []
  console.log = (...values) => output.push(values.join(' '))
  try { return { result: action(), output: output.join('\n') } } finally { console.log = original }
}

function gatedFixture(t, { max = 3, passed = false } = {}) {
  const f = fixture(t)
  f.state.gate_policy = { version: 1, legacy_task_ids: f.state.tasks.map(task => task.id) }
  const checked_at = passed ? '2026-10-27T00:00:00Z' : null
  const status = passed ? 'passed' : 'pending'
  const task = f.task('gated', {
    acceptance: [
      { id: 'checks', kind: 'automated', description: 'Synthetic checks', verification: 'Check synthetic fixture', status, evidence: passed ? ['evidence.md'] : [], checked_at },
      { id: 'review', kind: 'review', description: 'Independent review', verification: 'Review fixture', status, evidence: passed ? ['evidence.md'] : [], checked_at, reviewer: passed ? 'synthetic_reviewer' : null },
    ],
    execution: { worker: 'synthetic_worker', max_attempts: max, attempts: [] },
  })
  f.state.tasks.push(task); f.save()
  const attempt = outcome => main(['attempt', '--context', 'service', '--task', 'gated', '--outcome', outcome, '--expect-revision', String(readState(f.repo).state.revision), '--summary', 'Synthetic evaluation', '--next', 'Continue synthetic work'], f.repo)
  return { ...f, gated: task, attempt }
}

test('gate and graph are read-only, and legacy is distinct from passed', t => {
  const f = gatedFixture(t)
  const before = readFileSync(f.path, 'utf8')
  const gate = capture(() => main(['gate', '--task', 'gated'], f.repo))
  assert.equal(gate.result, 2)
  assert.equal(JSON.parse(gate.output).decision, 'pending')
  assert.equal(capture(() => main(['gate', '--task', 'finished'], f.repo)).result, 2)
  const graph = JSON.parse(capture(() => main(['graph', '--format', 'json'], f.repo)).output)
  assert(graph.edges.some(edge => edge.from === 'finished' && edge.to === 'ready'))
  assert.match(capture(() => main(['graph'], f.repo)).output, /^flowchart TD/)
  assert.equal(readFileSync(f.path, 'utf8'), before)
  assert.deepEqual(readdirSync(f.history), [])
})

test('failed gate cannot create passed attempt or done checkpoint', t => {
  const f = gatedFixture(t)
  const before = readFileSync(f.path, 'utf8')
  assert.throws(() => f.attempt('passed'), /完了条件/)
  assert.throws(() => f.checkpoint({ task: 'gated', status: 'done' }), /根拠|完了条件/)
  assert.equal(readFileSync(f.path, 'utf8'), before)
  assert.deepEqual(readdirSync(f.history), [])
  assert(!existsSync(f.lock))
})

test('passing attempt and completion use revisioned immutable checkpoints', t => {
  const f = gatedFixture(t, { passed: true })
  capture(() => f.attempt('passed'))
  const evaluated = readState(f.repo).state
  assert.equal(evaluated.revision, 1)
  assert.equal(evaluated.tasks.at(-1).status, 'doing')
  assert.equal(evaluated.tasks.at(-1).execution.attempts.length, 1)
  assert.equal(capture(() => main(['gate', '--task', 'gated'], f.repo)).result, 0)
  const saved = JSON.parse(readFileSync(f.path, 'utf8'))
  saved.tasks.at(-1).evidence = ['evidence.md']
  saved.tasks.at(-1).last_verified_at = '2026-10-27'
  write(f.path, encoded(saved))
  f.checkpoint({ task: 'gated', status: 'done' })
  assert.equal(readState(f.repo).state.tasks.at(-1).status, 'done')
  assert.equal(readdirSync(f.history).length, 2)
  const attemptRecord = readdirSync(f.history).map(path => JSON.parse(readFileSync(join(f.history, path), 'utf8'))).find(record => record.attempt)
  assert.deepEqual(attemptRecord.attempt, { outcome: 'passed', number: 1 })
})

test('attempt limit survives status edits and removes task from next candidates', t => {
  const f = gatedFixture(t, { max: 1 })
  capture(() => f.attempt('failed'))
  const current = JSON.parse(readFileSync(f.path, 'utf8'))
  assert.equal(current.tasks.at(-1).status, 'needs_review')
  assert(!runnableTasks(current).some(task => task.id === 'gated'))
  current.tasks.at(-1).status = 'doing'; write(f.path, encoded(current))
  assert(!runnableTasks(readState(f.repo).state).some(task => task.id === 'gated'))
  assert.throws(() => f.checkpoint({ task: 'gated', status: 'doing' }), /上限/)
  assert.throws(() => f.attempt('failed'), /上限/)
  assert.equal(readState(f.repo).state.tasks.at(-1).execution.attempts.length, 1)
})

test('unavailable local evidence keeps history readable without certifying current completion', t => {
  const f = gatedFixture(t, { passed: true })
  f.gated.status = 'done'; f.gated.evidence = ['evidence.md']; f.gated.last_verified_at = '2026-10-27'
  f.gated.execution.attempts.push({ number: 1, outcome: 'passed', summary: 'Synthetic passing evaluation', at: '2026-10-27', failed_criteria: [] })
  f.gated.acceptance[0].evidence = ['local-only/references/absent.pdf']; f.save()
  assert.deepEqual(readState(f.repo).missing_local_files, ['local-only/references/absent.pdf'])
  assert.equal(capture(() => main(['gate', '--task', 'gated'], f.repo)).result, 2)
  const status = JSON.parse(capture(() => main(['status', '--json'], f.repo)).output)
  assert(status.runnable.some(task => task.id === 'ready'))
  assert.equal(capture(() => main(['start', 'sources'], f.repo)).result, 0)
  assert.throws(() => f.checkpoint({ task: 'gated', status: 'done' }), /根拠|完了条件/)
  f.gated.acceptance[0].evidence = ['evidence.md']; f.gated.depends_on = ['material']; f.save()
  assert.throws(() => readState(f.repo), /完了ゲート/)
  f.gated.depends_on = []; f.gated.acceptance[0].evidence = ['../outside.md']; f.save()
  assert.throws(() => readState(f.repo), /パス/)
})

test('next excludes exhausted tasks with vanished local evidence but retains independent work', t => {
  const f = gatedFixture(t, { max: 1, passed: true })
  f.gated.execution.attempts.push({ number: 1, outcome: 'passed', summary: 'Synthetic evaluation', at: '2026-10-27', failed_criteria: [] })
  f.gated.acceptance[0].evidence = ['local-only/references/absent.pdf']; f.save()
  const status = JSON.parse(capture(() => main(['next', '--json'], f.repo)).output)
  assert(!status.runnable.some(task => task.id === 'gated'))
  assert(status.runnable.some(task => task.id === 'ready'))
  assert.equal(status.contexts.flatMap(context => context.tasks).find(task => task.id === 'gated').decision, 'exhausted')
})

test('attempt-specific options cannot be silently used by other commands', t => {
  const f = gatedFixture(t)
  assert.throws(() => main(['checkpoint', '--outcome', 'failed'], f.repo), /専用/)
  assert.throws(() => main(['attempt', '--task', 'gated'], f.repo), /outcome/)
  assert.throws(() => main(['status', '--format', 'json'], f.repo), /専用/)
  assert.throws(() => main(['graph', '--format', 'invalid'], f.repo), /format/)
})

test('task selection respects requests, completed dependencies and context priority', t => {
  const f = fixture(t)
  f.state.tasks.push(f.task('other_ready', { context: 'sources' }))
  f.save()
  const loaded = readState(f.repo).state
  assert.deepEqual(runnableTasks(loaded).map(task => task.id), ['ready', 'other_ready'])
  assert.deepEqual(runnableTasks(loaded, 'sources').map(task => task.id), ['other_ready', 'ready'])
  assert(!runnableTasks(loaded).some(task => ['material', 'dependent', 'unrequested', 'finished'].includes(task.id)))
  const incomplete = structuredClone(loaded)
  incomplete.tasks.find(task => task.id === 'finished').status = 'todo'
  assert(!runnableTasks(incomplete).some(task => task.id === 'ready'))
})

test('invalid IDs, unknown dependencies, cycles and unrequested active work are rejected', async t => {
  const mutations = {
    duplicate: state => { state.tasks.push(structuredClone(state.tasks[0])) },
    unknown: state => { state.tasks[1].depends_on = ['missing_task'] },
    self: state => { state.tasks[1].depends_on = ['ready'] },
    cycle: state => { state.tasks[1].depends_on = ['dependent']; state.tasks[3].depends_on = ['ready'] },
    unrequested: state => { state.tasks[4].status = 'doing' },
    unsupported_status: state => { state.tasks[1].status = 'invented' },
    missing_request: state => { state.tasks[1].request_ref = null },
    unsupported_context: state => { state.tasks[1].context = 'missing' },
    unsupported_workspace: state => { state.workspace_relative_to_repo = '../..' },
  }
  for (const [name, mutate] of Object.entries(mutations)) await t.test(name, t => {
    const f = fixture(t); mutate(f.state); f.save()
    assert.throws(() => readState(f.repo))
  })
})

test('completed tasks require independent existing evidence and a verification date', async t => {
  for (const kind of ['no_evidence', 'missing_file', 'no_date']) await t.test(kind, t => {
    const f = fixture(t)
    if (kind === 'no_evidence') f.state.tasks[0].evidence = []
    if (kind === 'missing_file') f.state.tasks[0].evidence = ['missing.md']
    if (kind === 'no_date') f.state.tasks[0].last_verified_at = null
    f.save(); assert.throws(() => readState(f.repo))
  })
})

test('source paths reject traversal, private targets and symlink aliases for secrets', t => {
  const f = fixture(t)
  const outside = join(f.temporary, 'outside.md')
  write(outside, 'Synthetic external fixture\n')
  write(join(f.workspace, '.env'), 'SYNTHETIC_TEST_VALUE=not-a-real-credential\n')
  write(join(f.workspace, 'private/internal.md'), 'Synthetic private fixture\n')
  for (const extension of ['key', 'pem']) {
    write(join(f.workspace, `synthetic-secret.${extension}`), 'Synthetic secret-extension fixture\n')
    symlinkSync(join(f.workspace, `synthetic-secret.${extension}`), join(f.repo, `${extension}-alias.md`))
  }
  symlinkSync(outside, join(f.repo, 'outside-link.md'))
  symlinkSync(join(f.workspace, '.env'), join(f.repo, 'env-alias.md'))
  symlinkSync(join(f.workspace, 'private/internal.md'), join(f.repo, 'private-alias.md'))
  for (const path of ['../outside.md', '/absolute.md', 'repo/../evidence.md', '.env', 'repo\\evidence.md', 'private/internal.md', 'outside-link.md', 'env-alias.md', 'private-alias.md', 'key-alias.md', 'pem-alias.md']) {
    assert.throws(() => sourcePath(f.workspace, path), path)
  }
  assert.equal(sourcePath(f.workspace, 'evidence.md'), join(f.repo, 'evidence.md'))
})

test('context cards must be short Markdown and respect the exact 64KiB boundary', t => {
  const f = fixture(t)
  f.state.contexts[0].card = 'docs/workflow/contexts/service.json'
  write(join(f.repo, f.state.contexts[0].card), '{}\n')
  f.save()
  assert.throws(() => readState(f.repo), /拡張子/)
  f.state.contexts[0].card = 'docs/workflow/contexts/service.md'
  write(join(f.repo, f.state.contexts[0].card), 'x'.repeat(64 * 1024))
  f.save()
  assert.doesNotThrow(() => readState(f.repo))
  write(join(f.repo, f.state.contexts[0].card), 'x'.repeat(64 * 1024 + 1))
  assert.throws(() => readState(f.repo), /64KiB/)
})

test('fingerprinting remains bounded to small supported source files', t => {
  const f = fixture(t)
  assert.match(fingerprints(f.workspace, ['evidence.md'])['evidence.md'], /^[a-f0-9]{64}$/)
  write(join(f.repo, 'oversized.md'), 'x'.repeat(1024 * 1024 + 1))
  f.state.watch_files = ['oversized.md']; f.save()
  assert.throws(() => readState(f.repo), /1MiB/)
  write(join(f.repo, 'document.pdf'), 'Synthetic fixture, not a real PDF')
  f.state.watch_files = ['document.pdf']; f.save()
  assert.throws(() => readState(f.repo), /小さな文書/)
})

test('checkpoints increment revision and preserve immutable history without collecting evidence contents', t => {
  const f = fixture(t)
  const first = f.checkpoint({ task: 'ready', status: 'doing' })
  assert.equal(first.revision, 1)
  const firstBytes = readFileSync(join(f.repo, first.path), 'utf8')
  const record = JSON.parse(firstBytes)
  assert.equal(record.timezone, 'UTC')
  const current = readState(f.repo).state
  assert.equal(current.revision, 1)
  assert.equal(current.last_checkpoint, first.path)
  assert.equal(current.tasks.find(task => task.id === 'ready').status, 'doing')
  assert.equal(record.git.head, f.git(['rev-parse', 'HEAD']).trim())
  assert.match(record.file_hashes['evidence.md'], /^[a-f0-9]{64}$/)
  assert(!firstBytes.includes('Synthetic evidence, no application data.'))
  assert(!firstBytes.includes(f.workspace))
  assert(!existsSync(f.lock))
  const second = f.checkpoint()
  assert.equal(second.revision, 2)
  assert.notEqual(second.path, first.path)
  assert.equal(readFileSync(join(f.repo, first.path), 'utf8'), firstBytes)
  assert.equal(readdirSync(f.history).length, 2)
  const fresh = freshness(f.repo)
  assert.deepEqual(fresh.changed_files, [])
  assert.equal(fresh.git_changed, false)
  assert.equal(fresh.state_changed, false)
})

test('stale revisions, failed updates and concurrent locks never replace the last saved state', t => {
  const f = fixture(t)
  f.checkpoint()
  const before = readFileSync(f.path, 'utf8'), snapshots = readdirSync(f.history)
  assert.throws(() => f.checkpoint({ expectedRevision: 0 }), /状態が更新/)
  assert.equal(readFileSync(f.path, 'utf8'), before)
  assert.deepEqual(readdirSync(f.history), snapshots)
  assert(!existsSync(f.lock))
  assert.throws(() => f.checkpoint({ task: 'unrequested', status: 'doing' }), /未依頼/)
  assert.equal(readFileSync(f.path, 'utf8'), before)
  assert(!existsSync(f.lock))
  assert.throws(() => f.checkpoint({ task: 'ready', status: 'done' }), /根拠/)
  assert(!existsSync(f.lock))
  mkdirSync(f.lock)
  assert.throws(() => f.checkpoint(), /ロック/)
  assert(existsSync(f.lock), 'another writer owns the lock')
  assert.equal(readFileSync(f.path, 'utf8'), before)
  assert.deepEqual(readdirSync(f.history), snapshots)
})

test('freshness notices content edits even when an already-dirty Git path stays identical', t => {
  const f = fixture(t)
  write(join(f.repo, 'evidence.md'), 'First synthetic local edit\n')
  f.checkpoint()
  const previousGit = gitSnapshot(f.repo)
  write(join(f.repo, 'evidence.md'), 'Second synthetic local edit\n')
  assert.deepEqual(gitSnapshot(f.repo), previousGit)
  const fresh = freshness(f.repo)
  assert.equal(fresh.git_changed, false)
  assert.deepEqual(fresh.changed_files, ['evidence.md'])
  assert.equal(capture(() => main(['check', '--strict'], f.repo)).result, 2)
})

test('freshness detects unstamped state edits and new Git changes independently', t => {
  const f = fixture(t)
  f.checkpoint()
  const current = JSON.parse(readFileSync(f.path, 'utf8'))
  current.tasks[1].next_action = 'Changed synthetic next step'
  write(f.path, encoded(current))
  let fresh = freshness(f.repo)
  assert.equal(fresh.state_changed, true)
  assert.deepEqual(fresh.changed_files, [])
  assert.equal(fresh.git_changed, false)
  assert.equal(capture(() => main(['check', '--strict', '--json'], f.repo)).result, 2)
  f.checkpoint()
  write(join(f.repo, 'new-file.md'), 'New synthetic file\n')
  fresh = freshness(f.repo)
  assert.equal(fresh.git_changed, true)
  assert.equal(fresh.state_changed, false)
})

test('status, start, next and check are read-only and never manufacture a verified baseline', t => {
  const f = fixture(t)
  const before = readFileSync(f.path, 'utf8')
  assert.equal(freshness(f.repo).baseline, false)
  assert.equal(capture(() => main(['check', '--strict'], f.repo)).result, 2)
  for (const argv of [['status'], ['start', 'service'], ['next'], ['check'], ['status', '--json']]) {
    const outcome = capture(() => main(argv, f.repo))
    assert.equal(outcome.result, 0)
    assert.equal(readFileSync(f.path, 'utf8'), before)
    assert.deepEqual(readdirSync(f.history), [])
    assert(!existsSync(f.lock))
    if (argv.includes('--json')) assert.equal(JSON.parse(outcome.output).revision, 0)
  }
  f.checkpoint()
  const updated = readFileSync(f.path, 'utf8'), snapshots = readdirSync(f.history)
  assert.equal(capture(() => main(['check', '--strict'], f.repo)).result, 0)
  assert.equal(readFileSync(f.path, 'utf8'), updated)
  assert.deepEqual(readdirSync(f.history), snapshots)
})

test('Git snapshot handles renamed paths with spaces and Unicode without storing file contents', t => {
  const f = fixture(t)
  write(join(f.repo, 'old name.md'), 'Synthetic rename payload\n')
  f.git(['add', 'old name.md'])
  f.git(['-c', 'user.name=Context Unit Test', '-c', 'user.email=context-test@example.invalid', 'commit', '--quiet', '-m', 'Synthetic rename base'])
  f.git(['mv', 'old name.md', '新しい name.md'])
  const snapshot = gitSnapshot(f.repo)
  assert.deepEqual(snapshot.changes, [{ status: 'R ', path: '新しい name.md', from: 'old name.md' }])
  assert(!JSON.stringify(snapshot).includes('Synthetic rename payload'))
})

test('repository is the sole workspace and the former parent-root setting is rejected', t => {
  const f = fixture(t)
  assert.equal(readState(f.repo).workspace, realpathSync(f.repo))
  f.state.workspace_relative_to_repo = '..'
  f.save()
  assert.throws(() => readState(f.repo), /このリポジトリ/)
  assert.throws(() => sourcePath(f.repo, '../personal.md', { allowMissingLocal: true }), /相対パス/)
})

test('missing local-only references warn without blocking independent service work', t => {
  const f = fixture(t)
  f.state.watch_files.push('local-only/analysis/summary.md')
  f.state.tasks[0].evidence.push('local-only/analysis/summary.md', 'local-only/references/unavailable.pdf', 'local-only/catalog.pdf')
  f.save()
  const loaded = readState(f.repo)
  assert.deepEqual(loaded.missing_local_files, ['local-only/analysis/summary.md', 'local-only/references/unavailable.pdf', 'local-only/catalog.pdf'])
  assert.deepEqual(runnableTasks(loaded.state).map(task => task.id), ['ready'])
  assert.equal(fingerprints(f.repo, ['local-only/analysis/summary.md'])['local-only/analysis/summary.md'], null)
  const ordinary = capture(() => main(['start', 'service'], f.repo))
  assert.equal(ordinary.result, 0)
  assert.match(ordinary.output, /未配置/)
  f.checkpoint()
  const fresh = freshness(f.repo)
  assert.deepEqual(fresh.changed_files, ['local-only/analysis/summary.md'])
  assert.equal(capture(() => main(['check', '--strict'], f.repo)).result, 2)
  write(join(f.repo, 'local-only/analysis/summary.md'), 'Synthetic local-only evidence\n')
  assert.match(fingerprints(f.repo, ['local-only/analysis/summary.md'])['local-only/analysis/summary.md'], /^[a-f0-9]{64}$/)
  assert.deepEqual(freshness(f.repo).changed_files, ['local-only/analysis/summary.md'])
})

test('missing ordinary files and private aliases do not become optional evidence', t => {
  const f = fixture(t)
  for (const path of ['missing.md', '../local-only/missing.md', '.env', 'local-only/../missing.md']) {
    assert.throws(() => sourcePath(f.repo, path, { allowMissingLocal: true }), path)
  }
  mkdirSync(join(f.repo, 'local-only'))
  symlinkSync(f.temporary, join(f.repo, 'local-only/outside'))
  assert.throws(() => sourcePath(f.repo, 'local-only/outside/missing.md', { allowMissingLocal: true }), /リポジトリ外/)
  symlinkSync(join(f.temporary, 'not-existing'), join(f.repo, 'local-only/dangling'))
  assert.throws(() => sourcePath(f.repo, 'local-only/dangling/missing.md', { allowMissingLocal: true }), /シンボリックリンク/)
  assert.throws(() => sourcePath(f.repo, 'local-only/private/missing.md', { allowMissingLocal: true }), /非公開/)
  f.state.watch_files.push('managed-missing.md'); f.save()
  assert.throws(() => readState(f.repo), /見つかりません/)
})

test('legacy immutable checkpoint paths are compared as metadata without parent file access', t => {
  const f = fixture(t)
  const result = f.checkpoint()
  const path = join(f.repo, result.path)
  const checkpoint = JSON.parse(readFileSync(path, 'utf8'))
  checkpoint.file_hashes = { 'old-parent/project/evidence.md': '0'.repeat(64) }
  write(path, encoded(checkpoint))
  const bytes = readFileSync(path, 'utf8')
  assert.deepEqual(freshness(f.repo).changed_files.sort(), ['AGENTS.md', 'evidence.md', 'old-parent/project/evidence.md'].sort())
  assert.equal(readFileSync(path, 'utf8'), bytes)
})


test('only three public safeguard metadata paths may be watched and secret aliases remain rejected', t => {
  const f = fixture(t)
  const metadata = ['.gitignore', '.dockerignore', '.githooks/pre-push']
  for (const path of metadata) {
    write(join(f.repo, path), '# Synthetic safeguard metadata\n')
    assert.equal(sourcePath(f.repo, path), join(f.repo, path))
  }
  f.state.watch_files.push(...metadata)
  f.save()
  assert.doesNotThrow(() => readState(f.repo))
  for (const value of Object.values(fingerprints(f.repo, metadata))) assert.match(value, /^[a-f0-9]{64}$/)
  for (const path of ['.env', '.git/config', '.githooks/other-hook', 'nested/.gitignore', '.other']) {
    write(join(f.repo, path), 'Synthetic private metadata fixture\n')
    assert.throws(() => sourcePath(f.repo, path), path)
  }
  rmSync(join(f.repo, '.gitignore'))
  symlinkSync(join(f.repo, '.env'), join(f.repo, '.gitignore'))
  assert.throws(() => sourcePath(f.repo, '.gitignore'), /非公開/)
  assert.throws(() => readState(f.repo), /非公開/)
})


test('configured local-only directories and filename prefixes permit absent evidence', t => {
  const f = fixture(t)
  write(join(f.repo, 'docs/workflow/policy.json'), encoded({
    schema_version: 1,
    local_only: { directory_names: ['offline-reference'], filename_prefixes: ['local-catalog-'] },
  }))
  const paths = ['offline-reference/summary.md', 'nested/offline-reference/document.pdf', 'local-catalog-source.pdf']
  for (const path of paths) assert.equal(sourcePath(f.repo, path, { allowMissingLocal: true }), null)
  f.state.tasks[0].evidence.push(...paths)
  f.state.watch_files.push('docs/workflow/policy.json')
  f.save()
  assert.deepEqual(readState(f.repo).missing_local_files, paths)
  assert.throws(() => sourcePath(f.repo, 'ordinary-missing.pdf', { allowMissingLocal: true }), /見つかりません/)
})

test('invalid workspace policy fails even for ordinary existing evidence', t => {
  const f = fixture(t)
  write(join(f.repo, 'docs/workflow/policy.json'), encoded({ schema_version: 2 }))
  assert.throws(() => sourcePath(f.repo, 'evidence.md'))
  assert.throws(() => readState(f.repo))
})

test('normal operations source directories remain available as evidence', t => {
  const f = fixture(t)
  const path = 'frontend/server/operations/task.ts'
  write(join(f.repo, path), '// Synthetic operations source fixture\n')
  assert.equal(sourcePath(f.repo, path), join(f.repo, path))
  f.state.watch_files.push(path)
  f.save()
  assert.doesNotThrow(() => readState(f.repo))
})


test('checkpoint rejects an external handoff directory before creating any output', t => {
  const f = fixture(t)
  const outside = join(f.temporary, 'outside-handoffs')
  mkdirSync(outside)
  rmSync(f.history, { recursive: true })
  symlinkSync(outside, f.history)
  assert.doesNotThrow(() => readState(f.repo))
  const before = readFileSync(f.path, 'utf8')
  assert.throws(() => createCheckpoint(f.repo, {
    context: 'service', expectedRevision: 0, summary: 'Synthetic checkpoint', next: 'Continue',
  }), /リポジトリ外/)
  assert.deepEqual(readdirSync(outside), [])
  assert.equal(readFileSync(f.path, 'utf8'), before)
  assert(!existsSync(f.lock))
})

test('checkpoint rejects an external workflow directory before creating its lock', t => {
  const f = fixture(t)
  const workflow = join(f.repo, 'docs/workflow')
  const outside = join(f.temporary, 'outside-workflow')
  renameSync(workflow, outside)
  symlinkSync(outside, workflow)
  const before = readFileSync(f.path, 'utf8')
  const entries = readdirSync(outside)
  assert.throws(() => createCheckpoint(f.repo, {
    context: 'service', expectedRevision: 0, summary: 'Synthetic checkpoint', next: 'Continue',
  }), /リポジトリ外/)
  assert.deepEqual(readdirSync(outside), entries)
  assert.deepEqual(readdirSync(join(outside, 'handoffs')), [])
  assert.equal(readFileSync(f.path, 'utf8'), before)
  assert(!existsSync(join(outside, '.context.lock')))
})
