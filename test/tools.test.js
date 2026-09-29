import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { normalizeTasks } from '../src/coordinator.js'
import { McpClient, mcpResult } from '../src/mcp/client.js'
import { parseKeys, winVk } from '../src/mcp/desktop.js'
import { Team } from '../src/team.js'
import { ToolCatalog, codexServers, describeMcpCall, splitMcpName } from '../src/tools.js'
import { ClaudeCliWorker, CodexCliWorker, describeClaudeTool } from '../src/workers/cli.js'
import { OpenAIWorker } from '../src/workers/openai.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DESKTOP = path.join(root, 'src', 'mcp', 'desktop.js')
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'niuma-tools-'))
const group = (type, cfg = {}) => ({ type, cfg })

test('the tool cabinet: built-ins, who can use them, safe mode and config', () => {
  const home = tmp()
  const cat = new ToolCatalog({ tools: { discover: false } }, { workdir: tmp(), home })
  assert.deepEqual(cat.list().map((t) => t.id), ['browser', 'desktop'])
  assert.equal(cat.supports(group('claude-cli'), 'browser'), true)
  assert.equal(cat.supports(group('codex-cli'), 'browser'), true)
  assert.equal(cat.supports(group('openai-api'), 'browser'), true)
  // Desktop control needs screenshots, so only models that can see images get it.
  assert.equal(cat.supports(group('claude-cli'), 'desktop'), true)
  assert.equal(cat.supports(group('openai-api'), 'desktop'), false)
  assert.equal(cat.supports(group('openai-api', { vision: true }), 'desktop'), true)
  assert.equal(cat.supports(group('codex-cli'), 'desktop'), false)
  assert.deepEqual(cat.resolve(['浏览器', 'niuma_desktop', 'nope', 'browser']), ['browser', 'desktop'])
  assert.deepEqual(cat.guess('@frontend 打开网页看看首页'), ['browser'])
  assert.deepEqual(cat.guess('帮我在微信里发个消息'), ['desktop'])
  assert.equal(cat.spec('desktop').args[0], DESKTOP)

  const safe = new ToolCatalog({ autonomy: 'safe', tools: { discover: false } }, { workdir: tmp(), home })
  assert.equal(safe.get('desktop'), null)
  const custom = new ToolCatalog(
    { tools: { discover: false, browser: { enabled: false }, mydb: { name: '数据库', description: '查库', command: 'node', args: ['db.js'], env: { TOKEN: '${NIUMA_T}' } } } },
    { workdir: tmp(), home },
  )
  assert.deepEqual(custom.list().map((t) => t.id), ['desktop', 'mydb'])
  process.env.NIUMA_T = 'secret'
  assert.deepEqual(custom.spec('mydb'), { command: 'node', args: ['db.js'], env: { TOKEN: 'secret' } })
})

test('plugins the boss installed in Claude Code or Codex are found automatically', () => {
  const home = tmp()
  const work = tmp()
  fs.writeFileSync(
    path.join(home, '.claude.json'),
    JSON.stringify({
      mcpServers: { github: { type: 'http', url: 'https://example.com/mcp' }, notes: { command: 'node', args: ['notes.js'] } },
      projects: { [work]: { mcpServers: { local_db: { command: 'db-mcp' } } } },
    }),
  )
  fs.mkdirSync(path.join(home, '.codex'))
  fs.writeFileSync(
    path.join(home, '.codex', 'config.toml'),
    `model = "gpt-5"\n\n[mcp_servers.notes]\ncommand = "node"\nargs = ["notes.js"]\n\n[mcp_servers.search]\ncommand = "npx"\nargs = ["-y", "search-mcp"] # web search\n\n[mcp_servers.search.env]\nAPI_KEY = "k1"\n\n[profiles.x]\nmodel = "o3"\n`,
  )
  assert.deepEqual(codexServers(path.join(home, '.codex')).search, { command: 'npx', args: ['-y', 'search-mcp'], env: { API_KEY: 'k1' } })
  const cat = new ToolCatalog({}, { workdir: work, home })
  const ids = cat.list().map((t) => t.id)
  assert.ok(['github', 'notes', 'local_db', 'search'].every((id) => ids.includes(id)), ids.join(','))
  // A remote plugin only works in the CLI it was installed in; a local one can be lent to everyone.
  assert.equal(cat.supports(group('claude-cli'), 'github'), true)
  assert.equal(cat.supports(group('codex-cli'), 'github'), false)
  assert.equal(cat.supports(group('openai-api'), 'notes'), true)
  assert.deepEqual(cat.get('notes').native.sort(), ['claude-cli', 'codex-cli'])
  assert.deepEqual(cat.get('search').native, ['codex-cli'])
})

test('the desktop plugin speaks MCP and maps key names', async () => {
  assert.deepEqual(parseKeys('Ctrl+Shift+T'), { mods: ['ctrl', 'shift'], key: 't' })
  assert.deepEqual(parseKeys('command + return'), { mods: ['cmd'], key: 'enter' })
  assert.throws(() => parseKeys('a+b'), /一次只能按一个主键/)
  assert.equal(winVk('s'), 0x53)
  assert.equal(winVk('f5'), 0x74)
  assert.equal(winVk('enter'), 0x0d)

  const c = new McpClient('niuma_desktop', { command: process.execPath, args: [DESKTOP], env: { NIUMA_DESKTOP_PLATFORM: 'plan9' } })
  try {
    const tools = await c.start({ timeoutMs: 10000 })
    assert.deepEqual(tools.map((t) => t.name), ['screenshot', 'click', 'move', 'drag', 'scroll', 'type', 'key', 'open', 'wait'])
    const r = mcpResult(await c.call('click', { x: 1, y: 2 }))
    assert.equal(r.isError, true)
    assert.match(r.text, /暂不支持这个系统：plan9/)
    await assert.rejects(c.call('nope', {}), /没有叫 nope 的工具/)
  } finally {
    c.close()
  }
})

