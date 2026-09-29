import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { modelProfile } from '../models.js'
import { fillEnv, truncate } from '../util.js'

export function shortPath(p, workdir) {
  if (!p) return ''
  let r = String(p)
  if (workdir && r.startsWith(workdir)) r = path.relative(workdir, r) || r
  return truncate(r, 48)
}

/**
 * Shared plumbing for every worker. A worker is one employee (员工): a skill working inside a
 * project group (项目组). The group decides the backend and which model to use per difficulty.
 */
export class BaseWorker {
  constructor(group, { workdir, logDir, autonomy }) {
    this.cfg = group
    this.id = group.id
    this.type = group.type
    this.workdir = workdir
    this.logDir = logDir
    this.autonomy = autonomy || 'full'
    this.procs = new Set()
    this.available = false
    this.version = ''
    this.note = ''
  }

  /** Model for a task of this difficulty: models.hard / models.medium / models.easy, else model. */
  modelFor(difficulty = 'medium') {
    const m = this.cfg.models || {}
    return m[difficulty] || m.medium || this.cfg.model || ''
  }

  profileFor(difficulty = 'medium') {
    return modelProfile({ ...this.cfg, model: this.modelFor(difficulty) })
  }

  /** Extra environment for CLI workers, e.g. ANTHROPIC_BASE_URL for a relay. Values may use ${VAR}. */
  env() {
    return Object.fromEntries(Object.entries(this.cfg.env || {}).map(([k, v]) => [k, fillEnv(String(v))]))
  }

  tmpFile(label) {
    return path.join(os.tmpdir(), `niuma-${process.pid}-${Date.now()}-${this.id}-${label}.txt`)
  }

  openLog(label, prompt) {
    try {
      fs.mkdirSync(this.logDir, { recursive: true })
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const ws = fs.createWriteStream(path.join(this.logDir, `${stamp}-${this.id}-${label}.log`))
      ws.on('error', () => {})
      ws.write(`# ${this.id} (${this.type}) · ${label} · ${this.workdir}\n\n## prompt\n${prompt}\n\n## output\n`)
      return ws
    } catch {
      return null
    }
  }

  track(proc) {
    this.procs.add(proc)
    proc.done.finally(() => this.procs.delete(proc))
    return proc
  }

  stopAll() {
    for (const p of this.procs) p.kill()
  }
}
