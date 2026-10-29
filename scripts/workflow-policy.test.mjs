import assert from 'node:assert/strict'
import test from 'node:test'
import { GateError, evaluateTask, recordAttempt, renderMermaid, taskGraph, validateWorkflow } from './workflow-policy.mjs'

const verifiedAt = '2026-10-27T00:00:00.000Z'
const task = (id, fields = {}) => ({
  id, context: 'service', title: `Synthetic ${id}`, status: 'doing', authorization: 'requested',
  request_ref: 'Synthetic user request', depends_on: [], evidence: [], last_verified_at: null,
  next_action: 'Review synthetic acceptance evidence', verification_scope: 'Pure synthetic unit test', ...fields,
})

function fixture() {
  const legacy = task('previous', {
    status: 'done', evidence: ['docs/previous.md'], last_verified_at: verifiedAt,
  })
  const current = task('current', {
    depends_on: ['previous'],
    acceptance: [
      { id: 'automated_check', kind: 'automated', description: 'Synthetic invariant holds', verification: 'Run the synthetic invariant check', status: 'pending', evidence: [], checked_at: null },
      { id: 'independent_review', kind: 'review', description: 'Synthetic result is independently reviewed', verification: 'Inspect the synthetic result and evidence', status: 'pending', evidence: [], checked_at: null, reviewer: null },
    ],
    execution: { worker: '/root/worker', max_attempts: 3, attempts: [] },
  })
  const state = {
    schema_version: 1, gate_policy: { version: 1, legacy_task_ids: ['previous'] },
    tasks: [legacy, current],
  }
  return { state, current, legacy }
}

function passCriteria(current) {
  for (const criterion of current.acceptance) {
    criterion.status = 'passed'
    criterion.evidence = [`docs/${criterion.id}.md`]
    criterion.checked_at = verifiedAt
    if (criterion.kind === 'review') criterion.reviewer = '/root/reviewer'
  }
}

function completeFixture() {
  const f = fixture()
  passCriteria(f.current)
  f.current.execution.attempts.push({ number: 1, outcome: 'passed', summary: 'All synthetic checks passed', at: verifiedAt, failed_criteria: [] })
  return f
}

function completedDependency(id, dependsOn = []) {
  const dependency = completeFixture().current
  dependency.id = id
  dependency.title = `Synthetic ${id}`
  dependency.status = 'done'
  dependency.depends_on = dependsOn
  for (const criterion of dependency.acceptance) criterion.evidence = [`docs/${id}/${criterion.id}.md`]
  return dependency
}

const evaluate = (state, current, evidenceExists = () => true) => evaluateTask(state, current, { evidenceExists })
const attempt = (state, current, outcome = 'failed', extra = {}) => recordAttempt(state, current, { outcome, summary: 'Synthetic verification attempt', at: verifiedAt, ...extra })

test('new active tasks require explicit acceptance and bounded execution contracts', async t => {
  const changes = {
    missing_acceptance: current => { delete current.acceptance },
    empty_acceptance: current => { current.acceptance = [] },
    missing_execution: current => { delete current.execution },
    missing_worker: current => { delete current.execution.worker },
    empty_worker: current => { current.execution.worker = ' ' },
    missing_verification: current => { delete current.acceptance[0].verification },
    empty_verification: current => { current.acceptance[0].verification = ' ' },
    missing_description: current => { delete current.acceptance[0].description },
    no_automated_check: current => { current.acceptance = current.acceptance.filter(criterion => criterion.kind !== 'automated') },
    no_independent_review: current => { current.acceptance = current.acceptance.filter(criterion => criterion.kind !== 'review') },
    unsupported_kind: current => { current.acceptance[0].kind = 'self_report' },
    duplicate_criterion: current => { current.acceptance.push(structuredClone(current.acceptance[0])) },
    invalid_criterion_status: current => { current.acceptance[0].status = 'assumed' },
    zero_attempt_budget: current => { current.execution.max_attempts = 0 },
    excessive_attempt_budget: current => { current.execution.max_attempts = 6 },
    fractional_attempt_budget: current => { current.execution.max_attempts = 1.5 },
    missing_attempts: current => { delete current.execution.attempts },
  }
  for (const [name, change] of Object.entries(changes)) await t.test(name, () => {
    const { state, current } = fixture()
    change(current)
    assert.throws(() => validateWorkflow(state), GateError)
  })
})

test('todo and needs_review tasks cannot omit the acceptance contract', async t => {
  for (const status of ['todo', 'needs_review']) await t.test(status, () => {
    const { state, current } = fixture()
    current.status = status
    delete current.acceptance
    delete current.execution
    assert.throws(() => validateWorkflow(state), GateError)
  })
})

