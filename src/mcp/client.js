// A small MCP (Model Context Protocol) client over stdio. The built-in API agent uses it to give
// DeepSeek, Qwen and other API models the same plugins (工具) that Claude Code and Codex load themselves.
import { spawn } from 'node:child_process'
import { isWin, killTree, truncate } from '../util.js'

const PROTOCOL = '2025-06-18'

function winQuote(a) {
  a = String(a)
  if (/^[\w\-.:\\/=,@+]+$/.test(a)) return a
  return '"' + a.replace(/"/g, '\\"') + '"'
}

export class McpClient {
  constructor(name, { command, args = [], env = {}, cwd } = {}) {
    this.name = name
    this.command = command
    this.args = args
    this.env = env
    this.cwd = cwd
    this.child = null
    this.nextId = 1
    this.pending = new Map()
    this.stderr = ''
    this.tools = []
    this.closed = false
  }

  async start({ timeoutMs = 120000 } = {}) {
    const env = { ...process.env, ...this.env }
    delete env.CLAUDECODE
    this.child = isWin
      ? spawn([this.command, ...this.args].map(winQuote).join(' '), { cwd: this.cwd, env, shell: true, windowsHide: true })
      : spawn(this.command, this.args, { cwd: this.cwd, env, detached: true })
    const exited = new Promise((resolve) => {
      this.child.on('error', (e) => resolve(e.message))
      this.child.on('close', (code) => resolve(`插件进程退出了（退出码 ${code}）`))
    }).then((why) => {
      this.closed = true
      const err = new Error(`${why}${this.stderr ? `：${truncate(this.stderr.trim().split('\n').pop(), 200)}` : ''}`)
      for (const p of this.pending.values()) p.reject(err)
      this.pending.clear()
      return err
    })
    this.exited = exited
    let buf = ''
    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', (chunk) => {
      buf += chunk
      let i
      while ((i = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (line) this.onMessage(line)
      }
    })
    this.child.stderr.setEncoding('utf8')
    this.child.stderr.on('data', (d) => (this.stderr = (this.stderr + d).slice(-4000)))
    this.child.stdin.on('error', () => {})

    await this.request('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'niuma-studio', version: '0.1.0' } }, timeoutMs)
    this.notify('notifications/initialized')
    const tools = []
    let cursor
    do {
      const r = await this.request('tools/list', cursor ? { cursor } : {}, timeoutMs)
      tools.push(...(r?.tools || []))
      cursor = r?.nextCursor
    } while (cursor)
    this.tools = tools
    return tools
  }

  onMessage(line) {
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    if (msg.id != null && (msg.result !== undefined || msg.error)) {
      const p = this.pending.get(msg.id)
      if (!p) return
      this.pending.delete(msg.id)
      clearTimeout(p.timer)
      if (msg.error) p.reject(new Error(msg.error.message || '插件报错'))
      else p.resolve(msg.result)
    } else if (msg.id != null && msg.method) {
      // Requests from the server: answer the harmless ones, decline the rest.
      if (msg.method === 'ping') this.send({ jsonrpc: '2.0', id: msg.id, result: {} })
      else if (msg.method === 'roots/list') this.send({ jsonrpc: '2.0', id: msg.id, result: { roots: this.cwd ? [{ uri: `file://${this.cwd}`, name: 'project' }] : [] } })
      else this.send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'not supported' } })
    }
  }

  send(obj) {
    if (this.closed || !this.child?.stdin.writable) return
    this.child.stdin.write(JSON.stringify(obj) + '\n')
  }

  notify(method, params) {
    this.send({ jsonrpc: '2.0', method, ...(params ? { params } : {}) })
  }

  request(method, params, timeoutMs = 120000) {
    if (this.closed) return Promise.reject(new Error('插件已经关了'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`插件 ${this.name} 响应超时（${method}）`))
      }, timeoutMs)
      timer.unref?.()
      this.pending.set(id, { resolve, reject, timer })
      this.send({ jsonrpc: '2.0', id, method, params })
    })
  }

  call(tool, args, { timeoutMs = 180000 } = {}) {
    return this.request('tools/call', { name: tool, arguments: args || {} }, timeoutMs)
  }

  close() {
    if (!this.child) return
    this.closed = true
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.reject(new Error('插件已经关了'))
    }
    this.pending.clear()
    try {
      this.child.stdin.end()
    } catch {}
    if (this.child.exitCode === null) killTree(this.child)
  }
}

/** Flatten an MCP tools/call result into text plus any images it carried. */
export function mcpResult(result) {
  const texts = []
  const images = []
  for (const c of result?.content || []) {
    if (c.type === 'text') texts.push(c.text)
    else if (c.type === 'image' && c.data) {
      images.push({ data: c.data, mimeType: c.mimeType || 'image/png' })
      texts.push('[截图]')
    } else if (c.type === 'resource') texts.push(c.resource?.text || `[资源 ${c.resource?.uri || ''}]`)
    else if (c.type === 'resource_link') texts.push(`[链接 ${c.uri || ''}]`)
  }
  if (!texts.length && result?.structuredContent) texts.push(JSON.stringify(result.structuredContent))
  const text = texts.join('\n') || '（没有输出）'
  return { text: result?.isError ? `错误：${text}` : text, images, isError: !!result?.isError }
}
