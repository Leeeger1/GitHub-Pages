// 接入员工：网页（和桌面版）里的「接入员工」面板背后的活。
// 一键安装 / 登录 Claude Code、Codex，填网址和 Key 接入 API 员工，测试连接；
// 改动写进 ~/.niuma/config.json，然后让傻妞马上重新点名，不用重启。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { isWin, truncate } from './util.js'

export const PRESETS = [
  { id: 'deepseek', name: 'DeepSeek', group: 'DeepSeek 组', baseUrl: 'https://api.deepseek.com', models: { hard: 'deepseek-v4-pro', medium: 'deepseek-v4-flash', easy: 'deepseek-v4-flash' }, keyUrl: 'https://platform.deepseek.com/api_keys', note: '便宜，写代码很能打' },
  { id: 'qwen', name: '通义千问', group: '通义组', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: { hard: 'qwen3-max', medium: 'qwen3-coder-plus', easy: 'qwen-flash' }, keyUrl: 'https://bailian.console.aliyun.com/', note: '阿里云百炼' },
  { id: 'kimi', name: 'Kimi', group: 'Kimi 组', baseUrl: 'https://api.moonshot.cn/v1', models: { hard: 'kimi-k3', medium: 'kimi-k3', easy: 'kimi-k3' }, keyUrl: 'https://platform.moonshot.cn/console/api-keys', note: '月之暗面' },
  { id: 'glm', name: '智谱 GLM', group: '智谱组', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', models: { hard: 'glm-5.2', medium: 'glm-4.7', easy: 'glm-4.5-air' }, keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys', note: '智谱开放平台' },
  { id: 'siliconflow', name: '硅基流动', group: '硅基组', baseUrl: 'https://api.siliconflow.cn/v1', models: { hard: '', medium: 'Qwen/Qwen3-Coder-480B-A35B-Instruct', easy: '' }, keyUrl: 'https://cloud.siliconflow.cn/account/ak', note: '一个 Key 用很多开源模型' },
  { id: 'openrouter', name: 'OpenRouter', group: 'OpenRouter 组', baseUrl: 'https://openrouter.ai/api/v1', models: { hard: '', medium: 'deepseek/deepseek-v4-pro', easy: '' }, keyUrl: 'https://openrouter.ai/keys', note: '海外聚合平台' },
  { id: 'relay', name: '中转站', group: '中转站组', baseUrl: '', models: { hard: '', medium: '', easy: '' }, custom: true, note: '填中转站给你的地址、Key 和模型名' },
  { id: 'ollama', name: '本地模型', group: '本地组', baseUrl: 'http://localhost:11434/v1', models: { hard: '', medium: 'qwen3-coder', easy: '' }, noKey: true, maxParallel: 1, note: 'Ollama / LM Studio，不用 Key' },
  { id: 'custom', name: '自定义', group: '', baseUrl: '', models: { hard: '', medium: '', easy: '' }, custom: true, note: '任何 OpenAI 兼容接口' },
]

const CLI = {
  claude: { name: 'Claude Code', pkg: '@anthropic-ai/claude-code', login: 'claude', loginHint: '在弹出的窗口里按提示登录；已经登录过的话，输入 /login 可以换账号。登录好关掉窗口，回来点「重新检查」。' },
  codex: { name: 'Codex', pkg: '@openai/codex', login: 'codex login', loginHint: '会打开浏览器让你登录 ChatGPT 账号。登录好关掉窗口，回来点「重新检查」。' },
}

export const userConfigFile = () => path.join(os.homedir(), '.niuma', 'config.json')

