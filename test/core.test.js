import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { rehearsalConfig } from '../fake/rehearsal.mjs'
import { DEFAULTS, loadConfig, merge } from '../src/config.js'
import { Coordinator, extractVerdict, normalizeTasks, parseCommand, parseVerdict, pickEmployee } from '../src/coordinator.js'
import { fitScore, modelProfile } from '../src/models.js'
import { loadSkills, parseSkill } from '../src/skills.js'
import { Team } from '../src/team.js'
import { createClaudeParser, createCodexParser, describeClaudeTool } from '../src/workers/cli.js'
import { extractJson } from '../src/util.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'shaniu-test-'))

// Keep hired skills and stats out of the real home directory.
process.env.HOME = tmp()
process.env.USERPROFILE = process.env.HOME

test('extractJson / parseVerdict / extractVerdict', () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 })
  assert.deepEqual(extractJson('好的：\n```json\n{"a":2}\n```'), { a: 2 })
  assert.deepEqual(extractJson('计划如下 {"reply":"含 } 括号","tasks":[]} 完毕'), { reply: '含 } 括号', tasks: [] })
  assert.equal(extractJson('没有 JSON'), null)
  assert.equal(parseVerdict('...\nVERDICT: CHANGES_REQUESTED'), 'changes')
  assert.equal(parseVerdict('VERDICT: CHANGES_REQUESTED\nverdict: approve'), 'approve')
  const v = extractVerdict('检查过程\n```js\nconst x = 1\n```\n结论\n```json\n{"done": false, "problems": ["少了导出"], "tasks": [{"id":"f1"}]}\n```')
  assert.deepEqual(v, { done: false, problems: ['少了导出'], tasks: [{ id: 'f1' }] })
  assert.equal(extractVerdict('看不懂的输出').done, true)
})

test('config merges groups and employees by id', () => {
  const cfg = merge(DEFAULTS, {
    groups: [{ id: 'deepseek', type: 'openai-api', model: 'deepseek-chat' }, { id: 'codex', enabled: false }],
    employees: [{ id: 'frontend', group: 'deepseek' }],
  })
  assert.deepEqual(cfg.groups.map((g) => g.id), ['claude', 'codex', 'deepseek'])
  assert.equal(cfg.groups[1].enabled, false)
  assert.equal(cfg.employees.find((e) => e.id === 'frontend').group, 'deepseek')
  assert.equal(cfg.employees.find((e) => e.id === 'frontend').skill, 'frontend')
})

test('model knowledge: tiers, costs and difficulty fit', () => {
  assert.equal(modelProfile({ model: 'opus' }).tier, 'strong')
  assert.equal(modelProfile({ model: 'claude-haiku-4-5' }).cost, 'low')
  assert.equal(modelProfile({ model: 'deepseek-chat' }).tier, 'balanced')
  assert.equal(modelProfile({ model: 'deepseek-reasoner' }).tier, 'strong')
  assert.equal(modelProfile({ type: 'codex-cli' }).tier, 'strong')
  assert.equal(modelProfile({ model: 'x', tier: 'fast', strengths: '自定义' }).strengths, '自定义')
  const opus = modelProfile({ model: 'opus' })
  const cheap = modelProfile({ model: 'deepseek-chat' })
  assert.ok(fitScore(opus, 'hard') > fitScore(cheap, 'hard'))
  assert.ok(fitScore(cheap, 'easy') > fitScore(opus, 'easy'))
})

