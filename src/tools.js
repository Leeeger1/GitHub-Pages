// 工具柜: plugins (MCP servers) that 傻妞 hands out with a task when the job needs them.
// Built in: 浏览器 (Playwright MCP, downloaded by npx on first use) and 电脑操作 (src/mcp/desktop.js).
// Also found automatically: plugins the boss already installed in Claude Code or Codex.
// Each run gets exactly the tools its task needs; nothing is written into Claude Code's or Codex's own settings.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fillEnv, isWin, truncate } from './util.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ALL_TYPES = ['claude-cli', 'codex-cli', 'openai-api']

function npx(pkg, extra = []) {
  // Claude Code and Codex start MCP servers without a shell, so on Windows npx needs cmd /c.
  return isWin ? { command: 'cmd', args: ['/c', 'npx', '-y', pkg, ...extra] } : { command: 'npx', args: ['-y', pkg, ...extra] }
}

export function builtinTools() {
  const headless = process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY
  // Page snapshots and screenshots go here instead of cluttering the project (and its git save points).
  const out = path.join(os.homedir(), '.niuma', 'browser')
  return {
    browser: {
      name: '浏览器',
      server: 'niuma_browser',
      description: '真的打开一个浏览器：打开网址、点按钮、填表单、读网页内容、截图。适合测试自己做的网页、在网站上查资料或办事、网页自动化。',
      keywords: ['浏览器', '网页', '网站', '网址', 'http', '打开网', '点击', '表单', '登录', '截图', '爬', 'browser'],
      // file:// access lets employees check the HTML pages they just wrote without starting a server.
      ...npx('@playwright/mcp@latest', ['--output-dir', out, '--allow-unrestricted-file-access', ...(headless ? ['--headless'] : [])]),
    },
    desktop: {
      name: '电脑操作',
      server: 'niuma_desktop',
      description: '看电脑屏幕截图、移动鼠标、点击、打字、按快捷键、打开软件。适合操作没有命令行的桌面软件（办公软件、聊天软件、设计软件等）。会接管主人的鼠标键盘，能用命令行或浏览器解决的就不要用它。',
      keywords: ['桌面', '电脑', '屏幕', '鼠标', '键盘', '软件', '微信', 'excel', 'word', 'ppt', '剪映', 'photoshop', '记事本', '窗口'],
      command: process.execPath,
      args: [path.join(HERE, 'mcp', 'desktop.js')],
      vision: true,
      takesOver: true,
    },
  }
}

// ---- plugins the boss already installed ------------------------------------------------------------

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/** MCP servers from Claude Code: ~/.claude.json (user + this project's local scope) and <project>/.mcp.json. */
export function claudeServers(workdir, home = os.homedir()) {
  const out = {}
  const j = readJson(path.join(home, '.claude.json'))
  Object.assign(out, j?.mcpServers || {})
  const proj = j?.projects?.[workdir] || j?.projects?.[path.resolve(workdir)]
  Object.assign(out, proj?.mcpServers || {})
  // Project-scope servers only load after the boss approved them in Claude Code.
  const mcp = readJson(path.join(workdir, '.mcp.json'))
  const approved = new Set(proj?.enabledMcpjsonServers || [])
  for (const [name, def] of Object.entries(mcp?.mcpServers || {})) {
    if (approved.has(name) || proj?.enableAllProjectMcpServers) out[name] = def
  }
  return out
}