test('a new done task cannot bypass gates by changing only its status', async t => {
  const cases = {
    missing_contract: current => { delete current.acceptance; delete current.execution },
    pending_criteria: () => {},
    no_attempt: current => { passCriteria(current) },
    last_attempt_failed: current => {
      passCriteria(current)
      current.execution.attempts.push({ number: 1, outcome: 'failed', summary: 'Earlier check failed', at: verifiedAt, failed_criteria: ['automated_check'] })
    },
  }
  for (const [name, change] of Object.entries(cases)) await t.test(name, () => {
    const { state, current } = fixture()
    current.status = 'done'
    change(current)
    assert.throws(() => validateWorkflow(state), GateError)
  })
})

test('a valid contract stays pending until an attempt records actual verification', () => {
  const { state, current } = fixture()
  assert.doesNotThrow(() => validateWorkflow(state))
  assert.equal(evaluate(state, current).decision, 'pending')
  passCriteria(current)
  assert.equal(evaluate(state, current).decision, 'pending')
})

test('completed dependencies and current request authorization remain mandatory', async t => {
  const changes = {
    dependency_not_done: ({ legacy }) => { legacy.status = 'doing' },
    unrequested: ({ current }) => { current.authorization = 'not_requested'; current.request_ref = null; current.status = 'waiting_for_request' },
    material_missing: ({ current }) => { current.status = 'waiting_for_material' },
  }
  for (const [name, change] of Object.entries(changes)) await t.test(name, () => {
    const f = completeFixture()
    change(f)
    const result = evaluate(f.state, f.current)
    assert.equal(result.decision, 'waiting')
    assert(result.reasons.length > 0)
    const snapshot = structuredClone(f.state)
    assert.throws(() => attempt(f.state, f.current, 'passed'), GateError)
    assert.deepEqual(f.state, snapshot)
  })
})

test('passing needs every criterion, persisted evidence, and a successful last attempt', () => {
  const { state, current } = completeFixture()
  assert.equal(evaluate(state, current).decision, 'passed')
  current.acceptance[0].status = 'failed'
  const result = evaluate(state, current)
  assert.notEqual(result.decision, 'passed')
  assert(result.failed_criteria.includes('automated_check'))
})

test('missing evidence invalidates an otherwise passed gate without rewriting history', () => {
  const { state, current } = completeFixture()
  const snapshot = structuredClone(state)
  const result = evaluate(state, current, path => path !== 'docs/automated_check.md')
  assert.notEqual(result.decision, 'passed')
  assert(result.failed_criteria.includes('automated_check'))
  assert(result.reasons.length > 0)
  assert.deepEqual(state, snapshot)
})

test('vanished evidence on a gated done prerequisite makes its dependent wait', () => {
  const { state, current } = completeFixture()
  const dependency = completedDependency('verified_dependency')
  state.gate_policy.legacy_task_ids = []
  state.tasks = [dependency, current]
  current.depends_on = [dependency.id]
  assert.doesNotThrow(() => validateWorkflow(state))
  assert.equal(evaluate(state, current).decision, 'passed')
  const snapshot = structuredClone(state)
  const exists = path => path !== 'docs/verified_dependency/automated_check.md'
  assert.notEqual(evaluate(state, dependency, exists).decision, 'passed')
  const result = evaluate(state, current, exists)
  assert.equal(result.decision, 'waiting')
  assert(result.reasons.length > 0)
  assert.deepEqual(state, snapshot)
  assert.equal(dependency.status, 'done')
})

test('stale completed evidence blocks every dependent through a transitive chain', () => {
  const { state, current } = completeFixture()
  const source = completedDependency('source')
  const intermediate = completedDependency('intermediate', [source.id])
  state.gate_policy.legacy_task_ids = []
  state.tasks = [source, intermediate, current]
  current.depends_on = [intermediate.id]
  assert.doesNotThrow(() => validateWorkflow(state))
  assert.equal(evaluate(state, current).decision, 'passed')
  const snapshot = structuredClone(state)
  const exists = path => path !== 'docs/source/independent_review.md'
  assert.equal(evaluate(state, intermediate, exists).decision, 'waiting')
  assert.equal(evaluate(state, current, exists).decision, 'waiting')
  assert.deepEqual(state, snapshot)
})

test('a legacy done prerequisite remains historical rather than newly evidence-certified', () => {
  const { state, current, legacy } = completeFixture()
  const snapshot = structuredClone(state)
  const exists = path => path !== 'docs/previous.md'
  const result = evaluate(state, legacy, exists)
  assert.equal(result.decision, 'legacy')
  assert.notEqual(result.decision, 'passed')
  assert(result.reasons.length > 0)
  assert.equal(evaluate(state, current, exists).decision, 'passed')
  assert.deepEqual(state, snapshot)
})

