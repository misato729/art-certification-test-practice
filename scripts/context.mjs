#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GateError, evaluateTask, recordAttempt, renderMermaid, taskGraph, validateWorkflow } from './workflow-policy.mjs'
import { isLocalOnlyPath, loadWorkspacePolicy } from './workspace-policy.mjs'

export const DEFAULT_REPO = fileURLToPath(new URL('../', import.meta.url))
const STATE_PATH = 'docs/workflow/state.json'
const HISTORY_PATH = 'docs/workflow/handoffs'
const STATUSES = ['todo', 'doing', 'waiting_for_material', 'waiting_for_request', 'needs_review', 'done']
const hash = value => createHash('sha256').update(value).digest('hex')
export class WorkflowError extends Error {}
const required = (condition, message) => { if (!condition) throw new WorkflowError(message) }
const inside = (base, path) => { const rel = relative(base, path); return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)) }
const managed = path => path === STATE_PATH || path.startsWith(`${HISTORY_PATH}/`) || path.includes('/.context.lock') || /state\.json\.\d+\.tmp$/.test(path)

const PUBLIC_METADATA = new Set(['.gitignore', '.dockerignore', '.githooks/pre-push'])
const restrictedPath = path => !PUBLIC_METADATA.has(path) && path.split('/').some(part => part.startsWith('.') || ['node_modules', 'private', 'secrets'].includes(part))

/** Resolve only repository files; local-only evidence may be absent in a fresh checkout. */
export function sourcePath(workspace, path, { allowMissingLocal = false } = {}) {
  required(typeof path === 'string' && path.length > 0 && !isAbsolute(path) && !path.includes('\\') && !path.split('/').includes('..'), '根拠のパスはリポジトリ基準の相対パスにしてください')
  required(!restrictedPath(path), '非公開・内部データは根拠一覧へ登録できません')
  required(!/\.(pem|key|p12|pfx|sqlite|db)$/i.test(path), '秘密情報・DBファイルは根拠一覧へ登録できません')
  const root = realpathSync(workspace)
  const workspacePolicy = loadWorkspacePolicy(root)
  const full = resolve(root, path)
  required(inside(root, full), 'リポジトリ外のパスは参照しません')
  let existing = full
  while (!existsSync(existing)) {
    required(!lstatSync(existing, { throwIfNoEntry: false })?.isSymbolicLink(), '参照先がないシンボリックリンクは参照しません')
    const parent = dirname(existing)
    required(parent !== existing && inside(root, parent), 'リポジトリ外のパスは参照しません')
    existing = parent
  }
  const real = realpathSync(existing)
  required(inside(root, real), 'リポジトリ外のシンボリックリンクは参照しません')
  required(!/\.(pem|key|p12|pfx|sqlite|db)$/i.test(real), '秘密情報・DBファイルへ向くリンクは参照しません')
  required(!restrictedPath(relative(root, real).split(sep).join('/')), '非公開ファイルへ向くシンボリックリンクは参照しません')
  if (!existsSync(full)) {
    required(allowMissingLocal && isLocalOnlyPath(path, workspacePolicy), `根拠ファイルが見つかりません: ${path}`)
    return null
  }
  required(statSync(full).isFile(), `ファイルを指定してください: ${path}`)
  return full
}