/** Windows 上刚装好的 Node / npm 全局命令不会出现在已经打开的程序的 PATH 里，补上常见目录。 */
export function ensurePath() {
  if (!isWin) return
  const extra = [path.join(process.env.APPDATA || '', 'npm'), path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs')]
  const parts = (process.env.PATH || '').split(';')
  for (const d of extra) if (d && fs.existsSync(d) && !parts.some((p) => p.toLowerCase() === d.toLowerCase())) parts.push(d)
  process.env.PATH = parts.join(';')
}

function run(cmd, args, { timeoutMs = 15000, onLine, cwd = os.tmpdir(), input } = {}) {
  return new Promise((resolve) => {
    const env = { ...process.env }
    delete env.CLAUDECODE
    delete env.ELECTRON_RUN_AS_NODE
    let child
    try {
      child = isWin ? spawn([cmd, ...args].join(' '), { shell: true, cwd, env, windowsHide: true }) : spawn(cmd, args, { cwd, env })
    } catch (e) {
      return resolve({ ok: false, code: -1, out: e.message })
    }
    let out = ''
    let buf = ''
    const feed = (d) => {
      const s = d.toString()
      out = (out + s).slice(-20000)
      if (!onLine) return
      buf += s
      let i
      while ((i = buf.search(/\r?\n/)) !== -1) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1).replace(/^\n/, '')
        if (line) onLine(line)
      }
    }
    child.stdout?.on('data', feed)
    child.stderr?.on('data', feed)
    child.stdin?.on('error', () => {})
    if (input != null) child.stdin?.end(input)
    else child.stdin?.end()
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {}
    }, timeoutMs)
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ ok: false, code: -1, out: out + e.message, missing: e.code === 'ENOENT' })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (onLine && buf.trim()) onLine(buf.trim())
      // cmd.exe 找不到命令时退出码 9009；sh 是 127。
      resolve({ ok: code === 0, code, out, missing: code === 127 || code === 9009 })
    })
  })
}

/** npm 装好的全局命令所在目录也加进 PATH：有的电脑上它不在已经打开的程序的 PATH 里，装完了却找不到。 */
async function addNpmBin() {
  const r = await run('npm', ['prefix', '-g'])
  const prefix = r.ok ? r.out.trim().split(/\r?\n/).pop().trim() : ''
  if (!prefix) return
  const dir = isWin ? prefix : path.join(prefix, 'bin')
  const parts = (process.env.PATH || '').split(path.delimiter)
  if (!parts.includes(dir)) process.env.PATH = [...parts, dir].join(path.delimiter)
}

const version = (r) => (r.ok ? (r.out.match(/\d+\.\d+\.\d+[\w.-]*/) || [r.out.trim().split('\n')[0]])[0] : '')

function loggedIn(tool) {
  const home = os.homedir()
  if (tool === 'claude') {
    if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return true
    if (fs.existsSync(path.join(home, '.claude', '.credentials.json'))) return true
    // macOS 把登录信息放在钥匙串里，看文件判断不了。
    return process.platform === 'darwin' ? null : false
  }
  if (process.env.OPENAI_API_KEY) return true
  return fs.existsSync(path.join(process.env.CODEX_HOME || path.join(home, '.codex'), 'auth.json'))
}

/** 在一个新的终端窗口里跑命令（登录要人来点，所以放到能看见的窗口里）。 */
export function openTerminal(command, title = '牛马工作室') {
  const detach = (child) => {
    child.on('error', () => {})
    child.unref()
  }
  if (isWin) {
    detach(spawn(`start "${title}" cmd /k ${command}`, { shell: true, detached: true, stdio: 'ignore' }))
    return true
  }
  if (process.platform === 'darwin') {
    const esc = command.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    detach(spawn('osascript', ['-e', `tell application "Terminal" to do script "${esc}"`, '-e', 'tell application "Terminal" to activate'], { detached: true, stdio: 'ignore' }))
    return true
  }
  const shellCmd = `${command}; echo; read -p "按回车关闭窗口…" _`
  for (const [bin, ...args] of [
    ['x-terminal-emulator', '-e', 'bash', '-lc', shellCmd],
    ['gnome-terminal', '--', 'bash', '-lc', shellCmd],
    ['konsole', '-e', 'bash', '-lc', shellCmd],
    ['xfce4-terminal', '-x', 'bash', '-lc', shellCmd],
    ['xterm', '-e', 'bash', '-lc', shellCmd],
  ]) {
    const found = (process.env.PATH || '').split(':').some((d) => d && fs.existsSync(path.join(d, bin)))
    if (!found) continue
    detach(spawn(bin, args, { detached: true, stdio: 'ignore' }))
    return true
  }
  return false
}

