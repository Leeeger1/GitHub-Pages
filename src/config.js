import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expandHome } from './util.js'

export const DEFAULTS = {
  port: 7777,
  host: '127.0.0.1',
  // Which worker does 傻妞's own thinking (planning, acceptance checks, reports).
  // Falls back to the strongest available worker.
  brain: 'claude',
  brainModel: '',
  // full: workers act without asking (edit files, run any command except a few dangerous ones).
  // safe: Claude only runs whitelisted commands, Codex has no network, API workers only run whitelisted commands.
  autonomy: 'full',
  parallel: true,
  // Plan → work → acceptance check. If the check finds gaps, plan follow-up work, up to this many passes.
  maxIterations: 3,
  // After a review asks for changes: how many fix → re-review rounds to allow.
  maxFixRounds: 1,
  // When a worker fails a task, hand it to someone else this many times.
  maxRetries: 1,
  dispatchDelayMs: 1500,
  taskTimeoutMin: 30,
  historyRounds: 6,
  // Project kick-off meetings for new projects and big features: a few employees discuss the
  // framework, structure and database, the chair writes minutes, and everyone follows them.
  meeting: {
    enabled: true,
    maxAttendees: 4,
    // Save the minutes into the project as docs/meetings/<date>-<topic>.md
    save: true,
  },
  git: {
    // Turn a plain folder into a Git repo so every round can be undone.
    autoInit: true,
    // Save a commit before and after each round.
    autoCommit: true,
  },
  logDir: '~/.shaniu/logs',
  statsFile: '~/.shaniu/stats.json',
  // 项目组 = a model backend. `models` picks a model per task difficulty.
  // type: claude-cli (Claude Code) | codex-cli (Codex) | openai-api (any OpenAI-compatible API / relay)
  groups: [
    { id: 'claude', name: 'Claude 组', type: 'claude-cli', color: '#c4602f', models: { hard: 'opus', medium: 'sonnet', easy: 'haiku' } },
    { id: 'codex', name: 'Codex 组', type: 'codex-cli', color: '#16837a' },
  ],
  // 员工 = a skill (skills/*.md) working in a project group. Skill files that name a group are
  // hired automatically; a group with nobody in it gets a 全栈工程师.
  employees: [
    { id: 'architect', skill: 'architect', group: 'claude' },
    { id: 'frontend', skill: 'frontend', group: 'claude' },
    { id: 'reviewer', skill: 'reviewer', group: 'claude' },
    { id: 'backend', skill: 'backend', group: 'codex' },
    { id: 'tester', skill: 'tester', group: 'codex' },
    { id: 'debugger', skill: 'debugger', group: 'codex' },
  ],
}

// Commands Claude may never run on its own, whatever the autonomy level.
export const CLAUDE_DENY = [
  'Bash(sudo:*)',
  'Bash(git push:*)',
  'Bash(git reset --hard:*)',
  'Bash(git clean:*)',
  'Bash(rm -rf /:*)',
  'Bash(rm -rf ~:*)',
]

// Command prefixes allowed in "safe" autonomy.
export const SAFE_COMMANDS = [
  'git status', 'git diff', 'git log', 'git show', 'ls', 'cat', 'mkdir',
  'npm', 'npx', 'pnpm', 'yarn', 'node', 'python', 'python3', 'pip', 'pytest', 'go', 'cargo', 'make',
]

function isObj(v) {
  return v && typeof v === 'object' && !Array.isArray(v)
}

export function merge(base, over) {
  if (!isObj(over)) return base
  const out = { ...base }
  for (const [k, v] of Object.entries(over)) {
    if ((k === 'groups' || k === 'employees') && Array.isArray(v)) out[k] = mergeById(base[k] || [], v)
    else out[k] = isObj(v) && isObj(base[k]) ? merge(base[k], v) : v
  }
  return out
}

/** Groups and employees merge by id: the same id updates an entry, a new id adds one. */
export function mergeById(base, over) {
  const out = base.map((w) => ({ ...w }))
  for (const w of over) {
    if (!w || !w.id) continue
    const i = out.findIndex((x) => x.id === w.id)
    if (i === -1) out.push({ ...w })
    else out[i] = { ...out[i], ...w }
  }
  return out
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn(`[傻妞] 读取配置 ${file} 失败：${e.message}`)
    return null
  }
}

/** defaults ← ~/.shaniu/config.json ← <workdir>/shaniu.config.json ← --config file ← CLI flags */
export function loadConfig({ workdir, configFile, overrides = {} }) {
  let cfg = DEFAULTS
  const sources = []
  for (const f of [path.join(os.homedir(), '.shaniu', 'config.json'), path.join(workdir, 'shaniu.config.json'), configFile]) {
    if (!f) continue
    const data = readJson(f)
    if (data) {
      cfg = merge(cfg, data)
      sources.push(f)
    }
  }
  cfg = merge(cfg, overrides)
  cfg.workdir = workdir
  cfg.logDir = path.resolve(expandHome(cfg.logDir))
  cfg.statsFile = path.resolve(expandHome(cfg.statsFile))
  cfg.sources = sources
  return cfg
}