export function readState(repo = DEFAULT_REPO) {
  const raw = readFileSync(resolve(repo, STATE_PATH), 'utf8')
  const state = JSON.parse(raw)
  required(state.schema_version === 1 && Number.isSafeInteger(state.revision) && state.revision >= 0, '状態ファイルの形式・世代番号が不正です')
  required(state.workspace_relative_to_repo === '.', '作業フォルダ基準はこのリポジトリに固定されています')
  const workspace = realpathSync(repo)
  const missing_local_files = new Set()
  const evidencePath = path => {
    const full = sourcePath(workspace, path, { allowMissingLocal: true })
    if (full === null) missing_local_files.add(path)
    return full
  }
  required(Array.isArray(state.contexts) && state.contexts.length > 0 && Array.isArray(state.tasks) && Array.isArray(state.watch_files), '文脈・作業・根拠一覧が必要です')
  const unique = values => new Set(values).size === values.length
  const validId = id => typeof id === 'string' && /^[a-z][a-z0-9_]*$/.test(id)
  required(state.contexts.every(c => validId(c.id) && typeof c.title === 'string') && unique(state.contexts.map(c => c.id)), '文脈IDが不正又は重複しています')
  required(state.contexts.some(c => c.id === state.active_context), '現在の文脈が存在しません')
  for (const c of state.contexts) {
    required(typeof c.card === 'string' && c.card.startsWith('docs/workflow/contexts/') && c.card.endsWith('.md'), '文脈カードの配置・拡張子が不正です')
    const card = sourcePath(workspace, c.card)
    required(statSync(card).size <= 64 * 1024, '文脈カードは64KiB以内の短いMarkdownにしてください')
  }
  required(state.tasks.every(t => validId(t.id)) && unique(state.tasks.map(t => t.id)), '作業IDが不正又は重複しています')
  const ids = new Set(state.tasks.map(t => t.id))
  for (const task of state.tasks) {
    required(state.contexts.some(c => c.id === task.context) && STATUSES.includes(task.status), `作業の文脈・状態が不正です: ${task.id}`)
    required(typeof task.title === 'string' && typeof task.next_action === 'string' && typeof task.verification_scope === 'string', `作業の説明が不足しています: ${task.id}`)
    required(['requested', 'not_requested'].includes(task.authorization), `依頼範囲を確認してください: ${task.id}`)
    required(task.authorization !== 'requested' || (typeof task.request_ref === 'string' && task.request_ref.trim()), `依頼の根拠が必要です: ${task.id}`)
    required(!['todo', 'doing', 'needs_review', 'done'].includes(task.status) || task.authorization === 'requested', `未依頼の作業を着手対象にできません: ${task.id}`)
    required(Array.isArray(task.depends_on) && task.depends_on.every(id => ids.has(id) && id !== task.id), `依存関係が不正です: ${task.id}`)
    required(Array.isArray(task.evidence), `検証根拠の一覧が必要です: ${task.id}`)
    required(task.status !== 'done' || (task.evidence.length > 0 && Number.isFinite(Date.parse(task.last_verified_at))), `完了作業には根拠と確認日が必要です: ${task.id}`)
    task.evidence.forEach(evidencePath)
    for (const criterion of task.acceptance ?? []) (criterion.evidence ?? []).forEach(evidencePath)
  }
  const visiting = new Set(), visited = new Set()
  const visit = id => {
    required(!visiting.has(id), '作業の依存関係が循環しています')
    if (visited.has(id)) return
    visiting.add(id)
    state.tasks.find(t => t.id === id).depends_on.forEach(visit)
    visiting.delete(id); visited.add(id)
  }
  state.tasks.forEach(t => visit(t.id))
  validateWorkflow(state)
  required(unique(state.watch_files), '根拠ファイルが重複しています')
  state.watch_files.forEach(path => {
    required(PUBLIC_METADATA.has(path) || /\.(md|json|csv|ts|mjs|sql|vue)$/.test(path), '鮮度確認は小さな文書・ソースファイルに限定します')
    const full = evidencePath(path)
    required(full === null || statSync(full).size <= 1024 * 1024, '1MiBを超えるファイルは毎回の鮮度確認に使用しません')
  })
  if (state.last_checkpoint !== null) {
    required(typeof state.last_checkpoint === 'string' && state.last_checkpoint.startsWith(`${HISTORY_PATH}/`), '引き継ぎ記録の配置が不正です')
    sourcePath(workspace, state.last_checkpoint)
  }
  return { state, workspace, missing_local_files: [...missing_local_files], raw_hash: hash(raw) }
}

export function gitSnapshot(repo = DEFAULT_REPO) {
  const options = { cwd: repo, encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] }
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], options).trim()
    const entries = execFileSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], options).split('\0')
    const changes = []
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      if (!entry) continue
      const status = entry.slice(0, 2), path = entry.slice(3)
      const from = /[RC]/.test(status) ? entries[++i] : undefined
      if (!managed(path)) changes.push({ status, path, ...(from ? { from } : {}) })
    }
    return { available: true, head, changes }
  } catch { return { available: false, reason: 'Gitの状態を取得できません。作業前に個別確認してください' } }
}

export function fingerprints(workspace, files) {
  return Object.fromEntries(files.map(path => {
    const full = sourcePath(workspace, path, { allowMissingLocal: true })
    return [path, full === null ? null : hash(readFileSync(full))]
  }))
}

