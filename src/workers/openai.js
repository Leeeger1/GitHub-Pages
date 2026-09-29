// Built-in coding agent for any OpenAI-compatible chat endpoint (relays / 中转站, DeepSeek, Qwen,
// Kimi, GLM, local servers…). The model works through a small toolbox scoped to the project folder.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SAFE_COMMANDS } from '../config.js'
import { SKIP_DIRS, fillEnv, firstLine, runShell, sleep, truncate, killTree } from '../util.js'
import { BaseWorker } from './base.js'

const fn = (name, description, properties, required = []) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
})
const str = (description) => ({ type: 'string', description })
const int = (description) => ({ type: 'integer', description })

export const TOOLS = [
  fn('list_files', '列出目录里的文件和子目录（自动跳过 node_modules、.git 等）', { path: str('相对工作目录的路径，默认 .'), depth: int('递归深度，默认 2') }),
  fn('read_file', '读取文本文件，返回带行号的内容', { path: str('文件路径'), offset: int('从第几行开始，默认 1'), limit: int('最多读多少行，默认 400') }, ['path']),
  fn('write_file', '新建文件或整体覆盖文件（会自动创建目录）', { path: str('文件路径'), content: str('完整的文件内容') }, ['path', 'content']),
  fn(
    'edit_file',
    '把文件里的一段原文精确替换为新内容。old_string 必须和文件里的内容一字不差，并且只出现一次（否则设 replace_all）',
    { path: str('文件路径'), old_string: str('要被替换的原文'), new_string: str('替换后的内容'), replace_all: { type: 'boolean', description: '替换所有出现的地方' } },
    ['path', 'old_string', 'new_string'],
  ),
  fn('search', '按正则表达式搜索文件内容，返回 文件:行号: 内容', { pattern: str('正则表达式'), path: str('在哪个目录下搜，默认 .') }, ['pattern']),
  fn('run_command', '在工作目录里运行一条 shell 命令，返回输出和退出码。不要运行会一直挂着的命令（开发服务器、watch）', { command: str('命令'), timeout_sec: int('超时秒数，默认 120，最多 600') }, ['command']),
]
const WRITE_TOOLS = new Set(['write_file', 'edit_file'])

export function describeTool(name, a = {}) {
  switch (name) {
    case 'list_files':
      return `看目录 ${a.path || '.'}`
    case 'read_file':
      return `读 ${a.path}`
    case 'write_file':
      return `写 ${a.path}`
    case 'edit_file':
      return `改 ${a.path}`
    case 'search':
      return `搜 “${truncate(a.pattern, 30)}”`
    case 'run_command':
      return `跑 ${truncate(String(a.command || '').split('\n')[0], 60)}`
    default:
      return `用工具 ${name}`
  }
}

const clip = (s, n = 16000) => {
  s = String(s ?? '')
  return s.length <= n ? s : `${s.slice(0, n * 0.35)}\n…（中间省略 ${s.length - n} 个字符）…\n${s.slice(-n * 0.65)}`
}

/** File and shell tools, confined to the project folder. */
export class Toolbox {
  constructor(workdir, { readOnly = false, autonomy = 'full', track = () => {} } = {}) {
    this.root = path.resolve(workdir)
    this.readOnly = readOnly
    this.autonomy = autonomy
    this.track = track
  }

  resolve(p) {
    const abs = path.resolve(this.root, String(p || '.'))
    if (abs !== this.root && !abs.startsWith(this.root + path.sep)) throw new Error('只能访问工作目录里面的文件')
    return abs
  }

  async exec(name, a) {
    try {
      if (this.readOnly && WRITE_TOOLS.has(name)) return '错误：这次是只读任务，不能改文件'
      switch (name) {
        case 'list_files':
          return this.listFiles(a)
        case 'read_file':
          return this.readFile(a)
        case 'write_file':
          return this.writeFile(a)
        case 'edit_file':
          return this.editFile(a)
        case 'search':
          return this.search(a)
        case 'run_command':
          return await this.runCommand(a)
        default:
          return `错误：没有叫 ${name} 的工具`
      }
    } catch (e) {
      return `错误：${e.message}`
    }
  }