test('skills parse, and a skill file with a group becomes an employee', () => {
  const s = parseSkill('---\nname: 数据库专家\ndescription: 擅长 SQL\ngroup: codex\nlook: glasses\n---\n- 先备份\n', 'db')
  assert.deepEqual([s.name, s.description, s.group, s.look, s.instructions], ['数据库专家', '擅长 SQL', 'codex', 'glasses', '- 先备份'])
  const builtin = loadSkills([{ dir: path.join(root, 'skills'), source: 'builtin' }])
  for (const id of ['generalist', 'architect', 'frontend', 'backend', 'tester', 'reviewer', 'debugger', 'writer']) assert.ok(builtin.has(id), id)

  const work = tmp()
  fs.mkdirSync(path.join(work, '.shaniu', 'skills', 'sql'), { recursive: true })
  fs.writeFileSync(path.join(work, '.shaniu', 'skills', 'sql', 'SKILL.md'), '---\nname: SQL 专家\ndescription: 写查询\ngroup: codex\n---\n规则')
  const cfg = merge(DEFAULTS, { groups: [{ id: 'deepseek', type: 'openai-api', model: 'deepseek-chat' }] })
  const team = new Team(cfg, { root, workdir: work, logDir: work })
  assert.ok(team.employee('sql'), 'skill folder hired as an employee')
  assert.equal(team.employee('sql').group, 'codex')
  assert.equal(team.employee('deepseek').skill.id, 'generalist', 'empty group gets a generalist')
  assert.equal(team.resolve('前端工程师').id, 'frontend')
  assert.equal(team.resolve('claude').group, 'claude', '@group resolves to someone in that group')
})

function fakeTeam() {
  const cfg = merge(DEFAULTS, { groups: [{ id: 'deepseek', type: 'openai-api', model: 'deepseek-chat' }] })
  const team = new Team(cfg, { root, workdir: root, logDir: tmp() })
  for (const g of team.groups.values()) g.available = true
  return team
}

test('routing: hard work goes to strong models, easy work to cheap ones, reviews to the reviewer', () => {
  const team = fakeTeam()
  const hard = team.groupOf(pickEmployee(team, { difficulty: 'hard' }))
  assert.equal(hard.profileFor('hard').tier, 'strong')
  assert.equal(team.groupOf(pickEmployee(team, { difficulty: 'easy' })).profileFor('easy').cost, 'low')
  assert.equal(pickEmployee(team, { kind: 'review' }), 'reviewer')
  assert.notEqual(pickEmployee(team, { exclude: ['architect', 'frontend', 'reviewer'] }), 'architect')
  for (const g of team.groups.values()) g.available = g.id === 'deepseek'
  assert.equal(pickEmployee(team, { difficulty: 'hard' }), 'deepseek', 'only the available group is used')
})

test('normalizeTasks resolves employees, fixes ids, deps and cycles', () => {
  const team = fakeTeam()
  team.groups.get('codex').available = false
  const tasks = normalizeTasks(
    [
      { id: 'a', title: 'A', agent: 'backend', difficulty: 'easy', depends_on: ['b'] },
      { id: 'b', title: 'B', agent: '前端工程师', difficulty: 'weird', depends_on: ['a', 'ghost'] },
      { id: 'a', title: 'A2', agent: 'nobody', kind: 'weird' },
      'junk',
    ],
    team,
  )
  assert.equal(tasks.length, 3)
  assert.notEqual(tasks[0].agent, 'backend', 'unavailable employee is replaced')
  assert.match(tasks[0].why, /不在岗/)
  assert.equal(tasks[1].agent, 'frontend')
  assert.equal(tasks[1].difficulty, 'medium')
  assert.equal(new Set(tasks.map((t) => t.id)).size, 3)
  assert.deepEqual(tasks[0].deps, [])
  assert.deepEqual(tasks[1].deps, ['a'])
  assert.equal(tasks[2].kind, 'code')
})

test('commands', () => {
  const team = fakeTeam()
  assert.deepEqual(parseCommand('@frontend 改按钮', team), { type: 'direct', agent: 'frontend', text: '改按钮' })
  assert.deepEqual(parseCommand('/前端工程师 改按钮', team), { type: 'direct', agent: 'frontend', text: '改按钮' })
  assert.deepEqual(parseCommand('/招人 数据库专家', team), { type: 'hire', text: '数据库专家' })
  assert.equal(parseCommand('/撤销', team).type, 'undo')
  assert.equal(parseCommand('/团队', team).type, 'team')
  assert.equal(parseCommand('/stop', team).type, 'stop')
  assert.equal(parseCommand('@someone hi', team), null)
  assert.equal(parseCommand('普通的话', team), null)
})