test('Claude and Codex runs get the plugins for this task only', () => {
  const tools = [
    { id: 'browser', server: 'niuma_browser', command: 'npx', args: ['-y', '@playwright/mcp@latest'], env: {}, native: [] },
    { id: 'notes', server: 'notes', command: 'node', args: ['notes.js'], env: { K: 'v' }, native: ['claude-cli'] },
  ]
  const claude = new ClaudeCliWorker({ id: 'claude', type: 'claude-cli' }, { workdir: tmp(), logDir: tmp() })
  const { args, cleanup } = claude.runArgs({ readOnly: false, model: 'sonnet', label: 't', tools })
  const file = args[args.indexOf('--mcp-config') + 1]
  // Only the plugin Claude Code doesn't already load is started for this run.
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers), ['niuma_browser'])
  assert.deepEqual(cleanup, [file])
  const allow = args.slice(args.indexOf('--allowedTools') + 1, args.indexOf('--disallowedTools'))
  assert.ok(allow.includes('mcp__niuma_browser') && allow.includes('mcp__notes') && allow.includes('Bash'))
  fs.rmSync(file)
  assert.equal(claude.runArgs({ readOnly: false, model: '', label: 't' }).args.includes('--mcp-config'), false)

  const codex = new CodexCliWorker({ id: 'codex', type: 'codex-cli' }, { workdir: tmp(), logDir: tmp() })
  const cargs = codex.runArgs({ readOnly: false, label: 't', model: '', tools }).args
  assert.ok(cargs.includes('mcp_servers.niuma_browser.command="npx"'))
  assert.ok(cargs.includes('mcp_servers.niuma_browser.args=["-y","@playwright/mcp@latest"]'))
  assert.ok(cargs.includes('mcp_servers.notes.env={"K"="v"}'))

  assert.deepEqual(splitMcpName('mcp__niuma_browser__browser_navigate'), { server: 'niuma_browser', tool: 'browser_navigate' })
  assert.equal(describeClaudeTool('mcp__niuma_browser__browser_navigate', { url: 'https://example.com' }), '打开网页 https://example.com')
  assert.equal(describeMcpCall('niuma_desktop', 'click', { x: 3, y: 4, double: true }), '双击屏幕 (3, 4)')
  assert.equal(describeMcpCall('other', 'run', {}), '用插件 other.run')
})

test('tasks that need a tool go to someone who can use it', () => {
  const work = tmp()
  const team = new Team(
    {
      workdir: work,
      tools: { discover: false },
      groups: [
        { id: 'claude', name: 'Claude 组', type: 'claude-cli' },
        { id: 'deepseek', name: 'DeepSeek 组', type: 'openai-api', baseUrl: 'http://x', model: 'deepseek-v4-flash' },
      ],
      employees: [
        { id: 'frontend', skill: 'frontend', group: 'claude' },
        { id: 'writer', skill: 'writer', group: 'deepseek' },
      ],
    },
    { root, workdir: work, logDir: work },
  )
  for (const g of team.groups.values()) g.available = true
  const tasks = normalizeTasks(
    [
      { id: 't1', title: '在记事本里写字', agent: 'writer', tools: ['desktop'], prompt: '打开记事本输入你好' },
      { id: 't2', title: '看看网页', agent: 'writer', tools: ['浏览器'], prompt: '打开网页' },
      { id: 't3', title: '写文档', agent: 'writer', tools: ['不存在的工具'], prompt: '写 README' },
    ],
    team,
  )
  assert.equal(tasks[0].agent, 'frontend')
  assert.deepEqual(tasks[0].tools, ['desktop'])
  assert.match(tasks[0].why, /用不了需要的工具/)
  assert.equal(tasks[1].agent, 'writer')
  assert.deepEqual(tasks[1].tools, ['browser'])
  assert.deepEqual(tasks[2].tools, [])
})

test('API models (DeepSeek, relays…) can call plugins too', async (t) => {
  const seen = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json')
      if (req.url.endsWith('/models')) return res.end('{"data":[]}')
      const b = JSON.parse(body)
      seen.push(b)
      const toolMsg = b.messages.find((m) => m.role === 'tool')
      const message = toolMsg
        ? { role: 'assistant', content: `插件说：${toolMsg.content}` }
        : { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'niuma_desktop__wait', arguments: '{"seconds":0.1}' } }] }
      res.end(JSON.stringify({ choices: [{ message, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }))
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  t.after(() => server.close())
  const dir = tmp()
  const w = new OpenAIWorker({ id: 'ds', type: 'openai-api', baseUrl: `http://127.0.0.1:${server.address().port}`, apiKey: 'k', model: 'm' }, { workdir: dir, logDir: dir })
  const acts = []
  const res = await w.run({
    prompt: '等一下',
    onActivity: (a) => acts.push(a.text),
    tools: [{ id: 'desktop', name: '电脑操作', server: 'niuma_desktop', command: process.execPath, args: [DESKTOP], env: {} }],
  })
  assert.equal(res.ok, true, res.error)
  assert.match(res.text, /插件说：等了 0.1 秒/)
  assert.ok(seen[0].tools.some((f) => f.function.name === 'niuma_desktop__screenshot'))
  assert.ok(acts.includes('准备电脑操作') && acts.includes('等一下'), acts.join(' | '))
  assert.equal(w.plugins.size, 0)
})
