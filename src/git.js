// Automatic save points, so fully autonomous rounds can always be undone.
import fs from 'node:fs'
import path from 'node:path'
import { spawnCmd } from './util.js'

// Never swept into an automatic commit: dependencies, caches, secrets and 傻妞's own config.
const EXCLUDES = [
  ':(glob,exclude)**/node_modules/**',
  ':(glob,exclude)**/.venv/**',
  ':(glob,exclude)**/venv/**',
  ':(glob,exclude)**/__pycache__/**',
  ':(glob,exclude)**/.env',
  ':(glob,exclude)**/.env.*',
  ':(glob,exclude)**/shaniu.config.json',
]

const DEFAULT_IGNORE = ['node_modules/', '.venv/', 'venv/', '__pycache__/', '.env', '.env.*', 'shaniu.config.json', '.DS_Store', '*.log', ''].join('\n')

export function git(dir, ...args) {
  return spawnCmd('git', args, { cwd: dir, collect: true, timeoutMs: 60000 }).done.then((r) => ({ ...r, out: r.stdout.trim() }))
}

export async function isRepo(dir) {
  return (await git(dir, 'rev-parse', '--is-inside-work-tree')).out === 'true'
}

export async function initRepo(dir) {
  const r = await git(dir, 'init')
  if (r.code !== 0) return false
  const ignore = path.join(dir, '.gitignore')
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, DEFAULT_IGNORE)
  return true
}

export async function head(dir) {
  const r = await git(dir, 'rev-parse', 'HEAD')
  return r.code === 0 ? r.out : null
}

export async function isDirty(dir) {
  return (await git(dir, 'status', '--porcelain')).out.length > 0
}

async function identity(dir) {
  const email = (await git(dir, 'config', 'user.email')).out
  return email ? [] : ['-c', 'user.name=傻妞', '-c', 'user.email=shaniu@localhost']
}

/** Stage everything (minus the excludes) and commit. Returns the new commit hash, or null if nothing changed. */
export async function commitAll(dir, message) {
  const add = await git(dir, 'add', '-A', '--', '.', ...EXCLUDES)
  if (add.code !== 0) return null
  const staged = await git(dir, 'diff', '--cached', '--quiet')
  if (staged.code === 0) return null
  const r = await git(dir, ...(await identity(dir)), 'commit', '-q', '--no-verify', '-m', message)
  return r.code === 0 ? head(dir) : null
}

/** Undo a commit with a new "revert" commit (history is kept, nothing is lost). */
export async function revertCommit(dir, hash) {
  if (await isDirty(dir)) await commitAll(dir, '傻妞：撤销前存档')
  const r = await git(dir, ...(await identity(dir)), 'revert', '--no-edit', hash)
  if (r.code === 0) return { ok: true, hash: await head(dir) }
  await git(dir, 'revert', '--abort')
  return { ok: false, error: (r.stderr || r.stdout).trim().split('\n')[0] || '撤销失败' }
}

export async function changedFiles(dir, base) {
  const r = base ? await git(dir, 'diff', '--stat', base, 'HEAD') : await git(dir, 'show', '--stat', '--format=', 'HEAD')
  return r.code === 0 ? r.out : ''
}