test('passed criteria require evidence, a valid date, and independent review identity', async t => {
  const changes = {
    empty_evidence: current => { current.acceptance[0].evidence = [] },
    missing_evidence: current => { delete current.acceptance[0].evidence },
    no_check_date: current => { current.acceptance[0].checked_at = null },
    malformed_check_date: current => { current.acceptance[0].checked_at = 'not-a-date' },
    impossible_check_date: current => { current.acceptance[0].checked_at = '2026-02-30T00:00:00.000Z' },
    missing_reviewer: current => { current.acceptance[1].reviewer = null },
    blank_reviewer: current => { current.acceptance[1].reviewer = ' ' },
    self_review: current => { current.acceptance[1].reviewer = current.execution.worker },
  }
  for (const [name, change] of Object.entries(changes)) await t.test(name, () => {
    const { state, current } = completeFixture()
    change(current)
    assert.throws(() => validateWorkflow(state), GateError)
  })
})

test('attempt history has contiguous numbering, bounded totals, and valid outcomes', async t => {
  const changes = {
    starts_at_zero: attempts => { attempts[0].number = 0 },
    starts_at_two: attempts => { attempts[0].number = 2 },
    repeated_number: attempts => { attempts.push({ ...attempts[0] }) },
    skipped_number: attempts => { attempts.push({ ...attempts[0], number: 3 }) },
    unsupported_outcome: attempts => { attempts[0].outcome = 'skipped' },
    empty_summary: attempts => { attempts[0].summary = ' ' },
    malformed_date: attempts => { attempts[0].at = 'invalid-date' },
    impossible_date: attempts => { attempts[0].at = '2026-02-30' },
    unknown_criterion: attempts => { attempts[0].failed_criteria = ['invented_check'] },
    too_many_attempts: attempts => { attempts.push(...[2, 3, 4].map(number => ({ ...attempts[0], number }))) },
  }
  for (const [name, change] of Object.entries(changes)) await t.test(name, () => {
    const { state, current } = completeFixture()
    change(current.execution.attempts)
    assert.throws(() => validateWorkflow(state), GateError)
  })
})

test('attempt budget includes the first try and stops retries after the final failure', () => {
  const { state, current } = fixture()
  for (let number = 1; number <= current.execution.max_attempts; number++) {
    attempt(state, current)
    assert.equal(current.execution.attempts.length, number)
    assert.equal(current.execution.attempts.at(-1).number, number)
    assert.deepEqual(new Set(current.execution.attempts.at(-1).failed_criteria), new Set(['automated_check', 'independent_review']))
    assert.equal(evaluate(state, current).decision, number < 3 ? 'rework' : 'exhausted')
  }
  assert.equal(current.status, 'needs_review')
  const snapshot = structuredClone(state)
  assert.throws(() => attempt(state, current), GateError)
  assert.deepEqual(state, snapshot)
  current.status = 'doing'
  assert.equal(evaluate(state, current).decision, 'exhausted')
  assert.throws(() => attempt(state, current), GateError)
  assert.equal(current.execution.attempts.length, 3)
})

test('a one-attempt budget cannot silently become a second correction opportunity', () => {
  const { state, current } = fixture()
  current.execution.max_attempts = 1
  attempt(state, current)
  assert.equal(current.status, 'needs_review')
  passCriteria(current)
  assert.throws(() => attempt(state, current, 'passed'), GateError)
  assert.equal(current.execution.attempts.length, 1)
  assert.equal(evaluate(state, current).decision, 'exhausted')
})

test('stale success cannot reopen an exhausted total attempt budget', async t => {
  await t.test('criterion_no_longer_passes', () => {
    const { state, current } = completeFixture()
    current.execution.max_attempts = 1
    current.acceptance[0].status = 'failed'
    assert.equal(evaluate(state, current).decision, 'exhausted')
    const snapshot = structuredClone(state)
    assert.throws(() => attempt(state, current), GateError)
    assert.deepEqual(state, snapshot)
  })
  await t.test('evidence_no_longer_exists', () => {
    const { state, current } = completeFixture()
    current.execution.max_attempts = 1
    assert.equal(evaluate(state, current, () => false).decision, 'exhausted')
  })
})

test('failed attempts preserve their history when a later permitted verification passes', () => {
  const { state, current } = fixture()
  attempt(state, current)
  const first = structuredClone(current.execution.attempts[0])
  passCriteria(current)
  attempt(state, current, 'passed')
  assert.equal(current.execution.attempts.length, 2)
  assert.deepEqual(current.execution.attempts[0], first)
  assert.equal(current.execution.attempts[1].number, 2)
  assert.equal(current.execution.attempts[1].outcome, 'passed')
  assert.deepEqual(current.execution.attempts[1].failed_criteria, [])
  assert.equal(evaluate(state, current).decision, 'passed')
})

