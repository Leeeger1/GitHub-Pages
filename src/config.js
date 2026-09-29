import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expandHome } from './util.js'

export const DEFAULTS = {
  port: 7777,
  host: '127.0.0.1',
  // Who does Mavis's thinking (planning + summaries): "claude" or "codex". Falls back to the other one.
  planner: 'claude',
  plannerModel: '',
  // Let Claude and Codex work at the same time when tasks don't depend on each other.
  parallel: true,
  // After a review asks for changes: how many fix → re-review rounds to allow.
  maxFixRounds: 1,
  // Ask the planner to write the end-of-round report (otherwise a plain template is used).
  summarize: true,
  // Pause before each hand-off so Mavis has time to walk over in the office view.
  dispatchDelayMs: 1500,
  taskTimeoutMin: 30,
  historyRounds: 6,
  logDir: '~/.mavis/logs',
  agents: {
    claude: {
      enabled: true,
      command: 'claude',
      model: '',
      // acceptEdits: edits files freely, only the Bash commands listed below run without asking.
      // Use "bypassPermissions" to let Claude run any command (only in projects you trust).
      permissionMode: 'acceptEdits',
      allowedTools: [
        'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git show:*)',
        'Bash(ls:*)', 'Bash(cat:*)', 'Bash(mkdir:*)',
        'Bash(npm:*)', 'Bash(npx:*)', 'Bash(pnpm:*)', 'Bash(yarn:*)', 'Bash(node:*)',
        'Bash(python:*)', 'Bash(python3:*)', 'Bash(pip:*)', 'Bash(pytest:*)',
        'Bash(go:*)', 'Bash(cargo:*)', 'Bash(make:*)',
      ],
      extraArgs: [],
      strengths: '理解模糊需求、架构设计、跨多个文件的改动和重构、前端界面、写文档、代码审查、解释复杂逻辑',
    },
    codex: {
      enabled: true,
      command: 'codex',
      model: '',
      // read-only | workspace-write | danger-full-access
      sandbox: 'workspace-write',
      extraArgs: [],
      strengths: '快速实现目标明确的功能、写脚本和测试、跑命令定位报错、算法和数据处理、性能优化、代码审查',
    },
  },
}

function isObj(v) {
  return v && typeof v === 'object' && !Array.isArray(v)
}

export function merge(base, over) {
  if (!isObj(over)) return base
  const out = { ...base }
  for (const [k, v] of Object.entries(over)) out[k] = isObj(v) && isObj(base[k]) ? merge(base[k], v) : v
  return out
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn(`[mavis] 读取配置 ${file} 失败：${e.message}`)
    return null
  }
}

/** defaults ← ~/.mavis/config.json ← <workdir>/mavis.config.json ← --config file ← CLI flags */
export function loadConfig({ workdir, configFile, overrides = {} }) {
  let cfg = DEFAULTS
  const sources = []
  for (const f of [path.join(os.homedir(), '.mavis', 'config.json'), path.join(workdir, 'mavis.config.json'), configFile]) {
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
  cfg.sources = sources
  return cfg
}
