import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createClaudeParser, createCodexParser, describeClaudeTool } from '../src/agents.js'
import { DEFAULTS, merge } from '../src/config.js'
import { Coordinator, normalizeTasks, parseCommand, parseVerdict } from '../src/coordinator.js'
import { extractJson } from '../src/util.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('extractJson handles bare, fenced and embedded JSON', () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 })
  assert.deepEqual(extractJson('好的：\n```json\n{"a":2}\n```'), { a: 2 })
  assert.deepEqual(extractJson('计划如下 {"reply":"含 } 括号","tasks":[]} 完毕'), { reply: '含 } 括号', tasks: [] })
  assert.equal(extractJson('没有 JSON'), null)
})

test('parseCommand and parseVerdict', () => {
  assert.deepEqual(parseCommand('/claude 修一下登录'), { type: 'direct', agent: 'claude', text: '修一下登录' })
  assert.deepEqual(parseCommand('@Codex 跑测试'), { type: 'direct', agent: 'codex', text: '跑测试' })
  assert.deepEqual(parseCommand('/stop'), { type: 'stop' })
  assert.equal(parseCommand('@someone hi'), null)
  assert.equal(parseCommand('普通的话'), null)
  assert.equal(parseVerdict('...\nVERDICT: CHANGES_REQUESTED'), 'changes')
  assert.equal(parseVerdict('VERDICT: CHANGES_REQUESTED\n后来改主意\nverdict: approve'), 'approve')
  assert.equal(parseVerdict('看起来不错'), 'unknown')
})

test('normalizeTasks fixes ids, agents, unknown deps and cycles', () => {
  const onlyClaude = (id) => id === 'claude'
  const tasks = normalizeTasks(
    [
      { id: 'a', title: 'A', agent: 'codex', depends_on: ['b'] },
      { id: 'b', title: 'B', agent: 'Claude', depends_on: ['a', 'ghost'] },
      { id: 'a', title: 'A2', agent: 'claude', kind: 'weird' },
      'junk',
    ],
    onlyClaude,
  )
  assert.equal(tasks.length, 3)
  assert.ok(tasks.every((t) => t.agent === 'claude'))
  assert.equal(new Set(tasks.map((t) => t.id)).size, 3)
  assert.deepEqual(tasks[0].deps, [])
  assert.deepEqual(tasks[1].deps, ['a'])
  assert.equal(tasks[2].kind, 'code')
  assert.deepEqual(normalizeTasks([{ agent: 'codex' }], () => false), [])
})

test('claude stream-json parser', () => {
  const p = createClaudeParser('/proj')
  p.feed(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' }))
  const acts = p.feed(
    JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: '我先看看' },
          { type: 'tool_use', name: 'Edit', input: { file_path: '/proj/src/a.js' } },
        ],
      },
    }),
  )
  assert.deepEqual(acts.map((a) => a.text), ['我先看看', '改 src/a.js'])
  p.feed(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '完成', total_cost_usd: 0.12 }))
  assert.deepEqual(p.finish({ code: 0, stderr: '' }), { ok: true, text: '完成', error: '', cost: 0.12, sessionId: 's1' })
  assert.equal(describeClaudeTool('Bash', { command: "bash -lc 'npm test'" }), '跑 npm test')
})

test('codex jsonl parser', () => {
  const p = createCodexParser('/proj')
  const lines = [
    { type: 'thread.started', thread_id: 'th' },
    { type: 'item.started', item: { type: 'command_execution', command: "bash -lc 'npm test'" } },
    { type: 'item.completed', item: { type: 'file_change', changes: [{ path: '/proj/test/x.js', kind: 'add' }] } },
    { type: 'item.completed', item: { type: 'agent_message', text: '都好了' } },
    { type: 'turn.completed', usage: { input_tokens: 1 } },
  ]
  const acts = lines.flatMap((l) => p.feed(JSON.stringify(l)))
  assert.deepEqual(acts.map((a) => a.text), ['跑 npm test', '改 test/x.js', '都好了'])
  const r = p.finish({ code: 0, stderr: '' }, '/nonexistent')
  assert.equal(r.ok, true)
  assert.equal(r.text, '都好了')
  const bad = createCodexParser('/proj')
  bad.feed(JSON.stringify({ type: 'turn.failed', error: { message: 'quota' } }))
  assert.equal(bad.finish({ code: 1, stderr: '' }).error, 'quota')
})