test('success cannot be recorded from unchecked criteria and rejection is atomic', () => {
  const { state, current } = fixture()
  const snapshot = structuredClone(state)
  assert.throws(() => attempt(state, current, 'passed'), GateError)
  assert.deepEqual(state, snapshot)
  assert.equal(current.execution.attempts.length, 0)
})

test('a successful record checks evidence existence before consuming an attempt', () => {
  const { state, current } = fixture()
  passCriteria(current)
  const snapshot = structuredClone(state)
  assert.throws(() => recordAttempt(state, current, {
    outcome: 'passed', summary: 'Synthetic successful evaluation', at: verifiedAt,
  }, { evidenceExists: () => false }), GateError)
  assert.deepEqual(state, snapshot)
})

test('invalid attempt input cannot mutate the task or reset its counter', async t => {
  for (const fields of [{ outcome: 'skipped' }, { summary: '' }, { at: 'not-a-date' }]) await t.test(JSON.stringify(fields), () => {
    const { state, current } = fixture()
    attempt(state, current)
    const snapshot = structuredClone(state)
    assert.throws(() => attempt(state, current, 'failed', fields), GateError)
    assert.deepEqual(state, snapshot)
  })
})

test('legacy snapshots remain readable without claiming new gate verification', () => {
  const { state, legacy } = fixture()
  assert.doesNotThrow(() => validateWorkflow(state))
  assert.equal(evaluate(state, legacy).decision, 'legacy')
  assert.throws(() => attempt(state, legacy, 'passed'), GateError)
  delete state.gate_policy
  delete state.tasks[1].acceptance
  delete state.tasks[1].execution
  assert.doesNotThrow(() => validateWorkflow(state))
  for (const current of state.tasks) assert.equal(evaluate(state, current).decision, 'legacy')
})

test('legacy exemptions must explicitly name known unique task IDs under policy version 1', async t => {
  const changes = {
    unsupported_version: state => { state.gate_policy.version = 2 },
    missing_legacy_list: state => { delete state.gate_policy.legacy_task_ids },
    duplicate_legacy_id: state => { state.gate_policy.legacy_task_ids.push('previous') },
    unknown_legacy_id: state => { state.gate_policy.legacy_task_ids.push('unknown_task') },
  }
  for (const [name, change] of Object.entries(changes)) await t.test(name, () => {
    const { state } = fixture()
    change(state)
    assert.throws(() => validateWorkflow(state), GateError)
  })
})

test('attempt writes reject detached task copies without modifying canonical state', () => {
  const { state, current } = fixture()
  const copy = structuredClone(current)
  const snapshot = structuredClone(state)
  assert.throws(() => attempt(state, copy), GateError)
  assert.deepEqual(state, snapshot)
  assert.equal(copy.execution.attempts.length, 0)
})

test('explicitly adding a complete contract opts a legacy task into current verification', () => {
  const { state, current } = completeFixture()
  state.gate_policy.legacy_task_ids.push(current.id)
  assert.equal(evaluate(state, current).decision, 'passed')
})

test('the derived graph preserves only declared dependencies and does not mutate state', () => {
  const { state } = fixture()
  const snapshot = structuredClone(state)
  const graph = taskGraph(state)
  assert.deepEqual(graph.nodes.map(node => node.id), ['previous', 'current'])
  assert.deepEqual(graph.edges, [{ from: 'previous', to: 'current' }])
  assert.equal(graph.nodes.find(node => node.id === 'previous').decision, 'legacy')
  assert.equal(graph.nodes.find(node => node.id === 'current').decision, 'pending')
  assert.deepEqual(state, snapshot)
})

test('Mermaid output uses safe identifiers and never interpolates arbitrary titles', () => {
  const { state, current } = fixture()
  const maliciousTitle = 'title"] --> injected["<script>throw new Error("unsafe")</script>\nclick injected "javascript:alert(1)"'
  current.title = maliciousTitle
  const output = renderMermaid(state)
  assert.match(output, /^flowchart /)
  assert.match(output, /previous/)
  assert.match(output, /current/)
  for (const text of [maliciousTitle, '<script>', 'javascript:', 'click injected', 'throw new Error']) assert(!output.includes(text))
  assert.equal(output.split('\n').filter(line => /-->/.test(line)).length, 1)
})

test('Mermaid rejects unsafe task IDs and undeclared dependency endpoints', async t => {
  await t.test('unsafe_id', () => {
    const { state, current } = fixture()
    current.id = 'current"] --> injected["unsafe'
    assert.throws(() => renderMermaid(state), GateError)
  })
  await t.test('unknown_endpoint', () => {
    const { state, current } = fixture()
    current.depends_on = ['missing_task']
    assert.throws(() => renderMermaid(state), GateError)
  })
})
