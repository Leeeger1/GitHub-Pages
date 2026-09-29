import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnCmd, truncate, firstLine } from './util.js'

export const AGENT_NAMES = { claude: 'Claude', codex: 'Codex', mavis: 'Mavis' }

function shortPath(p, workdir) {
  if (!p) return ''
  let r = String(p)
  if (workdir && r.startsWith(workdir)) r = path.relative(workdir, r) || r
  return truncate(r, 48)
}

function cleanCmd(cmd) {
  if (Array.isArray(cmd)) cmd = cmd.join(' ')
  cmd = String(cmd || '').trim()
  const sh = cmd.match(/^(?:\S*\/)?(?:bash|zsh|sh)\s+-l?c\s+(['"])([\s\S]*)\1$/)
  if (sh) return sh[2]
  const ps = cmd.match(/-Command\s+(['"]?)([\s\S]*)\1$/i)
  if (ps) return ps[2]
  return cmd
}

export function describeClaudeTool(name, input = {}, workdir) {
  const p = shortPath(input.file_path || input.notebook_path || input.path, workdir)
  switch (name) {
    case 'Read':
      return `读 ${p}`
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return `改 ${p}`
    case 'Write':
      return `写 ${p}`
    case 'Bash': {
      const c = cleanCmd(input.command).split('\n')[0]
      return `跑 ${truncate(c.length <= 50 || !input.description ? c : input.description, 60)}`
    }
    case 'Grep':
      return `搜 “${truncate(input.pattern, 30)}”`
    case 'Glob':
      return `找文件 ${truncate(input.pattern, 30)}`
    case 'WebSearch':
      return `上网查 ${truncate(input.query, 40)}`
    case 'WebFetch':
      return `看网页 ${truncate(input.url, 40)}`
    case 'TodoWrite':
      return '列待办清单'
    case 'Task':
    case 'Agent':
      return `叫了个帮手：${truncate(input.description, 30)}`
    default:
      return `用工具 ${name}`
  }
}

/** Parser for `claude -p --output-format stream-json --verbose`. */
export function createClaudeParser(workdir) {
  let result = null
  let lastText = ''
  let sessionId = ''
  return {
    feed(line) {
      let ev
      try {
        ev = JSON.parse(line)
      } catch {
        return []
      }
      const out = []
      if (ev.type === 'system' && ev.subtype === 'init') sessionId = ev.session_id || ''
      else if (ev.type === 'assistant') {
        for (const b of ev.message?.content || []) {
          if (b.type === 'tool_use') out.push({ kind: 'tool', text: describeClaudeTool(b.name, b.input || {}, workdir) })
          else if (b.type === 'text' && b.text?.trim()) {
            lastText = b.text
            out.push({ kind: 'say', text: firstLine(b.text) })
          } else if (b.type === 'thinking') out.push({ kind: 'think', text: '思考中…' })
        }
      } else if (ev.type === 'result') result = ev
      return out
    },
    finish({ code, stderr }) {
      const ok = !!result && !result.is_error && (result.subtype ?? 'success') === 'success'
      const text = (typeof result?.result === 'string' && result.result) || lastText
      let error = ''
      if (!ok) {
        error = result?.subtype && result.subtype !== 'success' ? `Claude 结束状态：${result.subtype}` : ''
        if (!error) error = firstLine(stderr, 200) || `claude 退出码 ${code}`
      }
      return { ok, text, error, cost: result?.total_cost_usd ?? null, sessionId }
    },
  }
}

/** Parser for `codex exec --json` (thread/turn/item events, plus the older {msg:{…}} shape). */
export function createCodexParser(workdir) {
  let lastMessage = ''
  let failed = ''
  let lastError = ''
  let usage = null
  let sessionId = ''
  return {
    feed(line) {
      let ev
      try {
        ev = JSON.parse(line)
      } catch {
        return []
      }
      const out = []
      const it = ev.item || {}
      switch (ev.type) {
        case 'thread.started':
          sessionId = ev.thread_id || ''
          break
        case 'item.started':
          if (it.type === 'command_execution') out.push({ kind: 'tool', text: `跑 ${truncate(cleanCmd(it.command).split('\n')[0], 60)}` })
          else if (it.type === 'mcp_tool_call') out.push({ kind: 'tool', text: `调用 ${it.server || ''}.${it.tool || ''}` })
          else if (it.type === 'web_search') out.push({ kind: 'tool', text: `上网查 ${truncate(it.query, 40)}` })
          break
        case 'item.completed':
          if (it.type === 'agent_message') {
            lastMessage = it.text || lastMessage
            out.push({ kind: 'say', text: firstLine(it.text) })
          } else if (it.type === 'file_change') {
            const files = (it.changes || []).map((c) => shortPath(c.path, workdir)).join('、')
            out.push({ kind: 'tool', text: `改 ${truncate(files, 60)}` })
          } else if (it.type === 'reasoning') out.push({ kind: 'think', text: firstLine(it.text, 50) || '思考中…' })
          else if (it.type === 'command_execution' && it.exit_code != null && it.exit_code !== 0)
            out.push({ kind: 'warn', text: `命令没跑通（退出码 ${it.exit_code}）` })
          else if (it.type === 'todo_list') out.push({ kind: 'tool', text: '列待办清单' })
          else if (it.type === 'error') out.push({ kind: 'warn', text: truncate(it.message, 80) })
          break
        case 'turn.completed':
          usage = ev.usage || null
          break
        case 'turn.failed':
          failed = ev.error?.message || '这一轮失败了'
          break
        case 'error':
          lastError = ev.message || ''
          out.push({ kind: 'warn', text: truncate(lastError, 80) })
          break
        default:
          if (ev.msg) {
            const m = ev.msg
            if (m.type === 'agent_message') {
              lastMessage = m.message || lastMessage
              out.push({ kind: 'say', text: firstLine(m.message) })
            } else if (m.type === 'exec_command_begin') out.push({ kind: 'tool', text: `跑 ${truncate(cleanCmd(m.command), 60)}` })
            else if (m.type === 'patch_apply_begin') out.push({ kind: 'tool', text: `改 ${Object.keys(m.changes || {}).map((p) => shortPath(p, workdir)).join('、')}` })
            else if (m.type === 'error') failed = m.message || 'error'
          }
      }
      return out
    },
    finish({ code, stderr }, lastMessageFile) {
      let text = ''
      try {
        text = fs.readFileSync(lastMessageFile, 'utf8').trim()
      } catch {}
      text = text || lastMessage
      const ok = code === 0 && !failed
      const error = ok ? '' : failed || lastError || firstLine(stderr, 200) || `codex 退出码 ${code}`
      return { ok, text, error, usage, sessionId }
    },
  }
}

export class AgentRunner {
  constructor(id, cfg, { workdir, logDir }) {
    this.id = id
    this.cfg = cfg
    this.workdir = workdir
    this.logDir = logDir
    this.procs = new Set()
    this.available = false
    this.version = ''
  }

  async check() {
    const r = await spawnCmd(this.cfg.command, ['--version'], { cwd: this.workdir, collect: true, timeoutMs: 20000 }).done
    this.available = r.code === 0
    this.version = this.available ? firstLine(r.stdout, 40) : ''
    return { available: this.available, version: this.version, error: this.available ? '' : firstLine(r.stderr, 120) }
  }

  tmpFile(label) {
    return path.join(os.tmpdir(), `mavis-${process.pid}-${Date.now()}-${label}.txt`)
  }

  openLog(label, prompt) {
    try {
      fs.mkdirSync(this.logDir, { recursive: true })
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const file = path.join(this.logDir, `${stamp}-${this.id}-${label}.log`)
      const ws = fs.createWriteStream(file)
      ws.on('error', () => {})
      ws.write(`# ${this.id} · ${label} · ${this.workdir}\n\n## prompt\n${prompt}\n\n## output\n`)
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

  /** Run a real task with streaming progress. */
  async run({ prompt, readOnly = false, onActivity = () => {}, timeoutMs, label = 'task' }) {
    const log = this.openLog(label, prompt)
    const started = Date.now()
    let parser
    let args
    let outFile
    if (this.id === 'claude') {
      parser = createClaudeParser(this.workdir)
      args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', this.cfg.permissionMode || 'acceptEdits']
      if (this.cfg.model) args.push('--model', this.cfg.model)
      if (this.cfg.allowedTools?.length) args.push('--allowedTools', ...this.cfg.allowedTools)
      if (readOnly) args.push('--disallowedTools', 'Edit,Write,MultiEdit,NotebookEdit')
      args.push(...(this.cfg.extraArgs || []))
    } else {
      parser = createCodexParser(this.workdir)
      outFile = this.tmpFile(label)
      args = ['exec', '--json', '--skip-git-repo-check', '-C', this.workdir, '-o', outFile, '-s', readOnly ? 'read-only' : this.cfg.sandbox || 'workspace-write']
      if (this.cfg.model) args.push('-m', this.cfg.model)
      args.push(...(this.cfg.extraArgs || []), '-')
    }
    const proc = this.track(
      spawnCmd(this.cfg.command, args, {
        cwd: this.workdir,
        input: prompt,
        timeoutMs,
        onLine: (line) => {
          log?.write(line + '\n')
          for (const a of parser.feed(line)) onActivity(a)
        },
      }),
    )
    const r = await proc.done
    const res = parser.finish(r, outFile)
    if (outFile) fs.rm(outFile, { force: true }, () => {})
    if (r.timedOut) Object.assign(res, { ok: false, error: '超时了，被 Mavis 叫停' })
    else if (r.killed) Object.assign(res, { ok: false, error: '被叫停' })
    else if (r.error?.code === 'ENOENT') Object.assign(res, { ok: false, error: `找不到命令 ${this.cfg.command}` })
    log?.end(`\n## stderr\n${r.stderr}\n\n## result (${Date.now() - started}ms)\n${JSON.stringify(res, null, 2)}\n`)
    res.durationMs = Date.now() - started
    return res
  }

  /** One-shot question with no file edits — used for planning and summaries. */
  async ask(prompt, { model, timeoutMs = 5 * 60 * 1000, label = 'ask' } = {}) {
    const log = this.openLog(label, prompt)
    let args
    let outFile
    if (this.id === 'claude') {
      args = ['-p', '--output-format', 'json', '--disallowedTools', 'Bash,Edit,Write,MultiEdit,NotebookEdit,WebFetch,WebSearch,Task,Agent']
      if (model || this.cfg.model) args.push('--model', model || this.cfg.model)
    } else {
      outFile = this.tmpFile(label)
      args = ['exec', '--skip-git-repo-check', '-C', this.workdir, '-s', 'read-only', '-o', outFile]
      if (model || this.cfg.model) args.push('-m', model || this.cfg.model)
      args.push('-')
    }
    const proc = this.track(spawnCmd(this.cfg.command, args, { cwd: this.workdir, input: prompt, collect: true, timeoutMs }))
    const r = await proc.done
    log?.end(`${r.stdout}\n\n## stderr\n${r.stderr}\n`)
    if (r.killed || r.timedOut) throw new Error(r.timedOut ? '想太久超时了' : '被叫停')
    if (this.id === 'claude') {
      let obj = null
      try {
        obj = JSON.parse(r.stdout)
      } catch {}
      if (Array.isArray(obj)) obj = obj.findLast?.((e) => e.type === 'result') || obj[obj.length - 1]
      if (!obj) throw new Error(firstLine(r.stderr, 200) || `claude 退出码 ${r.code}`)
      if (obj.is_error) throw new Error(firstLine(obj.result, 200) || 'claude 返回了错误')
      return String(obj.result ?? '')
    }
    let text = ''
    try {
      text = fs.readFileSync(outFile, 'utf8')
    } catch {}
    fs.rm(outFile, { force: true }, () => {})
    if (r.code !== 0 && !text) throw new Error(firstLine(r.stderr, 200) || `codex 退出码 ${r.code}`)
    return text || r.stdout
  }
}