  listFiles({ path: p = '.', depth = 2 }) {
    const base = this.resolve(p)
    const out = []
    const walk = (dir, d, prefix) => {
      if (out.length >= 400) return
      let entries = fs.readdirSync(dir, { withFileTypes: true })
      entries = entries.filter((e) => !SKIP_DIRS.has(e.name)).sort((x, y) => Number(y.isDirectory()) - Number(x.isDirectory()) || x.name.localeCompare(y.name))
      for (const e of entries) {
        if (out.length >= 400) {
          out.push('…（太多了，只列前 400 项）')
          return
        }
        out.push(prefix + e.name + (e.isDirectory() ? '/' : ''))
        if (e.isDirectory() && d > 1) walk(path.join(dir, e.name), d - 1, prefix + '  ')
      }
    }
    walk(base, Math.max(1, Math.min(Number(depth) || 2, 6)), '')
    return out.length ? out.join('\n') : '（空目录）'
  }

  readFile({ path: p, offset = 1, limit = 400 }) {
    const file = this.resolve(p)
    const stat = fs.statSync(file)
    if (stat.isDirectory()) return '错误：这是一个目录，用 list_files 看'
    if (stat.size > 3 * 1024 * 1024) return `错误：文件太大（${stat.size} 字节）`
    const buf = fs.readFileSync(file)
    if (buf.subarray(0, 8000).includes(0)) return '错误：看起来是二进制文件'
    const lines = buf.toString('utf8').split('\n')
    const start = Math.max(1, Number(offset) || 1)
    const count = Math.max(1, Math.min(Number(limit) || 400, 2000))
    const body = lines
      .slice(start - 1, start - 1 + count)
      .map((l, i) => `${start + i}\t${l}`)
      .join('\n')
    const more = start - 1 + count < lines.length ? `\n…（共 ${lines.length} 行，用 offset 继续读）` : ''
    return clip(body, 60000) + more
  }

  writeFile({ path: p, content }) {
    const file = this.resolve(p)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, String(content ?? ''))
    return `已写入 ${path.relative(this.root, file)}（${String(content ?? '').split('\n').length} 行）`
  }

  editFile({ path: p, old_string: from, new_string: to, replace_all: all }) {
    const file = this.resolve(p)
    const text = fs.readFileSync(file, 'utf8')
    if (!from) return '错误：old_string 不能为空'
    const count = text.split(from).length - 1
    if (count === 0) return '错误：文件里没找到 old_string，先用 read_file 看准原文（注意空格和缩进）'
    if (count > 1 && !all) return `错误：old_string 出现了 ${count} 次，请带上更多上下文让它唯一，或者设 replace_all`
    fs.writeFileSync(file, all ? text.split(from).join(to) : text.replace(from, () => to))
    return `已修改 ${path.relative(this.root, file)}（替换 ${all ? count : 1} 处）`
  }

  search({ pattern, path: p = '.' }) {
    let re
    try {
      re = new RegExp(pattern)
    } catch {
      re = new RegExp(String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    }
    const base = this.resolve(p)
    const hits = []
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (hits.length >= 200 || SKIP_DIRS.has(e.name)) continue
        const full = path.join(dir, e.name)
        if (e.isDirectory()) walk(full)
        else {
          try {
            if (fs.statSync(full).size > 1024 * 1024) continue
            const buf = fs.readFileSync(full)
            if (buf.subarray(0, 4000).includes(0)) continue
            buf
              .toString('utf8')
              .split('\n')
              .forEach((line, i) => {
                if (hits.length < 200 && re.test(line)) hits.push(`${path.relative(this.root, full)}:${i + 1}: ${truncate(line.trim(), 200)}`)
              })
          } catch {}
        }
      }
    }
    fs.statSync(base).isDirectory() ? walk(base) : walk(path.dirname(base))
    return hits.length ? hits.join('\n') : '没有找到'
  }

  async runCommand({ command, timeout_sec: t = 120 }) {
    command = String(command || '').trim()
    if (!command) return '错误：命令是空的'
    if (this.autonomy === 'safe' && !SAFE_COMMANDS.some((p) => command === p || command.startsWith(p + ' '))) {
      return `错误：安全模式下只允许运行这些命令开头的：${SAFE_COMMANDS.join('、')}`
    }
    if (/^\s*(sudo\b|git\s+push\b|git\s+reset\s+--hard|rm\s+-rf\s+[/~])/.test(command)) return '错误：这条命令太危险，不允许自动执行'
    const r = await runShell(command, {
      cwd: this.root,
      timeoutMs: Math.min(Math.max(Number(t) || 120, 5), 600) * 1000,
      onSpawn: (child) => this.track(child),
    })
    return `${r.timedOut ? '（超时，被结束）\n' : ''}退出码 ${r.code}\n${clip(r.out.trim(), 16000) || '（没有输出）'}`
  }
}

