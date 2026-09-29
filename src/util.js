import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const isWin = process.platform === 'win32'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function truncate(s, n) {
  s = String(s ?? '')
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

export function firstLine(s, n = 80) {
  const line = String(s ?? '').trim().split('\n').find((l) => l.trim()) || ''
  return truncate(line.replace(/\*\*|`/g, '').replace(/^[#>\s]+/, '').trim(), n)
}

export function expandHome(p) {
  if (!p) return p
  return p === '~' || p.startsWith('~/') || p.startsWith('~\\') ? path.join(os.homedir(), p.slice(1)) : p
}

/** Pull the first JSON object out of model output (bare, fenced, or embedded in prose). */
export function extractJson(text) {
  if (!text) return null
  const s = String(text).trim()
  try {
    return JSON.parse(s)
  } catch {}
  const fence = /```(?:json)?\s*([\s\S]*?)```/gi
  let m
  while ((m = fence.exec(s))) {
    try {
      return JSON.parse(m[1])
    } catch {}
  }
  for (let i = s.indexOf('{'); i !== -1; i = s.indexOf('{', i + 1)) {
    const end = matchBrace(s, i)
    if (end === -1) continue
    try {
      return JSON.parse(s.slice(i, end + 1))
    } catch {}
  }
  return null
}

function matchBrace(s, start) {
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return i
  }
  return -1
}

function winQuote(a) {
  a = String(a)
  if (/^[\w\-.:\\/=,@+]+$/.test(a)) return a
  return '"' + a.replace(/"/g, '\\"') + '"'
}

/**
 * Spawn a CLI, feed it stdin, stream stdout line by line.
 * `command` may be a string ("claude") or an array ([node, "/path/fake.mjs"]).
 */
export function spawnCmd(command, args, opts = {}) {
  const { cwd, env, input, onLine, collect = false, timeoutMs } = opts
  const [cmd, ...pre] = Array.isArray(command) ? command : [command]
  const argv = [...pre, ...args]
  const childEnv = { ...process.env, ...env }
  // A nested `claude -p` refuses to start when it thinks it is inside another Claude Code session.
  delete childEnv.CLAUDECODE

  let child
  try {
    child = isWin
      ? spawn([cmd, ...argv].map(winQuote).join(' '), { cwd, env: childEnv, shell: true, windowsHide: true })
      : spawn(cmd, argv, { cwd, env: childEnv, detached: true })
  } catch (e) {
    return { child: null, kill() {}, done: Promise.resolve({ code: -1, stdout: '', stderr: e.message, error: e }) }
  }

  let stdout = ''
  let stderr = ''
  let buf = ''
  let timedOut = false
  let killed = false

  const kill = () => {
    if (killed || child.exitCode !== null) return
    killed = true
    try {
      if (isWin) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
      else process.kill(-child.pid, 'SIGTERM')
    } catch {
      try {
        child.kill('SIGTERM')
      } catch {}
    }
    if (!isWin) {
      setTimeout(() => {
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {}
      }, 3000).unref()
    }
  }

  const done = new Promise((resolve) => {
    let timer
    if (timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true
        kill()
      }, timeoutMs)
      timer.unref?.()
    }
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      if (collect) stdout += chunk
      if (!onLine) return
      buf += chunk
      let i
      while ((i = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, i).replace(/\r$/, '')
        buf = buf.slice(i + 1)
        if (line.trim()) onLine(line)
      }
    })
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-6000)
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ code: -1, stdout, stderr: stderr + e.message, error: e, timedOut, killed })
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      if (onLine && buf.trim()) onLine(buf.trim())
      resolve({ code: code ?? -1, signal, stdout, stderr, timedOut, killed })
    })
  })

  child.stdin.on('error', () => {})
  if (input != null) child.stdin.end(input)
  else child.stdin.end()

  return { child, kill, done }
}

/** Small git/filesystem snapshot so the planner knows what project it is looking at. */
export async function projectContext(workdir) {
  const git = async (...a) => {
    const r = await spawnCmd('git', a, { cwd: workdir, collect: true, timeoutMs: 15000 }).done
    return r.code === 0 ? r.stdout : null
  }
  const inside = (await git('rev-parse', '--is-inside-work-tree'))?.trim() === 'true'
  let files = []
  let status = ''
  let branch = ''
  if (inside) {
    files = ((await git('ls-files')) || '').split('\n').filter(Boolean)
    status = (await git('status', '--short')) || ''
    branch = ((await git('branch', '--show-current')) || '').trim()
  } else {
    files = walk(workdir, 3)
  }
  return {
    workdir,
    isGit: inside,
    branch,
    fileCount: files.length,
    files: files.slice(0, 150).join('\n') + (files.length > 150 ? `\n…（共 ${files.length} 个文件）` : ''),
    status: truncate(status.trim(), 1500),
  }
}

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.venv', 'venv', '__pycache__', '.mavis', 'target'])

function walk(root, depth, rel = '', out = []) {
  if (depth < 0 || out.length > 300) return out
  let entries = []
  try {
    entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (SKIP.has(e.name) || e.name.startsWith('.')) continue
    const p = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) walk(root, depth - 1, p, out)
    else out.push(p)
  }
  return out
}

export async function gitChanges(workdir) {
  const r = await spawnCmd('git', ['status', '--short'], { cwd: workdir, collect: true, timeoutMs: 15000 }).done
  return r.code === 0 ? r.stdout.trim() : ''
}