function fakeCoordinator(overrides = {}) {
  process.env.MAVIS_FAKE_SPEED = '0.02'
  const cfg = merge(DEFAULTS, {
    dispatchDelayMs: 0,
    logDir: path.join(root, '.mavis', 'test-logs'),
    agents: {
      claude: { command: [process.execPath, path.join(root, 'fake', 'claude.mjs')] },
      codex: { command: [process.execPath, path.join(root, 'fake', 'codex.mjs')] },
    },
    ...overrides,
  })
  cfg.workdir = root
  return new Coordinator(cfg, { mode: 'fake' })
}

const waitIdle = (c) =>
  new Promise((resolve) => {
    const on = (ev) => {
      if (ev.type === 'busy' && !ev.busy) {
        c.off('event', on)
        resolve()
      }
    }
    c.on('event', on)
  })

test('a full rehearsal round runs every task and reports back', async () => {
  const c = fakeCoordinator()
  const events = []
  c.on('event', (e) => events.push(e))
  await c.init()
  assert.ok(c.agents.claude.available && c.agents.codex.available)
  const idle = waitIdle(c)
  c.post('给博客加一个暗色模式开关，并补上测试')
  await idle
  assert.deepEqual(c.tasks.map((t) => [t.id, t.agent, t.status]), [
    ['t1', 'claude', 'done'],
    ['t2', 'codex', 'done'],
    ['t3', 'codex', 'done'],
  ])
  assert.equal(c.task('t3').verdict, 'approve')
  assert.ok(events.some((e) => e.type === 'dispatch' && e.to === 'codex'))
  assert.ok(events.some((e) => e.type === 'activity' && e.id === 'claude' && e.text.startsWith('改 ')))
  assert.match(c.messages.at(-1).text, /搞定/)
})

test('a strict review triggers one fix round and a re-review', async () => {
  const c = fakeCoordinator()
  await c.init()
  const idle = waitIdle(c)
  c.post('严格一点：给博客加暗色模式')
  await idle
  assert.deepEqual(
    c.tasks.map((t) => [t.id, t.kind, t.agent, t.status]),
    [
      ['t1', 'code', 'claude', 'done'],
      ['t2', 'code', 'codex', 'done'],
      ['t3', 'review', 'codex', 'done'],
      ['t1-fix1', 'fix', 'claude', 'done'],
      ['t3-re1', 'review', 'codex', 'done'],
    ],
  )
  assert.equal(c.task('t3').verdict, 'changes')
  assert.equal(c.task('t3-re1').verdict, 'approve')
})

test('greetings get a reply without tasks; /stop halts a round', async () => {
  const c = fakeCoordinator({ dispatchDelayMs: 50 })
  await c.init()
  let idle = waitIdle(c)
  c.post('你好')
  await idle
  assert.equal(c.tasks.length, 0)
  assert.match(c.messages.at(-1).text, /待命/)

  process.env.MAVIS_FAKE_SPEED = '1'
  idle = waitIdle(c)
  c.post('给博客加一个暗色模式开关，并补上测试')
  await new Promise((r) => {
    const on = (ev) => {
      if (ev.type === 'task' && ev.task.status === 'running') {
        c.off('event', on)
        r()
      }
    }
    c.on('event', on)
  })
  c.post('/stop')
  await idle
  assert.ok(c.tasks.every((t) => t.status === 'cancelled' || t.status === 'skipped'), JSON.stringify(c.tasks.map((t) => t.status)))
  assert.match(c.messages.at(-1).text, /停下/)
})