/** MCP servers from Codex's ~/.codex/config.toml ([mcp_servers.<name>] tables; simple values only). */
export function codexServers(home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')) {
  let text
  try {
    text = fs.readFileSync(path.join(home, 'config.toml'), 'utf8')
  } catch {
    return {}
  }
  const out = {}
  let cur = null
  let sub = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '').trim()
    if (!line || line.startsWith('#')) continue
    const head = line.match(/^\[\s*mcp_servers\.("?)([^".\]]+)\1(?:\.(\w+))?\s*\]$/)
    if (head) {
      cur = out[head[2]] ||= {}
      sub = head[3] || null
      if (sub) cur[sub] ||= {}
      continue
    }
    if (line.startsWith('[')) {
      cur = null
      continue
    }
    if (!cur) continue
    const kv = line.match(/^("?)([\w-]+)\1\s*=\s*(.+)$/)
    if (!kv) continue
    let value
    try {
      value = JSON.parse(kv[3].replace(/^'([^']*)'$/, (_, s) => JSON.stringify(s)))
    } catch {
      const t = kv[3].match(/^\{(.*)\}$/)
      if (t) {
        value = {}
        for (const m of t[1].matchAll(/("?)([\w-]+)\1\s*=\s*"([^"]*)"/g)) value[m[2]] = m[3]
      } else continue
    }
    if (sub) cur[sub][kv[2]] = value
    else cur[kv[2]] = value
  }
  return out
}

const stdio = (def) => def && typeof def.command === 'string' && (!def.type || def.type === 'stdio')

// ---- the catalog -------------------------------------------------------------------------------------

export class ToolCatalog {
  /**
   * @param config  niuma config; `tools` may override built-ins ({ browser: { enabled: false } }),
   *                add plugins ({ mydb: { name, description, command, args, env } }) and set discover: false.
   */
  constructor(config = {}, { workdir = config.workdir || process.cwd(), home } = {}) {
    const cfg = config.tools || {}
    this.tools = new Map()
    const add = (id, def) => {
      if (!def || def.enabled === false) return
      const server = String(def.server || id).replace(/[^\w-]/g, '_')
      this.tools.set(id, {
        id,
        name: def.name || id,
        description: def.description || `插件 ${id}`,
        keywords: def.keywords || [],
        server,
        command: def.command,
        args: def.args || [],
        env: def.env || {},
        // Worker types that already load this plugin themselves (it was installed in their own settings).
        native: def.native || [],
        types: def.types || ALL_TYPES,
        vision: !!def.vision,
        takesOver: !!def.takesOver,
        source: def.source || 'config',
      })
    }
    for (const [id, def] of Object.entries(builtinTools())) {
      const over = cfg[id]
      if (over === false) continue
      add(id, { ...def, ...(over && typeof over === 'object' ? over : {}), source: 'builtin' })
    }
    // Controlling the mouse and keyboard is off in safe mode.
    if (config.autonomy === 'safe') this.tools.delete('desktop')
    for (const [id, def] of Object.entries(cfg)) {
      if (id === 'discover' || this.tools.has(id) || builtinTools()[id] || !def || typeof def !== 'object') continue
      if (!stdio(def)) continue
      add(id, { ...def, source: 'config' })
    }
    if (cfg.discover !== false) {
      const found = [
        [claudeServers(workdir, home), 'claude-cli'],
        [codexServers(home ? path.join(home, '.codex') : undefined), 'codex-cli'],
      ]
      for (const [servers, type] of found) {
        for (const [name, def] of Object.entries(servers)) {
          const id = name.replace(/[^\w-]/g, '_')
          const have = [...this.tools.values()].find((t) => t.server === id)
          if (have) {
            if (have.source === 'installed' && !have.native.includes(type)) have.native.push(type)
            continue
          }
          const portable = stdio(def)
          add(id, {
            name,
            description: `主人自己装在 ${type === 'claude-cli' ? 'Claude Code' : 'Codex'} 里的插件「${name}」`,
            server: id,
            command: portable ? def.command : undefined,
            args: Array.isArray(def.args) ? def.args.map(String) : [],
            env: def.env && typeof def.env === 'object' ? def.env : {},
            native: [type],
            // A remote (http/sse) plugin only works where it was installed.
            types: portable ? ALL_TYPES : [type],
            source: 'installed',
          })
        }
      }
    }
  }

  list() {
    return [...this.tools.values()]
  }

  get(id) {
    return this.tools.get(id) || null
  }

  /** Map whatever the planner wrote (id, 中文名, server name) to tool ids, dropping unknown ones. */
  resolve(refs) {
    const list = Array.isArray(refs) ? refs : refs ? [refs] : []
    const out = []
    for (const r of list) {
      const s = String(r || '').trim().toLowerCase()
      if (!s) continue
      const t = this.list().find((x) => x.id.toLowerCase() === s || x.name.toLowerCase() === s || x.server.toLowerCase() === s)
      if (t && !out.includes(t.id)) out.push(t.id)
    }
    return out
  }

  /** Can a project group hand this tool to its employees? */
  supports(group, id) {
    const t = this.get(id)
    if (!t || !group) return false
    if (!t.types.includes(group.type)) return false
    if (t.native.includes(group.type)) return true
    if (!t.command) return false
    // Tools that return screenshots need a model that can see images.
    if (t.vision && group.type !== 'claude-cli' && !group.cfg?.vision) return false
    return true
  }

  /** For @员工 requests that skip planning: guess tools from the wording. */
  guess(text) {
    const s = String(text || '').toLowerCase()
    return this.list()
      .filter((t) => t.keywords.some((k) => s.includes(String(k).toLowerCase())))
      .map((t) => t.id)
  }

  /** The command line a worker should start for this tool (env values may use ${VAR}). */
  spec(id) {
    const t = this.get(id)
    if (!t?.command) return null
    return { command: t.command, args: t.args.map(String), env: Object.fromEntries(Object.entries(t.env).map(([k, v]) => [k, fillEnv(String(v))])) }
  }
}

// ---- how tool calls look in the speech bubbles ------------------------------------------------------

const BROWSER_ZH = {
  browser_navigate: (a) => `打开网页 ${truncate(a.url, 40)}`,
  browser_navigate_back: () => '网页后退',
  browser_click: (a) => `点 ${truncate(a.element || a.ref, 30)}`,
  browser_type: (a) => `输入 “${truncate(a.text, 24)}”`,
  browser_fill_form: () => '填表单',
  browser_select_option: (a) => `选择 ${truncate([].concat(a.values || []).join('、'), 24)}`,
  browser_press_key: (a) => `按 ${a.key}`,
  browser_hover: (a) => `悬停 ${truncate(a.element, 30)}`,
  browser_snapshot: () => '看网页内容',
  browser_take_screenshot: () => '网页截图',
  browser_wait_for: () => '等网页加载',
  browser_tabs: () => '切换标签页',
  browser_close: () => '关掉浏览器',
  browser_evaluate: () => '在网页里跑脚本',
  browser_file_upload: () => '上传文件',
  browser_install: () => '安装浏览器',
  browser_console_messages: () => '看网页控制台',
  browser_network_requests: () => '看网络请求',
  browser_resize: () => '调整窗口大小',
  browser_drag: () => '在网页里拖动',
  browser_handle_dialog: () => '处理弹窗',
}
const DESKTOP_ZH = {
  screenshot: () => '看屏幕',
  click: (a) => `${a.double ? '双击' : a.button === 'right' ? '右键点' : '点击'}屏幕 (${a.x}, ${a.y})`,
  move: (a) => `移动鼠标到 (${a.x}, ${a.y})`,
  drag: () => '拖动鼠标',
  scroll: (a) => `滚动${{ up: '上', down: '下', left: '左', right: '右' }[a.direction] || ''}`,
  type: (a) => `打字 “${truncate(a.text, 24)}”`,
  key: (a) => `按 ${a.keys}`,
  open: (a) => `打开 ${truncate(a.target, 30)}`,
  wait: () => '等一下',
}

export function describeMcpCall(server, tool, args = {}) {
  const s = String(server || '')
  const a = args && typeof args === 'object' ? args : {}
  try {
    if (/browser|playwright/i.test(s) && BROWSER_ZH[tool]) return BROWSER_ZH[tool](a)
    if (/desktop/i.test(s) && DESKTOP_ZH[tool]) return DESKTOP_ZH[tool](a)
  } catch {}
  return `用插件 ${s}.${tool}`
}

/** Split a Claude Code tool name like mcp__niuma_browser__browser_click. */
export function splitMcpName(name) {
  const m = String(name || '').match(/^mcp__(.+?)__(.+)$/)
  return m ? { server: m[1], tool: m[2] } : null
}