function systemPrompt({ workdir, readOnly }) {
  return `你是一名软件工程师，在牛马工作室里干活。
工作目录：${workdir}（${os.platform()}）。你只能通过工具读写这个目录里的文件、运行命令。
做事方式：
- 先了解再动手：用 list_files、search、read_file 看清楚。
- 小改动用 edit_file，新文件或整体重写用 write_file。
- 改完用 run_command 跑测试、构建或脚本来验证。不要运行会一直挂着的命令（开发服务器、watch）。
- 不要向任何人提问，也不要等确认：不确定的地方自己做合理假设，在汇报里说明。
- 做完以后不再调用工具，直接用中文写汇报：做了什么、改了哪些文件、怎么验证的、还有什么风险。${readOnly ? '\n- 这次是只读任务：只能看、跑命令检查，不能改文件。' : ''}`
}

function normalizeBase(url) {
  let u = String(url || '').trim().replace(/\/+$/, '')
  if (/\/chat\/completions$/.test(u)) u = u.replace(/\/chat\/completions$/, '')
  try {
    if (new URL(u).pathname === '/') u += '/v1'
  } catch {}
  return u
}

export class OpenAIWorker extends BaseWorker {
  constructor(group, ctx) {
    super(group, ctx)
    this.aborts = new Set()
    this.children = new Set()
  }

  apiKey() {
    return fillEnv(this.cfg.apiKey || '') || (this.cfg.apiKeyEnv ? process.env[this.cfg.apiKeyEnv] || '' : '')
  }

  base() {
    return normalizeBase(fillEnv(this.cfg.baseUrl || ''))
  }

  headers() {
    const h = { 'Content-Type': 'application/json', ...(this.cfg.headers || {}) }
    const key = this.apiKey()
    if (key) h.Authorization = `Bearer ${key}`
    return h
  }

  async check() {
    const base = this.base()
    if (!base) this.note = '没配 baseUrl'
    else if (!this.modelFor('medium')) this.note = '没配 model'
    else if (!this.apiKey() && !this.cfg.noKey) this.note = `缺少 API Key${this.cfg.apiKeyEnv ? `（环境变量 ${this.cfg.apiKeyEnv}）` : ''}`
    else {
      this.note = ''
      try {
        const r = await fetch(`${base}/models`, { headers: this.headers(), signal: AbortSignal.timeout(10000) })
        if (r.status === 401 || r.status === 403) this.note = 'API Key 被拒绝'
      } catch (e) {
        this.note = `连不上 ${base}`
      }
    }
    this.available = !this.note
    this.version = this.available ? `API · ${this.modelFor('medium')}` : ''
    return this.available
  }

  stopAll() {
    for (const a of this.aborts) a.abort()
    for (const c of this.children) killTree(c)
  }