export function freshness(repo, loaded = readState(repo)) {
  const { state, workspace } = loaded
  const currentGit = gitSnapshot(repo)
  const currentFiles = fingerprints(workspace, state.watch_files)
  if (!state.last_checkpoint) return { baseline: false, changed_files: [], git_changed: null, state_changed: null, missing_local_files: loaded.missing_local_files, currentGit, currentFiles }
  const checkpoint = JSON.parse(readFileSync(resolve(repo, state.last_checkpoint), 'utf8'))
  required(checkpoint.schema_version === 1 && checkpoint.revision === state.revision, '引き継ぎ記録と状態ファイルの世代が一致しません')
  const recorded = checkpoint.file_hashes ?? {}
  const changed_files = [...new Set([...Object.keys(recorded), ...Object.keys(currentFiles)])].filter(path => recorded[path] !== currentFiles[path] || currentFiles[path] === null)
  return { baseline: true, state_changed: checkpoint.state_hash !== loaded.raw_hash, changed_files, git_changed: JSON.stringify(checkpoint.git) !== JSON.stringify(currentGit), missing_local_files: loaded.missing_local_files, currentGit, currentFiles }
}

export function runnableTasks(state, context = state.active_context, gateOptions = {}) {
  const done = new Set(state.tasks.filter(t => t.status === 'done').map(t => t.id))
  return state.tasks.filter(t => ['todo', 'doing'].includes(t.status) && t.authorization === 'requested' && t.depends_on.every(id => done.has(id)) && !['exhausted', 'waiting'].includes(evaluateTask(state, t, gateOptions).decision))
    .sort((a, b) => Number(b.context === context) - Number(a.context === context))
}

/** Constrain output paths before creating directories, locks, or files. */
function checkpointOutputPath(repo, path) {
  const root = realpathSync(repo)
  const full = resolve(root, path)
  required(inside(root, full), 'リポジトリ外へ引き継ぎ記録を書き込みません')
  let existing = full
  while (!existsSync(existing)) {
    required(!lstatSync(existing, { throwIfNoEntry: false })?.isSymbolicLink(), '参照先がないシンボリックリンクへ書き込みません')
    const parent = dirname(existing)
    required(parent !== existing && inside(root, parent), 'リポジトリ外へ引き継ぎ記録を書き込みません')
    existing = parent
  }
  required(inside(root, realpathSync(existing)), 'リポジトリ外のシンボリックリンクへ書き込みません')
  return full
}