function readUserConfig() {
  try {
    return JSON.parse(fs.readFileSync(userConfigFile(), 'utf8'))
  } catch (e) {
    if (e.code === 'ENOENT') return {}
    throw new Error(`读不了 ${userConfigFile()}：${e.message}`)
  }
}

function writeUserConfig(cfg) {
  fs.mkdirSync(path.dirname(userConfigFile()), { recursive: true })
  fs.writeFileSync(userConfigFile(), JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 })
}

function normalizeBase(url) {
  let u = String(url || '').trim().replace(/\/+$/, '')
  u = u.replace(/\/chat\/completions$/, '')
  try {
    if (new URL(u).pathname === '/') u += '/v1'
  } catch {}
  return u
}

/** 发一句最短的话试试接口通不通、Key 对不对、模型名对不对。 */
export async function testApi({ baseUrl, apiKey, noKey, models = {} }, { timeoutMs = 30000 } = {}) {
  const base = normalizeBase(baseUrl)
  const model = models.medium || models.hard || models.easy
  if (!base) return { ok: false, error: '还没填接口地址' }
  if (!/^https?:\/\//.test(base)) return { ok: false, error: '接口地址要以 http:// 或 https:// 开头' }
  if (!model) return { ok: false, error: '还没填模型名' }
  if (!apiKey && !noKey) return { ok: false, error: '还没填 API Key' }
  const headers = { 'Content-Type': 'application/json' }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  let res
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, messages: [{ role: 'user', content: '只回复两个字：在岗' }], max_tokens: 16 }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (e) {
    return { ok: false, error: `连不上 ${base}（${e.cause?.code || e.message}）。检查地址和网络` }
  }
  const text = await res.text().catch(() => '')
  if (res.ok) {
    let reply = ''
    try {
      reply = JSON.parse(text).choices?.[0]?.message?.content || ''
    } catch {}
    return { ok: true, reply: truncate(String(reply).trim() || '（收到了回复）', 60), model }
  }
  const why =
    res.status === 401 || res.status === 403
      ? 'Key 不对或者没权限'
      : res.status === 404
        ? '地址或模型名不对（地址要写到 /v1 这一级）'
        : res.status === 402
          ? '账户余额不足'
          : res.status === 429
            ? '请求太频繁或额度用完了'
            : `接口报错 ${res.status}`
  return { ok: false, error: `${why}：${truncate(text.replace(/\s+/g, ' '), 160)}` }
}

/**
 * @param {object} o
 * @param {import('./coordinator.js').Coordinator} o.coord
 * @param {() => Promise<void>} o.reload  按最新配置重新点名
 * @param {boolean} [o.fake]
 */