  async chat(messages, { tools, model, signal }) {
    const body = { model, messages }
    if (tools) Object.assign(body, { tools, tool_choice: 'auto' })
    if (this.cfg.temperature != null) body.temperature = this.cfg.temperature
    if (this.cfg.maxTokens) body.max_tokens = this.cfg.maxTokens
    Object.assign(body, this.cfg.extraBody || {})
    const url = `${this.base()}/chat/completions`
    for (let attempt = 0; ; attempt++) {
      let res
      try {
        res = await fetch(url, { method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal: AbortSignal.any ? AbortSignal.any([signal, AbortSignal.timeout(10 * 60 * 1000)]) : signal })
      } catch (e) {
        if (signal.aborted) throw new Error('被叫停')
        if (attempt < 3) {
          await sleep(1500 * 2 ** attempt)
          continue
        }
        throw new Error(`连不上接口：${e.message}`)
      }
      if (res.ok) {
        const data = await res.json()
        const choice = data.choices?.[0]
        if (!choice) throw new Error(`接口返回里没有结果：${truncate(JSON.stringify(data), 200)}`)
        return { message: choice.message || {}, finish: choice.finish_reason, usage: data.usage || {} }
      }
      const text = await res.text().catch(() => '')
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        const wait = Number(res.headers.get('retry-after')) * 1000 || 2000 * 2 ** attempt
        await sleep(Math.min(wait, 30000))
        continue
      }
      throw new Error(`接口报错 ${res.status}：${truncate(text, 200)}`)
    }
  }

  cost(usage) {
    const p = this.cfg.price
    if (!p) return null
    return ((usage.in || 0) * (p.input || 0) + (usage.out || 0) * (p.output || 0)) / 1e6
  }

  async run({ prompt, model, readOnly = false, onActivity = () => {}, timeoutMs = 30 * 60 * 1000, label = 'task' }) {
    model = model || this.modelFor('medium')
    const log = this.openLog(label, prompt)
    const started = Date.now()
    const ac = new AbortController()
    this.aborts.add(ac)
    const timer = setTimeout(() => ac.abort(), timeoutMs)
    const box = new Toolbox(this.workdir, {
      readOnly,
      autonomy: this.autonomy,
      track: (child) => {
        this.children.add(child)
        child.on('close', () => this.children.delete(child))
      },
    })
    const tools = TOOLS.filter((t) => !(readOnly && WRITE_TOOLS.has(t.function.name)))
    const messages = [
      { role: 'system', content: systemPrompt({ workdir: this.workdir, readOnly }) },
      { role: 'user', content: prompt },
    ]
    const usage = { in: 0, out: 0 }
    let lastText = ''
    const maxSteps = this.cfg.maxSteps || 60
    const finish = (res) => {
      clearTimeout(timer)
      this.aborts.delete(ac)
      res.durationMs = Date.now() - started
      res.usage = usage
      res.cost = this.cost(usage)
      log?.end(`\n## result\n${JSON.stringify({ ...res, text: truncate(res.text, 2000) }, null, 2)}\n`)
      return res
    }
    try {
      for (let step = 0; step < maxSteps; step++) {
        this.trim(messages)
        const { message, usage: u } = await this.chat(messages, { tools, model, signal: ac.signal })
        usage.in += u.prompt_tokens || 0
        usage.out += u.completion_tokens || 0
        const calls = Array.isArray(message.tool_calls) ? message.tool_calls : []
        const text = typeof message.content === 'string' ? message.content.trim() : ''
        if (text) lastText = text
        log?.write(`\n[assistant] ${text}\n`)
        messages.push({ role: 'assistant', content: message.content ?? null, ...(calls.length ? { tool_calls: calls } : {}) })
        if (!calls.length) return finish({ ok: true, text: lastText })
        if (text) onActivity({ kind: 'say', text: firstLine(text) })
        for (const call of calls) {
          const name = call.function?.name
          let args = null
          try {
            args = JSON.parse(call.function?.arguments || '{}')
          } catch {}
          let out
          if (!args) out = '错误：参数不是合法的 JSON（可能输出太长被截断了）。大文件请分几次写。'
          else {
            onActivity({ kind: 'tool', text: describeTool(name, args) })
            out = await box.exec(name, args)
          }
          log?.write(`[tool ${name}] ${truncate(JSON.stringify(args), 300)}\n${truncate(out, 600)}\n`)
          messages.push({ role: 'tool', tool_call_id: call.id, content: out })
        }
      }
      return finish({ ok: false, text: lastText, error: `用完 ${maxSteps} 步还没做完` })
    } catch (e) {
      return finish({ ok: false, text: lastText, error: ac.signal.aborted ? (Date.now() - started >= timeoutMs ? '超时了' : '被叫停') : e.message })
    }
  }

  /** Keep long conversations under the context budget by blanking out old tool output. */
  trim(messages) {
    const budget = this.cfg.maxContextChars || 300000
    let size = messages.reduce((n, m) => n + (typeof m.content === 'string' ? m.content.length : 0), 0)
    for (let i = 2; i < messages.length - 8 && size > budget; i++) {
      const m = messages[i]
      if (m.role === 'tool' && m.content.length > 200) {
        size -= m.content.length - 30
        m.content = '（早先的输出已省略）'
      }
    }
  }

  async ask(prompt, { model, timeoutMs = 5 * 60 * 1000, label = 'ask' } = {}) {
    const log = this.openLog(label, prompt)
    const ac = new AbortController()
    this.aborts.add(ac)
    const timer = setTimeout(() => ac.abort(), timeoutMs)
    try {
      const { message } = await this.chat([{ role: 'user', content: prompt }], { model: model || this.modelFor('medium'), signal: ac.signal })
      const text = typeof message.content === 'string' ? message.content : ''
      log?.end(text)
      return text
    } catch (e) {
      log?.end(`ERROR ${e.message}`)
      throw ac.signal.aborted ? new Error('被叫停') : e
    } finally {
      clearTimeout(timer)
      this.aborts.delete(ac)
    }
  }
}