export function createCheckpoint(repo, options) {
  const lock = checkpointOutputPath(repo, 'docs/workflow/.context.lock')
  checkpointOutputPath(repo, HISTORY_PATH)
  try { mkdirSync(lock) } catch { throw new WorkflowError('別の更新が進行中か、前回のロックが残っています。更新を重ねず、担当者と稼働状況を確認してください') }
  let temporary
  try {
    const loaded = readState(repo)
    const { state, workspace } = loaded
    required(Number.isSafeInteger(options.expectedRevision) && options.expectedRevision === state.revision, '状態が更新されています。statusを読み直し、新しい世代番号で記録してください')
    required(state.contexts.some(c => c.id === options.context), '記録対象の文脈が存在しません')
    required(typeof options.summary === 'string' && options.summary.trim() && options.summary.length <= 2000, '引き継ぎ要約を1〜2000文字で指定してください')
    required(typeof options.next === 'string' && options.next.trim() && options.next.length <= 2000, '次の作業又は待機条件を指定してください')
    const now = new Date()
    if (options.task) {
      const task = state.tasks.find(t => t.id === options.task)
      required(task && task.context === options.context, '作業と文脈が一致しません')
      const evidenceExists = path => sourcePath(workspace, path, { allowMissingLocal: true }) !== null
      if (options.outcome) {
        required(!options.status, '試行記録と--statusは同時に指定できません')
        recordAttempt(state, task, { outcome: options.outcome, summary: options.summary, at: now.toISOString() }, { evidenceExists })
      }
      if (options.status) {
        required(STATUSES.includes(options.status), '指定した作業状態が不正です')
        required(!['todo', 'doing', 'needs_review', 'done'].includes(options.status) || task.authorization === 'requested', '未依頼の作業へ着手できません')
        required(options.status !== 'done' || (task.evidence.length && Number.isFinite(Date.parse(task.last_verified_at))), '完了にする前に根拠・確認日・確認範囲をstate.jsonへ記録してください')
        const gate = evaluateTask(state, task, { evidenceExists })
        required(options.status !== 'done' || ['passed', 'legacy'].includes(gate.decision), `完了条件を満たしていません: ${gate.reasons.join('; ')}`)
        required(!['todo', 'doing'].includes(options.status) || gate.decision !== 'exhausted', '試行上限に達しています。要レビューのまま原因と計画を見直してください')
        task.status = options.status
      }
      task.next_action = options.next
    } else required(!options.status && !options.outcome, '--status又は--outcomeには--taskが必要です')
    validateWorkflow(state)
    const revision = state.revision + 1
    const name = `${now.toISOString().replaceAll(/[:.]/g, '-')}-r${revision}.json`
    const path = `${HISTORY_PATH}/${name}`
    state.revision = revision; state.updated_at = now.toISOString(); state.active_context = options.context; state.last_checkpoint = path
    const encodedState = JSON.stringify(state, null, 2) + '\n'
    const checkpoint = {
      schema_version: 1, revision, state_hash: hash(encodedState), recorded_at: now.toISOString(), timezone: 'UTC', context: options.context,
      task: options.task ?? null, summary: options.summary, next_action: options.next,
      missing_local_files: loaded.missing_local_files, git: gitSnapshot(repo), file_hashes: fingerprints(workspace, state.watch_files),
      ...(options.outcome ? { attempt: { outcome: options.outcome, number: state.tasks.find(t => t.id === options.task).execution.attempts.length } } : {}),
      verification_note: 'ハッシュ・Git・記録済み完了条件の確認であり、テストや出典照合の自動再実行ではない。依頼・権限は最新のユーザー指示とAGENTS.mdに従う。',
    }
    required(checkpoint.git.available, 'Gitの状態を取得できないため記録を中断しました')
    required(hash(readFileSync(resolve(repo, STATE_PATH), 'utf8')) === loaded.raw_hash, '記録中に状態ファイルが変更されました。読み直してください')
    const historyDirectory = checkpointOutputPath(repo, HISTORY_PATH)
    const checkpointFile = checkpointOutputPath(repo, path)
    const pendingState = checkpointOutputPath(repo, `docs/workflow/state.json.${process.pid}.tmp`)
    const stateFile = checkpointOutputPath(repo, STATE_PATH)
    mkdirSync(historyDirectory, { recursive: true })
    writeFileSync(checkpointFile, JSON.stringify(checkpoint, null, 2) + '\n', { flag: 'wx' })
    writeFileSync(pendingState, encodedState, { flag: 'wx' })
    temporary = pendingState
    renameSync(temporary, stateFile)
    return { path, revision }
  } finally {
    if (temporary) rmSync(temporary, { force: true })
    rmSync(lock, { recursive: true, force: true })
  }
}

function argumentsFor(argv) {
  const command = argv[0] ?? 'status', options = {}, positionals = []
  for (let i = 1; i < argv.length; i++) {
    const key = argv[i]
    if (!key.startsWith('--')) { positionals.push(key); continue }
    required(['--context', '--task', '--status', '--summary', '--next', '--expect-revision', '--outcome', '--format', '--json', '--strict'].includes(key), `未対応の引数です: ${key}`)
    if (['--json', '--strict'].includes(key)) { options[key.slice(2)] = true; continue }
    required(argv[i + 1] && !argv[i + 1].startsWith('--'), `${key}の値が必要です`)
    options[key.slice(2)] = argv[++i]
  }
  required(positionals.length <= 1, '文脈IDは1つ指定してください')
  return { command, options, context: options.context ?? positionals[0] }
}