export function createSetup({ coord, reload, fake = false }) {
  const installing = new Set()
  const emit = (ev) => coord.emitEvent({ type: 'setup', ...ev })
  const guard = () => {
    if (fake) throw new Error('彩排模式下接的都是替身，关掉彩排模式再来接入真员工')
  }

  async function status() {
    ensurePath()
    const [node, npm, claude, codex] = await Promise.all([
      run('node', ['--version']),
      run('npm', ['--version']),
      run('claude', ['--version'], { timeoutMs: 20000 }),
      run('codex', ['--version'], { timeoutMs: 20000 }),
    ])
    const cfg = readUserConfigSafe()
    const mine = new Set((cfg.groups || []).map((g) => g.id))
    const groups = [...coord.team.groups.values()].map((g) => ({
      id: g.id,
      name: g.name,
      type: g.type,
      available: g.available,
      note: g.note,
      version: g.version,
      model: g.modelFor('medium'),
      baseUrl: g.type === 'openai-api' ? g.cfg.baseUrl || '' : '',
      removable: g.type === 'openai-api' && mine.has(g.id),
    }))
    const cli = (tool, r) => ({ tool, name: CLI[tool].name, installed: r.ok, version: version(r), loggedIn: r.ok ? loggedIn(tool) : false, installing: installing.has(tool), hint: CLI[tool].loginHint })
    return {
      platform: process.platform,
      fake,
      busy: coord.busy,
      node: { ok: node.ok, version: version(node) },
      npm: { ok: npm.ok, version: version(npm) },
      cli: [cli('claude', claude), cli('codex', codex)],
      groups,
      presets: PRESETS,
      configFile: userConfigFile(),
    }
  }

  function readUserConfigSafe() {
    try {
      return readUserConfig()
    } catch {
      return {}
    }
  }

  async function install(tool) {
    guard()
    if (!CLI[tool]) throw new Error('不认识的工具')
    if (installing.has(tool)) return { ok: true, already: true }
    installing.add(tool)
    const pkg = CLI[tool].pkg
    emit({ tool, line: `npm install -g ${pkg}` })
    ;(async () => {
      const r = await run('npm', ['install', '-g', pkg], { timeoutMs: 10 * 60 * 1000, onLine: (line) => !/^npm notice/.test(line) && emit({ tool, line: truncate(line, 200) }) })
      installing.delete(tool)
      ensurePath()
      if (r.ok) await addNpmBin()
      let error = ''
      if (!r.ok) {
        error = r.missing ? '电脑上没有 npm，先装 Node.js' : /EACCES|permission denied/i.test(r.out) ? '权限不够。点「在终端里安装」，按提示输入电脑密码' : `安装失败（退出码 ${r.code}）`
      }
      // 先重新点名再报完成：面板收到完成消息就会刷新，这时要能看到新员工。
      if (r.ok) await reload().catch(() => {})
      emit({ tool, done: true, ok: r.ok, error })
      if (r.ok) coord.addMessage('shaniu', `${CLI[tool].name} 装好啦～ 在「接入员工」里点「登录」，登录好就能开工。`)
    })()
    return { ok: true }
  }

  function installInTerminal(tool) {
    if (!CLI[tool]) throw new Error('不认识的工具')
    const cmd = `${isWin ? '' : 'sudo '}npm install -g ${CLI[tool].pkg}`
    if (!openTerminal(cmd, `安装 ${CLI[tool].name}`)) throw new Error(`没找到终端程序，请自己打开终端运行：${cmd}`)
    return { ok: true }
  }

  function login(tool) {
    if (tool === 'node') {
      if (!isWin) throw new Error('请打开 https://nodejs.org 下载安装 Node.js（选 LTS 版本）')
      if (!openTerminal('winget install -e --id OpenJS.NodeJS.LTS', '安装 Node.js')) throw new Error('打不开终端')
      return { ok: true, hint: '装好以后把牛马工作室完全退出再打开。' }
    }
    if (!CLI[tool]) throw new Error('不认识的工具')
    if (!openTerminal(CLI[tool].login, `登录 ${CLI[tool].name}`)) throw new Error(`没找到终端程序，请自己打开终端运行：${CLI[tool].login}`)
    return { ok: true, hint: CLI[tool].loginHint }
  }

  async function testCli(tool) {
    ensurePath()
    const r =
      tool === 'claude'
        ? await run('claude', ['-p', '--output-format', 'json', '--model', 'haiku'], { timeoutMs: 120000, input: '只回复两个字：在岗' })
        : await run('codex', ['exec', '--skip-git-repo-check', '-s', 'read-only', '-'], { timeoutMs: 180000, input: '只回复两个字：在岗' })
    if (r.ok) {
      let reply = ''
      try {
        reply = JSON.parse(r.out).result || ''
      } catch {
        reply = r.out.trim().split('\n').filter(Boolean).pop() || ''
      }
      return { ok: true, reply: truncate(reply, 60) }
    }
    if (r.missing) return { ok: false, error: '还没安装' }
    const needLogin = /login|log in|auth|credential|api key|unauthorized|401/i.test(r.out)
    return { ok: false, error: needLogin ? '还没登录，点「登录」' : truncate(r.out.trim().split('\n').slice(-3).join(' '), 200) || `退出码 ${r.code}` }
  }

  async function saveApi(input) {
    guard()
    if (coord.busy) throw new Error('傻妞手上还有活，等这一轮做完再接入新员工')
    const preset = PRESETS.find((p) => p.id === input.preset) || PRESETS.find((p) => p.id === 'custom')
    const models = Object.fromEntries(['hard', 'medium', 'easy'].map((k) => [k, String(input.models?.[k] || '').trim()]).filter(([, v]) => v))
    // 没填中档就拿难活或杂活的模型顶上：派活时找不到模型名会直接失败。
    if (!models.medium && (models.hard || models.easy)) models.medium = models.hard || models.easy
    const group = {
      baseUrl: normalizeBase(input.baseUrl || preset.baseUrl),
      apiKey: String(input.apiKey || '').trim(),
      noKey: !!(input.noKey ?? preset.noKey),
      models,
    }
    const t = await testApi(group)
    if (!t.ok) return t
    const cfg = readUserConfig()
    const groups = Array.isArray(cfg.groups) ? cfg.groups : []
    let id = String(input.id || '').trim()
    if (!id) {
      id = preset.id === 'custom' ? 'api' : preset.id
      const taken = new Set([...groups.map((g) => g.id), ...coord.team.groups.keys()])
      for (let n = 2; taken.has(id); n++) id = `${preset.id === 'custom' ? 'api' : preset.id}-${n}`
    }
    const name = String(input.name || '').trim() || preset.group || `${id} 组`
    const entry = { id, name, type: 'openai-api', baseUrl: group.baseUrl, models }
    if (group.noKey) entry.noKey = true
    else entry.apiKey = group.apiKey
    if (preset.maxParallel) entry.maxParallel = preset.maxParallel
    const i = groups.findIndex((g) => g.id === id)
    if (i === -1) groups.push(entry)
    else groups[i] = { ...groups[i], ...entry }
    writeUserConfig({ ...cfg, groups })
    await reload()
    const g = coord.team.groups.get(id)
    const staff = coord.team.employees.filter((e) => e.group === id).map((e) => e.name)
    coord.addMessage('shaniu', g?.available ? `新同事到岗啦！**${name}**（${staff.join('、') || '通才'}）已经坐进工位，模型是 ${t.model}。` : `${name}接上了，可是检查没通过：${g?.note || '不在岗'}。`)
    return { ok: true, id, reply: t.reply, available: !!g?.available }
  }

  async function remove(id) {
    guard()
    if (coord.busy) throw new Error('傻妞手上还有活，等这一轮做完再调整')
    const cfg = readUserConfig()
    const groups = (cfg.groups || []).filter((g) => g.id !== id)
    if (groups.length === (cfg.groups || []).length) throw new Error('这个组不是在这里接入的，去对应的配置文件里改')
    writeUserConfig({ ...cfg, groups })
    await reload()
    coord.addMessage('shaniu', `好的，${id} 组的同事先回家休息了。`)
    return { ok: true }
  }

  async function recheck() {
    guard()
    if (coord.busy) throw new Error('傻妞手上还有活，等这一轮做完再检查')
    ensurePath()
    await reload()
    return { ok: true }
  }

  return { status, install, installInTerminal, login, testCli, testApi, saveApi, remove, recheck }
}
