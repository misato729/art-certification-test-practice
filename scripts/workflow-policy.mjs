/** Pure workflow gates. Paths and commands are checked by the calling application. */
export class GateError extends Error {
  constructor(message) { super(message); this.name = 'GateError' }
}

const required = (condition, message) => { if (!condition) throw new GateError(message) }
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = value => typeof value === 'string' && value.trim().length > 0
const id = value => typeof value === 'string' && /^[a-z][a-z0-9_]*$/.test(value)
const unique = values => new Set(values).size === values.length
const gatedStatuses = new Set(['todo', 'doing', 'done', 'needs_review'])
const statuses = new Set(['todo', 'doing', 'done', 'needs_review', 'waiting_for_material', 'waiting_for_request'])

function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d))?$/.test(value)) return false
  if (!Number.isFinite(Date.parse(value))) return false
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`).toISOString().slice(0, 10) === value.slice(0, 10)
}

function policy(state) {
  required(object(state) && Array.isArray(state.tasks), '作業一覧が必要です')
  if (state.gate_policy === undefined) return null
  const rule = state.gate_policy
  required(object(rule) && rule.version === 1, '完了ゲートの版は1を指定してください')
  required(Array.isArray(rule.legacy_task_ids) && rule.legacy_task_ids.every(id) && unique(rule.legacy_task_ids), '既存作業IDの一覧が不正又は重複しています')
  const known = new Set(state.tasks.map(task => task.id))
  required(rule.legacy_task_ids.every(value => known.has(value)), '既存作業IDの一覧に存在しない作業が含まれています')
  return rule
}

function contract(task, rule) {
  if (rule === null) return false
  const grandfathered = rule.legacy_task_ids.includes(task.id)
  const hasAcceptance = task.acceptance !== undefined
  const hasExecution = task.execution !== undefined
  if (!hasAcceptance && !hasExecution) {
    required(grandfathered || !gatedStatuses.has(task.status), `作業には完了条件と実行上限が必要です: ${task.id}`)
    return false
  }
  required(Array.isArray(task.acceptance) && task.acceptance.length > 0 && object(task.execution), `完了条件と実行上限を一緒に指定してください: ${task.id}`)
  const execution = task.execution
  required(text(execution.worker), `実装担当者が必要です: ${task.id}`)
  required(Number.isInteger(execution.max_attempts) && execution.max_attempts >= 1 && execution.max_attempts <= 5, `評価回数の上限は1〜5回です: ${task.id}`)
  required(Array.isArray(execution.attempts) && execution.attempts.length <= execution.max_attempts, `評価記録が上限を超えています: ${task.id}`)
  const criterionIds = task.acceptance.map(criterion => criterion?.id)
  required(criterionIds.every(id) && unique(criterionIds), `完了条件IDが不正又は重複しています: ${task.id}`)
  required(task.acceptance.some(criterion => criterion.kind === 'automated') && task.acceptance.some(criterion => criterion.kind === 'review'), `自動検査と独立レビューの完了条件が必要です: ${task.id}`)
  for (const criterion of task.acceptance) {
    const label = `${task.id}/${criterion.id}`
    required(['automated', 'review'].includes(criterion.kind) && text(criterion.description) && text(criterion.verification), `完了条件の種類・説明・検証方法が必要です: ${label}`)
    required(['pending', 'passed', 'failed'].includes(criterion.status), `完了条件の状態が不正です: ${label}`)
    required(Array.isArray(criterion.evidence) && criterion.evidence.every(text) && unique(criterion.evidence), `完了条件の根拠一覧が不正です: ${label}`)
    required(criterion.checked_at === null || date(criterion.checked_at), `完了条件の確認日が不正です: ${label}`)
    if (criterion.status === 'passed') {
      required(criterion.evidence.length > 0 && date(criterion.checked_at), `合格した完了条件には根拠と確認日が必要です: ${label}`)
      if (criterion.kind === 'review') required(text(criterion.reviewer) && criterion.reviewer.trim() !== execution.worker.trim(), `レビュー担当者は実装担当者と分けてください: ${label}`)
    }
  }
  const known = new Set(criterionIds)
  execution.attempts.forEach((attempt, index) => {
    const label = `${task.id}/${index + 1}`
    required(object(attempt) && attempt.number === index + 1, `評価番号は1から連続させてください: ${label}`)
    required(['passed', 'failed'].includes(attempt.outcome) && text(attempt.summary) && date(attempt.at), `評価結果・要約・確認日が必要です: ${label}`)
    required(Array.isArray(attempt.failed_criteria) && attempt.failed_criteria.every(value => known.has(value)) && unique(attempt.failed_criteria), `不合格条件のIDが不正又は重複しています: ${label}`)
    required(attempt.outcome !== 'passed' || attempt.failed_criteria.length === 0, `合格評価に不合格条件は記録できません: ${label}`)
  })
  return true
}

function target(state, task) {
  required(object(task) && state.tasks.some(candidate => candidate.id === task.id), '作業一覧に存在する作業を指定してください')
  return task
}

function unmet(task, evidenceExists) {
  return task.acceptance.filter(criterion => criterion.status !== 'passed' || !criterion.evidence.every(path => evidenceExists(path))).map(criterion => criterion.id)
}

function evaluate(state, task, rule, evidenceExists, ancestors = new Set()) {
  required(!ancestors.has(task.id), `作業の依存関係が循環しています: ${task.id}`)
  const chain = new Set([...ancestors, task.id])
  const hasContract = contract(task, rule)
  const blocked = []
  const known = new Map(state.tasks.map(candidate => [candidate.id, candidate]))
  for (const dependency of task.depends_on ?? []) {
    const prerequisite = known.get(dependency)
    if (prerequisite?.status !== 'done') {
      blocked.push(`依存作業が未完了です: ${dependency}`)
      continue
    }
    const verdict = evaluate(state, prerequisite, rule, evidenceExists, chain)
    if (!['passed', 'legacy'].includes(verdict.decision)) blocked.push(`依存作業の完了条件を確認できません: ${dependency} (${verdict.decision})`)
  }
  if (task.authorization !== 'requested' || !text(task.request_ref)) blocked.push('着手・完了に必要なユーザー依頼がありません')
  if (task.status === 'waiting_for_material') blocked.push('必要な資料の受領待ちです')
  if (task.status === 'waiting_for_request') blocked.push('ユーザーの依頼待ちです')
  const failed = hasContract ? unmet(task, evidenceExists) : []
  if (blocked.length) return { decision: 'waiting', reasons: blocked, failed_criteria: failed }
  if (!hasContract) return { decision: 'legacy', reasons: ['既存記録です。今回の完了ゲートでは再検証していません'], failed_criteria: [] }
  const { attempts, max_attempts: max } = task.execution
  const last = attempts.at(-1)
  if (failed.length === 0 && last?.outcome === 'passed') return { decision: 'passed', reasons: [], failed_criteria: [] }
  if (attempts.length >= max) return { decision: 'exhausted', reasons: [`評価回数の上限${max}回に達しました。原因・計画の見直しが必要です`], failed_criteria: failed }
  if (last?.outcome === 'failed') return { decision: 'rework', reasons: ['直近の評価が不合格です。残りの評価回数内で修正してください'], failed_criteria: failed }
  return { decision: 'pending', reasons: [failed.length ? '未合格又は根拠が確認できない完了条件があります' : '完了条件の評価結果がまだ記録されていません'], failed_criteria: failed }
}

/** Validate only gate policy and contracts; callers validate the base task schema. */
export function validateWorkflow(state) {
  const rule = policy(state)
  for (const task of state.tasks) contract(task, rule)
  for (const task of state.tasks.filter(candidate => candidate.status === 'done')) {
    const verdict = evaluate(state, task, rule, () => true)
    required(['passed', 'legacy'].includes(verdict.decision), `完了ゲートを満たしていない作業を完了にできません: ${task.id} (${verdict.decision})`)
  }
}

/** Evidence existence is injected; this module never reads files or runs checks. */
export function evaluateTask(state, task, { evidenceExists = () => true } = {}) {
  required(typeof evidenceExists === 'function', '根拠確認には関数を指定してください')
  return evaluate(state, target(state, task), policy(state), evidenceExists)
}

/** Record one total evaluation, atomically, after all prospective checks succeed. */
export function recordAttempt(state, task, { outcome, summary, at }, { evidenceExists = () => true } = {}) {
  validateWorkflow(state)
  target(state, task)
  required(state.tasks.includes(task), '評価記録は作業一覧の同じ作業オブジェクトへ記録してください')
  required(typeof evidenceExists === 'function', '根拠確認には関数を指定してください')
  required(contract(task, policy(state)), '既存記録へ新しい検証結果を付け足せません。完了条件を先に定義してください')
  required(task.authorization === 'requested' && text(task.request_ref), '依頼されていない作業の評価は記録できません')
  required(['todo', 'doing', 'needs_review'].includes(task.status), '着手中の作業だけ評価できます')
  required(['passed', 'failed'].includes(outcome) && text(summary) && date(at), '評価結果・要約・確認日を指定してください')
  const execution = task.execution
  required(execution.attempts.length < execution.max_attempts, '評価回数の上限に達しています。自動で再試行しません')
  const before = evaluateTask(state, task, { evidenceExists })
  required(before.decision !== 'waiting', `作業の待機条件を解消してください: ${before.reasons.join('、')}`)
  const attempt = { number: execution.attempts.length + 1, outcome, summary: summary.trim(), at, failed_criteria: outcome === 'failed' ? unmet(task, evidenceExists) : [] }
  const proposed = { ...task, status: outcome === 'failed' && attempt.number >= execution.max_attempts ? 'needs_review' : 'doing', execution: { ...execution, attempts: [...execution.attempts, attempt] } }
  const proposedState = { ...state, tasks: state.tasks.map(candidate => candidate === task ? proposed : candidate) }
  validateWorkflow(proposedState)
  if (outcome === 'passed') {
    const verdict = evaluateTask(proposedState, proposed, { evidenceExists })
    required(verdict.decision === 'passed', `完了条件が合格していないため合格評価を記録できません: ${verdict.failed_criteria.join('、')}`)
  }
  task.execution = proposed.execution
  task.status = proposed.status
  return attempt
}

/** Edges retain only declared prerequisites, directed prerequisite -> dependent. */
export function taskGraph(state, options = {}) {
  validateWorkflow(state)
  return {
    nodes: state.tasks.map(task => ({ id: task.id, title: task.title, status: task.status, decision: evaluateTask(state, task, options).decision })),
    edges: state.tasks.flatMap(task => (task.depends_on ?? []).map(dependency => ({ from: dependency, to: task.id }))),
  }
}

/** Mermaid gets synthetic IDs and validated enum labels, never task prose. */
export function renderMermaid(state, options = {}) {
  const graph = taskGraph(state, options)
  const names = new Map(graph.nodes.map((node, index) => [node.id, `n${index}`]))
  const lines = ['flowchart TD']
  for (const node of graph.nodes) {
    required(id(node.id) && statuses.has(node.status), 'グラフの作業ID・状態が不正です')
    lines.push(`  ${names.get(node.id)}["${node.id} / ${node.status} / ${node.decision}"]`)
  }
  for (const edge of graph.edges) {
    required(names.has(edge.from) && names.has(edge.to), 'グラフに存在しない依存先があります')
    lines.push(`  ${names.get(edge.from)} --> ${names.get(edge.to)}`)
  }
  return `${lines.join('\n')}\n`
}