export function main(argv = process.argv.slice(2), repo = DEFAULT_REPO) {
  const { command, options, context } = argumentsFor(argv)
  required(['status', 'start', 'next', 'check', 'checkpoint', 'attempt', 'gate', 'graph'].includes(command), 'コマンドはstatus/start/next/check/checkpoint/attempt/gate/graphです')
  required(!options.outcome || command === 'attempt', '--outcomeはattempt専用です')
  required(!options.format || command === 'graph', '--formatはgraph専用です')
  if (['checkpoint', 'attempt'].includes(command)) {
    required(command !== 'attempt' || (options.task && ['passed', 'failed'].includes(options.outcome) && !options.status), 'attemptには--taskと--outcome passed又はfailedが必要です（--statusは併用不可）')
    const result = createCheckpoint(repo, { context, task: options.task, status: options.status, outcome: options.outcome, summary: options.summary, next: options.next, expectedRevision: options['expect-revision'] === undefined ? undefined : Number(options['expect-revision']) })
    console.log(`引き継ぎ記録: ${result.path}（世代${result.revision}）`)
    return 0
  }
  const loaded = readState(repo)
  const { state } = loaded
  const gateOptions = { evidenceExists: path => sourcePath(loaded.workspace, path, { allowMissingLocal: true }) !== null }
  if (command === 'gate') {
    const task = state.tasks.find(t => t.id === options.task)
    required(task, 'gateには存在する--taskを指定してください')
    const result = evaluateTask(state, task, gateOptions)
    console.log(JSON.stringify({ task: task.id, ...result }, null, 2))
    return result.decision === 'passed' ? 0 : 2
  }
  if (command === 'graph') {
    required(!options.format || ['mermaid', 'json'].includes(options.format), '--formatはmermaid又はjsonです')
    console.log(options.format === 'json' || options.json ? JSON.stringify(taskGraph(state, gateOptions), null, 2) : renderMermaid(state, gateOptions))
    return 0
  }
  const selected = context ?? state.active_context
  required(state.contexts.some(c => c.id === selected), '指定した文脈が存在しません')
  const fresh = freshness(repo, loaded)
  const next = runnableTasks(state, selected, gateOptions)
  const result = {
    revision: state.revision, active_context: state.active_context, selected_context: selected,
    last_checkpoint: state.last_checkpoint, freshness: { baseline: fresh.baseline, changed_files: fresh.changed_files, git_changed: fresh.git_changed, state_changed: fresh.state_changed, git_available: fresh.currentGit.available, missing_local_files: fresh.missing_local_files },
    contexts: state.contexts.map(c => ({ ...c, tasks: state.tasks.filter(t => t.context === c.id).map(t => ({ id: t.id, title: t.title, status: t.status, decision: evaluateTask(state, t, gateOptions).decision, last_verified_at: t.last_verified_at })) })),
    runnable: next.map(t => ({ id: t.id, context: t.context, next_action: t.next_action, request_ref: t.request_ref })),
  }
  if (options.json) console.log(JSON.stringify(result, null, 2))
  else {
    console.log(`進捗・引き継ぎ 世代${state.revision} / 現在: ${state.active_context} / 参照: ${selected}`)
    for (const c of result.contexts) {
      console.log(`\n[${c.id}] ${c.title} — ${c.card}`)
      for (const t of c.tasks) console.log(`  ${t.status.padEnd(20)} ${t.id}: ${t.title} [${t.decision}]`)
    }
    console.log(`\n引き継ぎ: ${state.last_checkpoint ?? '初回記録前'}`)
    if (fresh.missing_local_files.length) console.log(`ローカル専用の根拠資料は未配置です（別の文脈は継続できます）: ${fresh.missing_local_files.join(', ')}`)
    if (fresh.changed_files.length) console.log(`根拠の変更あり（関係する確認だけを見直す）: ${fresh.changed_files.join(', ')}`)
    if (fresh.state_changed) console.log('進捗一覧が記録後に変更されています。内容を確認してから新しい引き継ぎ記録を残してください。')
    if (fresh.git_changed) console.log('Gitの変更状況が引き継ぎ時と異なります。既存差分と今回の差分を確認してください。')
    if (!fresh.currentGit.available) console.log('Git状態は未確認です。作業前に個別確認してください。')
    console.log(next.length ? `\n依頼済み・着手可能: ${next.map(t => t.id).join(', ')}` : '\n着手可能な依頼済みタスクはありません。資料待ち・未依頼の作業は自動着手しません。')
    if (command === 'start') {
      console.log('\n開始順: AGENTS.md → docs/workflow/README.md → 対象カード → 必要な根拠。現在のユーザー依頼が記録より優先です。\n')
      console.log(readFileSync(resolve(repo, state.contexts.find(c => c.id === selected).card), 'utf8'))
    }
    if (command === 'next') for (const task of next) console.log(`${task.id}: ${task.next_action}\n依頼の根拠: ${task.request_ref}`)
    if (command === 'check') console.log('\n形式・依存関係・根拠パスの検査: 成功（アプリのテストや原典の再照合は実行していません）')
  }
  return options.strict && (!fresh.baseline || fresh.changed_files.length > 0 || fresh.git_changed || fresh.state_changed || fresh.missing_local_files.length > 0 || !fresh.currentGit.available) ? 2 : 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main() } catch (error) { console.error(error instanceof WorkflowError || error instanceof GateError ? error.message : '進捗情報を処理できません。JSON形式・Git状態・ファイル権限を確認してください。秘密情報を含む詳細は出力しません。'); process.exitCode = 1 }
}
