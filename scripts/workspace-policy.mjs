import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

export const WORKSPACE_POLICY_PATH = 'docs/workflow/policy.json'
export const DEFAULT_WORKSPACE_POLICY = Object.freeze({
  schema_version: 1,
  local_only: Object.freeze({ directory_names: Object.freeze(['local-only']), filename_prefixes: Object.freeze([]) }),
})
export class WorkspacePolicyError extends Error {}
const required = (condition, message) => { if (!condition) throw new WorkspacePolicyError(message) }
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const folded = value => value.normalize('NFC').toLowerCase()
const inside = (root, path) => { const rel = relative(root, path); return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)) }
const exactKeys = (value, expected) => object(value) && Object.keys(value).sort().join('\0') === [...expected].sort().join('\0')
const component = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && value.trim() === value
  && !['.', '..'].includes(value) && !/[\\/\0\r\n*?\[\]]/.test(value)

/** One policy definition is shared by reference resolution and upload protection. */
export function validateWorkspacePolicy(value) {
  required(exactKeys(value, ['schema_version', 'local_only']) && value.schema_version === 1, '作業ポリシーの形式・版が不正です')
  required(exactKeys(value.local_only, ['directory_names', 'filename_prefixes']), 'ローカル専用資料の設定項目を確認してください')
  for (const values of [value.local_only.directory_names, value.local_only.filename_prefixes]) {
    required(Array.isArray(values) && values.length <= 32 && values.every(component), '保護対象は名前・接頭辞の一覧で指定してください。絶対パス・区切り・ワイルドカードは使えません')
    required(new Set(values.map(folded)).size === values.length, '保護対象の名前・接頭辞が重複しています')
  }
  required(value.local_only.directory_names.length + value.local_only.filename_prefixes.length > 0, '保護対象を1件以上指定してください')
  return structuredClone(value)
}

/** Missing policy retains a safe generic default; malformed policy never disables the guard. */
export function loadWorkspacePolicy(repo) {
  const root = realpathSync(repo), path = resolve(root, WORKSPACE_POLICY_PATH)
  let ancestor = path
  while (!existsSync(ancestor)) {
    required(!lstatSync(ancestor, { throwIfNoEntry: false })?.isSymbolicLink(), '作業ポリシーのリンク先を確認してください')
    ancestor = dirname(ancestor)
    required(inside(root, ancestor), '作業ポリシーはリポジトリ内に置いてください')
  }
  required(inside(root, realpathSync(ancestor)), '作業ポリシーのリポジトリ外リンクは読みません')
  if (!existsSync(path)) return structuredClone(DEFAULT_WORKSPACE_POLICY)
  required(!lstatSync(path).isSymbolicLink(), '作業ポリシーには通常のJSONファイルを指定してください')
  const details = statSync(path)
  required(details.isFile() && details.size <= 64 * 1024, '作業ポリシーは64KiB以内のJSONファイルにしてください')
  let parsed
  try { parsed = JSON.parse(readFileSync(path, 'utf8')) } catch { throw new WorkspacePolicyError('作業ポリシーのJSON形式を確認してください') }
  return validateWorkspacePolicy(parsed)
}

/** Match names only, at any depth; never inspect material contents. */
export function isLocalOnlyPath(path, policy = DEFAULT_WORKSPACE_POLICY) {
  if (typeof path !== 'string') return false
  const parts = folded(path).replaceAll('\\', '/').split('/').filter(Boolean)
  return parts.some(part => policy.local_only.directory_names.some(name => folded(name) === part))
    || policy.local_only.filename_prefixes.some(prefix => (parts.at(-1) ?? '').startsWith(folded(prefix)))
}