test('claude and codex output parsers', () => {
  const p = createClaudeParser('/proj')
  p.feed(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' }))
  const acts = p.feed(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '我先看看' }, { type: 'tool_use', name: 'Edit', input: { file_path: '/proj/src/a.js' } }] } }))
  assert.deepEqual(acts.map((a) => a.text), ['我先看看', '改 src/a.js'])
  p.feed(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '完成', total_cost_usd: 0.12 }))
  assert.deepEqual(p.finish({ code: 0, stderr: '' }), { ok: true, text: '完成', error: '', cost: 0.12, sessionId: 's1' })
  assert.equal(describeClaudeTool('Bash', { command: "bash -lc 'npm test'" }), '跑 npm test')

  const c = createCodexParser('/proj')
  const lines = [
    { type: 'item.started', item: { type: 'command_execution', command: "bash -lc 'npm test'" } },
    { type: 'item.completed', item: { type: 'file_change', changes: [{ path: '/proj/test/x.js', kind: 'add' }] } },
    { type: 'item.completed', item: { type: 'agent_message', text: '都好了' } },
  ]
  assert.deepEqual(lines.flatMap((l) => c.feed(JSON.stringify(l))).map((a) => a.text), ['跑 npm test', '改 test/x.js', '都好了'])
  assert.equal(c.finish({ code: 0, stderr: '' }, '/nonexistent').text, '都好了')
  const bad = createCodexParser('/proj')
  bad.feed(JSON.stringify({ type: 'turn.failed', error: { message: 'quota' } }))
  assert.equal(bad.finish({ code: 1, stderr: '' }).error, 'quota')
})

// ---- full rehearsals with the fake company -----------------------------------------------

async function rehearsal(t, overrides = {}) {
  process.env.SHANIU_FAKE_SPEED = '0.02'
  const r = await rehearsalConfig(loadConfig({ workdir: root }), root)
  const c = new Coordinator({ ...r.config, workdir: root, dispatchDelayMs: 0, ...overrides }, { mode: 'fake', root })
  t.after(() => {
    c.stopAll()
    r.close()
  })
  await c.init()
  return c
}

const idle = (c) =>
  new Promise((resolve) => {
    c.on('event', function on(ev) {
      if (ev.type === 'busy' && !ev.busy) {
        c.off('event', on)
        resolve()
      }
    })
  })

async function say(c, text) {
  const done = idle(c)
  c.post(text)
  await done
}

test('a vague request is planned, routed by difficulty, reviewed and accepted', async (t) => {
  const c = await rehearsal(t)
  const events = []
  c.on('event', (e) => events.push(e))
  await say(c, '帮我做一个记账小网站')
  assert.equal(c.meeting.status, 'closed')
  assert.deepEqual(c.meeting.speeches.map((x) => x.who).sort(), ['前端工程师', '后端工程师', '架构师'].sort())
  assert.match(c.meeting.minutes, /目录结构/)
  assert.ok(c.messages.some((m) => m.role === 'speech' && m.id === 'backend'))
  const byId = Object.fromEntries(c.tasks.map((t) => [t.id, t]))
  assert.deepEqual(Object.keys(byId), ['t1', 't2', 't3', 't4', 't5', 'v1'])
  assert.ok(c.tasks.every((t) => t.status === 'done'), JSON.stringify(c.tasks.map((t) => [t.id, t.status, t.error])))
  assert.equal(byId.t1.model, 'opus', 'hard task uses the strong model of the Claude group')
  assert.equal(byId.t2.model, 'sonnet')
  assert.equal(byId.t4.model, 'deepseek-chat', 'easy docs go to the cheap API group')
  assert.ok(byId.t4.activity.some((a) => a.text.startsWith('看目录')), 'built-in API agent really ran its tools')
  assert.equal(byId.t5.verdict, 'approve')
  assert.equal(byId.v1.verdict, 'approve')
  assert.ok(events.some((e) => e.type === 'dispatch' && e.to === 'writer'))
  assert.match(c.messages.at(-1).text, /搞定/)
})

