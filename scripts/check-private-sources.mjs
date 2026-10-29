#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_WORKSPACE_POLICY, isLocalOnlyPath, loadWorkspacePolicy } from './workspace-policy.mjs'

export const DEFAULT_REPO = fileURLToPath(new URL('../', import.meta.url))
export const isPrivateSource = (path, policy = DEFAULT_WORKSPACE_POLICY) => isLocalOnlyPath(path, policy)

function git(repo, args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', timeout: 15000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
}
const paths = output => [...new Set(output.split('\0').map(path => path.replace(/^\n+/, '')).filter(Boolean))]
const trackedSources = (repo, policy) => paths(git(repo, ['ls-files', '-z'])).filter(path => isPrivateSource(path, policy))

/** Inspect names only, including deleted historical files. Never read source blobs. */
function inspectWithPolicy(repo, revisions, policy) {
  for (const ref of revisions) if (!/^[0-9a-f]{40,64}$/i.test(ref)) throw new Error('Invalid revision')
  const tracked = trackedSources(repo, policy)
  // Merge-only additions and every parent ancestry must remain visible even after index removal.
  const history = paths(git(repo, ['log', '-m', '--full-history', '--format=', '--name-only', '-z', ...(revisions.length ? revisions : ['--all']), '--'])).filter(path => isPrivateSource(path, policy))
  return { tracked, history }
}

export function inspect(repo = DEFAULT_REPO, revisions = []) {
  return inspectWithPolicy(repo, revisions, loadWorkspacePolicy(repo))
}

export function main(argv = [], repo = DEFAULT_REPO, input = '') {
  try {
    if (argv.some(arg => arg !== '--pre-push') || argv.length > 1) throw new Error('Invalid arguments')
    const policy = loadWorkspacePolicy(repo)
    let revisions = []
    if (argv.includes('--pre-push')) {
      const lines = input.trim() ? input.trim().split(/\r?\n/) : []
      for (const line of lines) {
        const parts = line.trim().split(/\s+/)
        if (parts.length !== 4 || !/^[0-9a-f]{40,64}$/i.test(parts[1]) || !/^[0-9a-f]{40,64}$/i.test(parts[3])) throw new Error('Invalid push metadata')
        if (!/^0+$/.test(parts[1])) revisions.push(parts[1])
      }
      // Deletion-only or empty pushes have no outgoing history; still check policy and index.
      if (revisions.length === 0) {
        const tracked = trackedSources(repo, policy)
        if (tracked.length) { console.error(`送信を中止しました。ローカル専用資料がGitの追跡対象にあります（${tracked.length}件）。`); return 1 }
        console.log('ローカル専用資料の送信検査: 成功（送信する履歴なし）')
        return 0
      }
    }
    const result = inspectWithPolicy(repo, [...new Set(revisions)], policy)
    if (result.tracked.length || result.history.length) {
      console.error(`送信を中止しました。ローカル専用資料を検出しました（追跡${result.tracked.length}件・履歴${result.history.length}件）。削除済みの資料も履歴から送信されるため、確認が必要です。`)
      return 1
    }
    console.log('ローカル専用資料のGit追跡・履歴検査: 成功')
    return 0
  } catch {
    console.error('ローカル専用資料の送信検査を完了できません。Gitの状態・参照・保護設定を確認するまで送信を中止します。')
    return 1
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2), DEFAULT_REPO, process.argv.includes('--pre-push') ? readFileSync(0, 'utf8') : '')
}