test('an unfinished result triggers a second iteration', async (t) => {
  const c = await rehearsal(t)
  await say(c, '记账小工具，没做完就继续')
  const ids = c.tasks.map((t) => t.id)
  assert.deepEqual(ids.slice(-3), ['v1', 'i2-f1', 'v2'])
  assert.equal(c.task('v1').verdict, 'changes')
  assert.equal(c.task('i2-f1').agent, 'debugger')
  assert.equal(c.task('i2-f1').iter, 2)
  assert.equal(c.task('v2').verdict, 'approve')
})

test('a strict review triggers a fix and a re-review', async (t) => {
  const c = await rehearsal(t)
  await say(c, '严格一点：做一个记账小网站')
  const ids = c.tasks.map((t) => t.id)
  assert.ok(ids.includes('t2-fix1') || ids.includes('t3-fix1'), ids.join(','))
  assert.ok(ids.includes('t5-re1'))
  assert.equal(c.task('t5').verdict, 'changes')
  assert.equal(c.task('t5-re1').verdict, 'approve')
})

test('when a group fails, its tasks are handed to someone else', async (t) => {
  const c = await rehearsal(t, { brain: 'codex', maxIterations: 1 })
  await say(c, '罢工测试：做一个记账小网站')
  const t1 = c.task('t1')
  assert.equal(t1.attempts.length, 1)
  assert.equal(t1.attempts[0].agent, 'architect')
  assert.notEqual(c.team.employee(t1.agent).group, 'claude')
  assert.equal(t1.status, 'done')
  assert.ok(c.messages.some((m) => /换.+接手/.test(m.text)))
})

test('greetings need no tasks; /团队 lists staff; /招人 hires a new employee', async (t) => {
  const c = await rehearsal(t)
  await say(c, '你好')
  assert.equal(c.tasks.length, 0)
  await say(c, '/团队')
  assert.match(c.messages.at(-1).text, /DeepSeek 组/)
  const before = c.team.employees.length
  await say(c, '/招人 数据库专家')
  assert.equal(c.team.employees.length, before + 1)
  const hired = c.team.employee('db-expert')
  assert.equal(hired.group, 'qwen')
  assert.ok(fs.existsSync(hired.skill.file))
  assert.match(c.messages.at(-1).text, /新同事到岗/)
})

test('meeting minutes are saved into the project, each round is committed, and /撤销 reverts it', async (t) => {
  const work = tmp()
  const c = await rehearsal(t, { workdir: work, meeting: { enabled: true, save: true, maxAttendees: 3 }, git: { autoInit: true, autoCommit: true } })
  c.workdir = work
  for (const g of c.team.groups.values()) g.workdir = work
  await say(c, '帮我做一个记账小网站')
  const file = c.meeting.file
  assert.match(file, /^docs\/meetings\/\d{4}-\d{2}-\d{2}-.+\.md$/)
  assert.match(fs.readFileSync(path.join(work, file), 'utf8'), /## 发言记录/)
  assert.ok(c.lastCommit, 'round was committed')
  assert.match(c.messages.at(-1).text, /已自动存档/)
  await say(c, '/撤销')
  assert.equal(fs.existsSync(path.join(work, file)), false, 'undo removed the minutes again')
  assert.match(c.messages.at(-1).text, /已撤回/)
})

test('/stop halts a running round', async (t) => {
  const c = await rehearsal(t, { dispatchDelayMs: 50 })
  process.env.SHANIU_FAKE_SPEED = '1'
  const done = idle(c)
  c.post('做一个记账小网站')
  await new Promise((r) => {
    c.on('event', function on(ev) {
      if (ev.type === 'task' && ev.task.status === 'running') {
        c.off('event', on)
        r()
      }
    })
  })
  c.post('/stop')
  await done
  assert.ok(c.tasks.every((t) => ['cancelled', 'skipped', 'done'].includes(t.status)), JSON.stringify(c.tasks.map((t) => t.status)))
  assert.ok(c.tasks.some((t) => t.status === 'cancelled'))
  assert.match(c.messages.at(-1).text, /停下/)
})
