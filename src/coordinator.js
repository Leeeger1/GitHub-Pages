import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as git from './git.js'
import { fitScore } from './models.js'
import {
  HELP,
  STATUS_ZH,
  fixPrompt,
  hirePrompt,
  meetingMinutesPrompt,
  meetingSpeechPrompt,
  plannerPrompt,
  rereviewPrompt,
  retryPrompt,
  summaryPrompt,
  taskPrompt,
  toolGuide,
  verifyPrompt,
} from './prompts.js'
import { skillId, writeSkill } from './skills.js'
import { Team } from './team.js'
import { extractJson, firstLine, projectContext, sleep, truncate } from './util.js'

const BAD = new Set(['failed', 'skipped', 'cancelled'])
const DIFFS = new Set(['hard', 'medium', 'easy'])
const LOOKS = new Set(['none', 'glasses', 'headphones', 'cap', 'beret', 'helmet', 'bandana', 'bun'])

export function parseCommand(text, team) {
  const t = String(text).trim()
  let m = t.match(/^\/(\S+)\s*([\s\S]*)$/)
  if (m) {
    const c = m[1].toLowerCase()
    const rest = m[2].trim()
    if (['stop', '停', '停止'].includes(c)) return { type: 'stop' }
    if (['reset', 'clear', '重来'].includes(c)) return { type: 'reset' }
    if (['help', '帮助'].includes(c)) return { type: 'help' }
    if (['undo', '撤销'].includes(c)) return { type: 'undo' }
    if (['team', '团队'].includes(c)) return { type: 'team' }
    if (['tools', '工具', '插件', '工具柜'].includes(c)) return { type: 'tools' }
    if (['hire', '招人', '招聘'].includes(c)) return rest ? { type: 'hire', text: rest } : { type: 'help' }
    const e = team?.resolve(c)
    if (e) return rest ? { type: 'direct', agent: e.id, text: rest } : { type: 'help' }
    return null
  }
  m = t.match(/^@(\S+)\s+([\s\S]+)$/)
  if (m) {
    const e = team?.resolve(m[1])
    if (e) return { type: 'direct', agent: e.id, text: m[2].trim() }
  }
  return null
}

export function parseVerdict(text) {
  const all = [...String(text || '').matchAll(/VERDICT:\s*(APPROVE|CHANGES_REQUESTED)/gi)]
  if (!all.length) return 'unknown'
  return all[all.length - 1][1].toUpperCase() === 'APPROVE' ? 'approve' : 'changes'
}

/** The acceptance check ends with a ```json block; take the last one that has a "done" field. */
export function extractVerdict(text) {
  const blocks = [...String(text || '').matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((m) => m[1]).reverse()
  for (const b of blocks) {
    try {
      const o = JSON.parse(b)
      if (o && typeof o === 'object' && 'done' in o) return normalizeVerdict(o)
    } catch {}
  }
  const o = extractJson(text)
  if (o && typeof o === 'object' && 'done' in o) return normalizeVerdict(o)
  return { done: true, problems: [], tasks: [], unparsed: true }
}

function normalizeVerdict(o) {
  return {
    done: o.done === true || o.done === 'true',
    problems: Array.isArray(o.problems) ? o.problems.map(String).filter(Boolean) : [],
    tasks: Array.isArray(o.tasks) ? o.tasks : [],
  }
}

function makeTask(t) {
  return {
    status: 'pending',
    activity: [],
    result: '',
    error: '',
    startedAt: null,
    endedAt: null,
    cost: null,
    verdict: null,
    fixRound: 0,
    attempts: [],
    difficulty: 'medium',
    why: '',
    iter: 1,
    tools: [],
    ...t,
  }
}

const publicTask = (t) => ({ ...t, basePrompt: undefined, activity: t.activity.slice(-40) })

/** Best available employee for a task, judged by skill fit, model tier vs difficulty, record and load. */
export function pickEmployee(team, { difficulty = 'medium', kind = 'code', exclude = [], load = {}, stats = {}, tools = [] } = {}) {
  let best = null
  for (const e of team.employees) {
    if (exclude.includes(e.id) || !team.isAvailable(e.id)) continue
    if (tools.length && team.canUse && !team.canUse(e.id, tools)) continue
    const g = team.groups.get(e.group)
    let score = fitScore(g.profileFor(difficulty), difficulty)
    if ((kind === 'review' || kind === 'verify') && e.skill.id === 'reviewer') score += 15
    if (kind === 'fix' && e.skill.id === 'debugger') score += 6
    if (e.skill.id === 'generalist') score += 2
    const s = stats[e.id]
    if (s && s.done + s.failed >= 3) score += 6 * (s.done / (s.done + s.failed)) - 3
    score -= 3 * (load[e.id] || 0)
    if (!best || score > best.score) best = { id: e.id, score }
  }
  return best?.id || null
}

/** Turn whatever the planner produced into a clean, acyclic task list for available employees. */
export function normalizeTasks(raw, team, { stats = {}, taken = new Set(), iter = 1 } = {}) {
  if (!Array.isArray(raw)) return []
  const tasks = []
  const load = {}
  raw.forEach((t, i) => {
    if (!t || typeof t !== 'object') return
    const difficulty = DIFFS.has(t.difficulty) ? t.difficulty : 'medium'
    const kind = ['code', 'review', 'research'].includes(t.kind) ? t.kind : 'code'
    let emp = team.resolve(t.agent)
    let why = String(t.why || '').trim()
    // Only keep tools that some employee on duty can actually use.
    let tools = team.tools ? team.tools.resolve(t.tools).filter((x) => team.employees.some((e) => team.isAvailable(e.id) && team.canUse(e.id, [x]))) : []
    if (!emp || !team.isAvailable(emp.id) || (tools.length && !team.canUse(emp.id, tools))) {
      let id = pickEmployee(team, { difficulty, kind, load, stats, tools })
      if (!id) {
        id = pickEmployee(team, { difficulty, kind, load, stats })
        if (id) tools = tools.filter((x) => team.canUse(id, [x]))
      }
      if (!id) return
      if (emp) why = team.isAvailable(emp.id) ? `${emp.name}用不了需要的工具，改派` : `${emp.name}不在岗，改派`
      emp = team.employee(id)
    }
    load[emp.id] = (load[emp.id] || 0) + 1
    let id = String(t.id || `t${i + 1}`).trim().replace(/\s+/g, '-') || `t${i + 1}`
    while (taken.has(id)) id += "'"
    taken.add(id)
    const deps = t.depends_on ?? t.dependsOn ?? t.deps ?? []
    tasks.push(
      makeTask({
        id,
        title: truncate(String(t.title || t.prompt || '任务').trim(), 40),
        agent: emp.id,
        who: emp.name,
        difficulty,
        why,
        kind,
        iter,
        deps: (Array.isArray(deps) ? deps : [deps]).map(String),
        prompt: String(t.prompt || t.title || '').trim(),
        tools,
      }),
    )
  })
  const index = new Map(tasks.map((t, i) => [t.id, i]))
  for (const t of tasks) t.deps = [...new Set(t.deps)].filter((d) => index.has(d) && d !== t.id)
  const stuck = unsortable(tasks)
  for (const t of tasks) if (stuck.has(t.id)) t.deps = t.deps.filter((d) => index.get(d) < index.get(t.id))
  return tasks
}

function unsortable(tasks) {
  const left = new Map(tasks.map((t) => [t.id, new Set(t.deps)]))
  let progress = true
  while (progress) {
    progress = false
    for (const [id, deps] of left) {
      if ([...deps].every((d) => !left.has(d))) {
        left.delete(id)
        progress = true
      }
    }
  }
  return new Set(left.keys())
}

export class Coordinator extends EventEmitter {
  constructor(config, { mode = 'live', root } = {}) {
    super()
    this.config = config
    this.mode = mode
    this.workdir = config.workdir
    this.team = new Team(config, { root, workdir: this.workdir, logDir: config.logDir })
    this.agents = { shaniu: { status: 'idle', text: '', available: true } }
    this.messages = []
    this.tasks = []
    this.round = 0
    this.iteration = 0
    this.busy = false
    this.queue = []
    this.history = []
    this.stopFlag = false
    this.lastCommit = null
    this.meeting = null
    this.minutes = ''
    this.stats = this.loadStats()
    this.toolsIntroduced = new Set()
  }

  // ---- setup ---------------------------------------------------------------

  async init() {
    await this.team.check()
    this.syncAgents()
    const on = [...this.team.groups.values()].filter((g) => g.available)
    const hour = new Date().getHours()
    const hello = hour < 6 ? '主人还没睡呀' : hour < 12 ? '主人早上好' : hour < 18 ? '主人下午好' : '主人晚上好'
    const staff = this.team.employees.filter((e) => this.team.isAvailable(e.id)).length
    const team = on.length
      ? `${on.map((g) => g.name).join('、')}共 ${staff} 位牛马已就位`
      : '可是一个项目组都没到岗（没找到 claude / codex 命令，也没配置 API），先帮傻妞把员工请来吧'
    this.addMessage('shaniu', `${hello}！牛马工作室开工啦～ ${team}。工作目录是 \`${this.workdir}\`。需求说得模糊也没关系，剩下的交给傻妞！`)
  }

  syncAgents() {
    for (const e of this.team.employees) {
      const g = this.team.groups.get(e.group)
      const prev = this.agents[e.id]
      this.agents[e.id] = {
        status: g.available ? (prev && prev.status !== 'offline' ? prev.status : 'idle') : 'offline',
        text: g.available ? prev?.text || '' : g.note || '不在岗',
        available: g.available,
      }
    }
    for (const id of Object.keys(this.agents)) if (id !== 'shaniu' && !this.team.employee(id)) delete this.agents[id]
    this.emitEvent({ type: 'roster', roster: this.rosterView(), agents: this.agents })
  }

  rosterView() {
    const r = this.team.roster()
    for (const e of r.employees) e.stats = this.stats[e.id] || null
    return r
  }

  snapshot() {
    return {
      mode: this.mode,
      workdir: this.workdir,
      busy: this.busy,
      round: this.round,
      iteration: this.iteration,
      roster: this.rosterView(),
      agents: this.agents,
      tasks: this.tasks.map(publicTask),
      messages: this.messages.slice(-100),
      lastCommit: this.lastCommit,
      meeting: this.meeting,
    }
  }

  // ---- events ----------------------------------------------------------------

  emitEvent(ev) {
    this.emit('event', ev)
  }

  setAgent(id, patch) {
    if (!this.agents[id]) return
    Object.assign(this.agents[id], patch)
    this.emitEvent({ type: 'agent', id, ...this.agents[id] })
  }

  addMessage(role, text, extra = {}) {
    const message = { role, text: String(text ?? ''), ts: Date.now(), ...extra }
    this.messages.push(message)
    if (this.messages.length > 300) this.messages.splice(0, this.messages.length - 300)
    this.emitEvent({ type: 'message', message })
  }

  emitTask(t) {
    this.emitEvent({ type: 'task', task: publicTask(t) })
  }

  setBusy(busy) {
    this.busy = busy
    this.emitEvent({ type: 'busy', busy })
  }

  task(id) {
    return this.tasks.find((t) => t.id === id)
  }

  // ---- stats -------------------------------------------------------------------

  loadStats() {
    try {
      return JSON.parse(fs.readFileSync(this.config.statsFile, 'utf8'))
    } catch {
      return {}
    }
  }

  record(t) {
    if (t.kind === 'verify' || !['done', 'failed'].includes(t.status)) return
    const s = (this.stats[t.agent] ||= { done: 0, failed: 0, ms: 0 })
    s[t.status === 'done' ? 'done' : 'failed']++
    if (t.startedAt && t.endedAt) s.ms += t.endedAt - t.startedAt
    try {
      fs.mkdirSync(path.dirname(this.config.statsFile), { recursive: true })
      fs.writeFileSync(this.config.statsFile, JSON.stringify(this.stats, null, 2))
    } catch {}
  }

  // ---- brain -------------------------------------------------------------------

  brain() {
    const want = this.team.groups.get(this.config.brain)
    if (want?.available) return want
    const on = [...this.team.groups.values()].filter((g) => g.available)
    on.sort((a, b) => fitScore(b.profileFor('medium'), 'hard') - fitScore(a.profileFor('medium'), 'hard'))
    return on[0] || null
  }

  async think(prompt, label) {
    const g = this.brain()
    if (!g) throw new Error('没有可用的项目组')
    return g.ask(prompt, { model: this.config.brainModel || g.modelFor('medium'), label })
  }

  // ---- inbox -------------------------------------------------------------------

  post(text) {
    text = String(text || '').trim()
    if (!text) return
    if (parseCommand(text, this.team)?.type === 'stop') {
      this.addMessage('user', text)
      this.stop()
      return
    }
    this.queue.push(text)
    if (this.busy) this.addMessage('system', `已记下，等手上这轮忙完就处理：${truncate(text, 40)}`)
    else this.drain()
  }

  async drain() {
    this.setBusy(true)
    while (this.queue.length) {
      const text = this.queue.shift()
      try {
        await this.handle(text)
      } catch (e) {
        this.setAgent('shaniu', { status: 'error', text: '出岔子了' })
        if (!this.stopFlag) this.addMessage('shaniu', `呜，出了点状况：${e.message}`)
        this.setAgent('shaniu', { status: 'idle', text: '' })
      }
    }
    this.setBusy(false)
  }

  stop() {
    if (!this.busy) {
      this.addMessage('shaniu', '现在没有在跑的活哦，主人。')
      return
    }
    this.stopFlag = true
    this.queue = []
    for (const g of this.team.groups.values()) g.stopAll()
    this.addMessage('shaniu', '收到，全部停下！')
  }

  stopAll() {
    this.stopFlag = true
    for (const g of this.team.groups.values()) g.stopAll()
  }

  // ---- one request -------------------------------------------------------------

  async handle(text) {
    this.stopFlag = false
    this.addMessage('user', text)
    const cmd = parseCommand(text, this.team)
    if (cmd?.type === 'help') return this.addMessage('shaniu', HELP)
    if (cmd?.type === 'reset') {
      this.history = []
      return this.addMessage('shaniu', '好哒，之前聊的傻妞先放下了，我们重新开始～')
    }
    if (cmd?.type === 'team') return this.addMessage('shaniu', this.teamMessage())
    if (cmd?.type === 'tools') return this.addMessage('shaniu', this.toolsMessage())
    if (cmd?.type === 'undo') return this.undo()
    if (cmd?.type === 'hire') return this.hire(cmd.text)

    let plan
    if (cmd?.type === 'direct') {
      const e = this.team.employee(cmd.agent)
      if (!this.team.isAvailable(e.id)) return this.addMessage('shaniu', `${e.name}今天不在岗，派不了哦。`)
      plan = {
        reply: `好的，这件事直接交给${e.name}！`,
        tasks: [{ id: 't1', title: truncate(cmd.text, 24), agent: e.id, difficulty: 'medium', why: '主人点名', kind: 'code', prompt: cmd.text, tools: this.team.tools.guess(cmd.text) }],
        direct: true,
      }
    } else {
      plan = await this.makePlan(text)
    }
    if (this.stopFlag) return

    const taken = new Set()
    let tasks = normalizeTasks(plan.tasks, this.team, { stats: this.stats, taken })
    const wantMeeting = !plan.direct && this.config.meeting?.enabled !== false && plan.meeting?.needed === true
    this.addMessage('shaniu', plan.reply)
    if (!tasks.length && !wantMeeting) {
      this.remember(text, plan.reply, [], '')
      return
    }

    this.round++
    this.iteration = 1
    this.tasks = []
    this.meeting = null
    this.minutes = ''
    this.request = text
    this.emitEvent({ type: 'round', round: this.round, iteration: 1 })
    const base = await this.gitStart()

    if (wantMeeting) {
      const m = await this.holdMeeting(text, plan.meeting)
      if (m?.tasks.length) tasks = normalizeTasks(m.tasks, this.team, { stats: this.stats, taken: new Set() })
    }
    this.tasks = tasks
    for (const t of tasks) this.emitTask(t)
    if (!tasks.length && !this.stopFlag) this.addMessage('shaniu', '会开完了，可是没排出具体任务，主人再说说想先做哪部分？')

    let verdict = null
    for (;;) {
      await this.execute()
      if (this.stopFlag || plan.direct) break
      if (!this.tasks.some((t) => ['code', 'fix'].includes(t.kind) && t.status === 'done')) break
      verdict = await this.verify(base)
      if (this.stopFlag || verdict.done) break
      if (this.iteration >= (this.config.maxIterations ?? 3)) {
        this.addMessage('shaniu', `验收还差一点（${verdict.problems.join('；') || '细节'}），可是已经返工 ${this.iteration} 轮了，剩下的请主人定夺～`)
        break
      }
      const follow = normalizeTasks(verdict.tasks, this.team, { stats: this.stats, iter: this.iteration + 1 })
      if (!follow.length) break
      this.iteration++
      for (const t of follow) {
        t.id = t.id.startsWith(`i${this.iteration}`) ? t.id : `i${this.iteration}-${t.id}`
        t.deps = t.deps.map((d) => `i${this.iteration}-${d}`)
      }
      this.tasks.push(...follow)
      this.emitEvent({ type: 'iteration', iteration: this.iteration, problems: verdict.problems })
      for (const t of follow) this.emitTask(t)
      this.addMessage('shaniu', `验收发现还没完全做好：${verdict.problems.join('；') || '有几处不到位'}。傻妞安排第 ${this.iteration} 轮继续！`)
    }

    const commit = await this.gitFinish(text)
    const summary = await this.summarize(text, verdict, commit)
    this.addMessage('shaniu', summary)
    this.remember(text, plan.reply, this.tasks, summary)
  }

  async makePlan(text) {
    if (!this.brain()) {
      return {
        reply: '呜，一个在岗的项目组都没有，傻妞一个人可写不了代码。请先安装并登录 Claude Code（`npm i -g @anthropic-ai/claude-code`）或 Codex（`npm i -g @openai/codex`），或者在配置里接一个 API 项目组，然后重启我。',
        tasks: [],
      }
    }
    this.setAgent('shaniu', { status: 'thinking', text: '让傻妞想想怎么安排…' })
    try {
      const context = await projectContext(this.workdir)
      const prompt = plannerPrompt({ userText: text, team: this.team, stats: this.stats, context, history: this.history })
      let raw = await this.think(prompt, `plan-r${this.round + 1}`)
      let obj = extractJson(raw)
      if ((!obj || typeof obj !== 'object') && !this.stopFlag) {
        raw = await this.think(`${prompt}\n\n（上一次你没有按格式输出。这次只输出那个 JSON 对象，别的什么都不要写。）`, `plan-r${this.round + 1}-retry`)
        obj = extractJson(raw)
      }
      if (!obj || typeof obj !== 'object') return { reply: truncate(raw.trim(), 2000) || '唔……傻妞没想明白，主人能再说具体一点吗？', tasks: [] }
      const meeting = obj.meeting && typeof obj.meeting === 'object' ? obj.meeting : null
      return { reply: String(obj.reply || '明白，这就安排！'), tasks: Array.isArray(obj.tasks) ? obj.tasks : [], meeting }
    } finally {
      this.setAgent('shaniu', { status: 'idle', text: '' })
    }
  }

  // ---- execution -------------------------------------------------------------

  async execute() {
    const running = new Map()
    const busyEmp = new Set()
    const perGroup = new Map()
    const cap = (g) => g.cfg.maxParallel || (g.type === 'openai-api' ? 3 : 2)
    while (!this.stopFlag) {
      this.skipBlocked()
      const pending = this.tasks.filter((t) => t.status === 'pending')
      if (!pending.length && !running.size) break
      for (const t of pending) {
        if (this.stopFlag) break
        if (!this.config.parallel && running.size) break
        if (busyEmp.has(t.agent)) continue
        const g = this.team.groupOf(t.agent)
        if ((perGroup.get(g.id) || 0) >= cap(g)) continue
        if (!t.deps.every((d) => this.task(d)?.status === 'done')) continue
        // Two employees driving the same mouse would fight: one desktop task at a time.
        if (t.tools.includes('desktop') && [...running.keys()].some((id) => this.task(id)?.tools.includes('desktop'))) continue
        busyEmp.add(t.agent)
        perGroup.set(g.id, (perGroup.get(g.id) || 0) + 1)
        await this.dispatch(t)
        const who = t.agent
        const release = () => {
          running.delete(t.id)
          busyEmp.delete(who)
          perGroup.set(g.id, perGroup.get(g.id) - 1)
        }
        if (this.stopFlag) {
          release()
          break
        }
        running.set(t.id, this.runTask(t).finally(release))
      }
      if (!running.size) {
        for (const t of this.tasks.filter((x) => x.status === 'pending')) {
          Object.assign(t, { status: 'skipped', error: '前置任务没完成' })
          this.emitTask(t)
        }
        break
      }
      await Promise.race(running.values())
    }
    await Promise.allSettled(running.values())
    for (const t of this.tasks.filter((x) => x.status === 'pending')) {
      Object.assign(t, { status: 'cancelled', error: '被叫停' })
      this.emitTask(t)
    }
  }

  skipBlocked() {
    let changed = true
    while (changed) {
      changed = false
      for (const t of this.tasks) {
        if (t.status === 'pending' && t.deps.some((d) => BAD.has(this.task(d)?.status))) {
          Object.assign(t, { status: 'skipped', error: '前置任务没完成' })
          this.emitTask(t)
          changed = true
        }
      }
    }
  }

  async dispatch(t) {
    this.emitEvent({ type: 'dispatch', to: t.agent, taskId: t.id })
    this.setAgent('shaniu', { status: 'walking', text: `${t.who}，交给你啦：${t.title}` })
    await sleep(this.config.dispatchDelayMs || 0)
    this.setAgent('shaniu', { status: 'idle', text: '' })
  }

  async runTask(t) {
    const emp = this.team.employee(t.agent)
    const g = this.team.groups.get(emp.group)
    t.model = g.modelFor(t.difficulty)
    const tools = this.toolsFor(t, g)
    this.introduceTools(t, tools)
    Object.assign(t, { status: 'running', startedAt: Date.now(), endedAt: null, error: '' })
    this.emitTask(t)
    this.setAgent(t.agent, { status: 'working', text: t.title, taskId: t.id })
    const prompt =
      t.kind === 'verify'
        ? t.prompt + toolGuide(tools)
        : taskPrompt({
            task: t,
            employee: emp,
            groupName: g.name,
            tasks: this.tasks,
            userText: this.request,
            workdir: this.workdir,
            parallel: this.config.parallel,
            depResults: t.deps.map((d) => this.task(d)).filter(Boolean),
            minutes: this.minutes,
            tools,
          })
    const timeoutMin = this.config.taskTimeoutMin || 30
    let res
    try {
      res = await g.run({
        prompt,
        model: t.model,
        readOnly: t.kind === 'review' || t.kind === 'verify',
        timeoutMs: (t.kind === 'verify' ? Math.min(timeoutMin, 15) : timeoutMin) * 60 * 1000,
        label: `r${this.round}-${t.id}`,
        onActivity: (a) => this.onActivity(t, a),
        tools,
      })
    } catch (e) {
      res = { ok: false, text: '', error: e.message }
    }
    Object.assign(t, {
      endedAt: Date.now(),
      result: res.text || '',
      cost: res.cost ?? t.cost,
      usage: res.usage || null,
      error: res.ok ? '' : res.error || '失败',
      status: res.ok ? 'done' : this.stopFlag ? 'cancelled' : 'failed',
    })
    this.record(t)

    if (t.status === 'failed' && t.kind !== 'verify' && t.attempts.length < (this.config.maxRetries ?? 1)) {
      if (this.handOff(t)) return
    }
    if (t.kind === 'review' && t.status === 'done') {
      t.verdict = parseVerdict(t.result)
      if (t.verdict === 'changes') this.scheduleFix(t)
    }
    this.emitTask(t)
    if (t.status === 'done') this.setAgent(t.agent, { status: 'done', text: t.verdict === 'changes' ? '有几处要改' : '搞定！', taskId: null })
    else if (t.status === 'cancelled') this.setAgent(t.agent, { status: 'idle', text: '', taskId: null })
    else this.setAgent(t.agent, { status: 'error', text: truncate(t.error, 60), taskId: null })
  }

  /** A worker failed: give the task to someone else (preferably another group) and try again. */
  handOff(t) {
    const prev = { agent: t.agent, who: t.who, error: t.error, result: t.result }
    const load = {}
    for (const x of this.tasks) if (x.status === 'running') load[x.agent] = (load[x.agent] || 0) + 1
    const exclude = [t.agent, ...t.attempts.map((a) => a.agent)]
    const next = pickEmployee(this.team, { difficulty: t.difficulty, kind: t.kind, exclude, load, stats: this.stats, tools: t.tools })
    if (!next) return false
    t.attempts.push(prev)
    const emp = this.team.employee(next)
    t.basePrompt ||= t.prompt
    Object.assign(t, {
      agent: next,
      who: emp.name,
      status: 'pending',
      prompt: retryPrompt({ task: { prompt: t.basePrompt }, previous: prev }),
      why: `${prev.who}没搞定，换人接手`,
      result: '',
    })
    this.emitTask(t)
    this.setAgent(prev.agent, { status: 'error', text: truncate(prev.error, 60), taskId: null })
    this.addMessage('shaniu', `${prev.who}这次没搞定（${truncate(prev.error, 60)}），傻妞换${emp.name}接手！`)
    return true
  }

  onActivity(t, a) {
    const item = { ...a, ts: Date.now() }
    t.activity.push(item)
    if (t.activity.length > 200) t.activity.shift()
    if (this.agents[t.agent]) this.agents[t.agent].text = a.text
    this.emitEvent({ type: 'activity', id: t.agent, taskId: t.id, ...item })
  }

  scheduleFix(review) {
    const round = review.fixRound || 0
    const target = review.deps.map((d) => this.task(d)).find((x) => x && ['code', 'fix'].includes(x.kind))
    if (!target || round >= (this.config.maxFixRounds ?? 1)) return
    const uniq = (base) => {
      let id = base
      while (this.task(id)) id += "'"
      return id
    }
    const author = this.team.isAvailable(target.agent) ? target.agent : pickEmployee(this.team, { difficulty: target.difficulty, exclude: [review.agent] })
    if (!author) return
    const fix = makeTask({
      id: uniq(`${target.id}-fix${round + 1}`),
      title: truncate(`返工：${target.title}`, 40),
      agent: author,
      who: this.team.employee(author).name,
      difficulty: target.difficulty,
      why: '按审查意见返工',
      kind: 'fix',
      iter: review.iter,
      deps: [review.id],
      prompt: fixPrompt({ target, reviewer: review.who }),
      fixRound: round + 1,
      tools: target.tools.filter((x) => this.team.canUse(author, [x])),
    })
    const recheck = makeTask({
      id: uniq(`${review.id}-re${round + 1}`),
      title: truncate(`复审：${target.title}`, 40),
      agent: review.agent,
      who: review.who,
      difficulty: review.difficulty,
      why: '确认返工到位',
      kind: 'review',
      iter: review.iter,
      deps: [fix.id],
      prompt: rereviewPrompt({ target, fixer: fix.who, round }),
      fixRound: round + 1,
      tools: review.tools,
    })
    for (const t of this.tasks) if (t.status === 'pending') t.deps = t.deps.map((d) => (d === review.id ? recheck.id : d))
    this.tasks.splice(this.tasks.indexOf(review) + 1, 0, fix, recheck)
    this.emitTask(fix)
    this.emitTask(recheck)
    this.addMessage('shaniu', `${review.who}挑出了几处问题，傻妞让${fix.who}返工一下，改完再复审～`)
  }

  // ---- project meeting -------------------------------------------------------------

  meetingAttendees(requested) {
    const max = this.config.meeting?.maxAttendees || 4
    const ok = (id) => id && this.team.isAvailable(id)
    const ids = [...new Set((requested || []).map((a) => this.team.resolve(a)?.id).filter(ok))]
    const architect = this.team.employees.find((e) => e.skill.id === 'architect' && ok(e.id))
    if (architect && !ids.includes(architect.id)) ids.unshift(architect.id)
    while (ids.length < 2) {
      const more = pickEmployee(this.team, { difficulty: 'hard', exclude: ids })
      if (!more) break
      ids.push(more)
    }
    return ids.slice(0, max)
  }

  /** Kick-off meeting: everyone proposes, the chair decides and writes minutes plus the task plan. */
  async holdMeeting(text, meeting) {
    const ids = this.meetingAttendees(meeting.attendees)
    if (!ids.length) return null
    const topics = (Array.isArray(meeting.topics) ? meeting.topics : []).map(String).filter(Boolean).slice(0, 8)
    if (!topics.length) topics.push('技术框架', '目录结构', '数据存储')
    const context = await projectContext(this.workdir)
    const names = ids.map((id) => this.team.employee(id).name)
    this.meeting = { topics, attendees: ids, speeches: [], minutes: '', file: '', status: 'open' }
    this.emitEvent({ type: 'meeting', meeting: this.meeting })
    this.addMessage('system', `项目会议开始 · 议题：${topics.join('、')} · 参会：${names.join('、')}`)
    this.setAgent('shaniu', { status: 'meeting', text: '主持会议' })
    for (const id of ids) this.setAgent(id, { status: 'meeting', text: '去会议室' })
    await sleep(this.config.dispatchDelayMs || 0)

    await Promise.all(
      ids.map(async (id) => {
        const emp = this.team.employee(id)
        const g = this.team.groups.get(emp.group)
        this.setAgent(id, { status: 'meeting', text: '想方案…' })
        try {
          const said = (
            await g.ask(meetingSpeechPrompt({ employee: emp, groupName: g.name, userText: text, topics, context }), {
              model: g.modelFor('medium'),
              label: `meet-r${this.round}-${id}`,
            })
          ).trim()
          if (this.stopFlag || !said) return
          const speech = { id, who: emp.name, text: truncate(said, 3000) }
          this.meeting.speeches.push(speech)
          this.addMessage('speech', speech.text, { id, who: emp.name })
          this.setAgent(id, { status: 'meeting', text: firstLine(said, 40) })
        } catch {
          this.setAgent(id, { status: 'meeting', text: '（没想好）' })
        }
      }),
    )

    let result = null
    const chairId = ids.find((id) => this.team.employee(id).skill.id === 'architect') || ids[0]
    const chair = this.team.employee(chairId)
    if (!this.stopFlag && this.meeting.speeches.length) {
      const cg = this.team.groups.get(chair.group)
      this.setAgent(chairId, { status: 'meeting', text: '整理会议纪要…' })
      try {
        const raw = await cg.ask(
          meetingMinutesPrompt({ chair, userText: text, topics, speeches: this.meeting.speeches, context, team: this.team, stats: this.stats }),
          { model: cg.modelFor('hard'), label: `minutes-r${this.round}` },
        )
        const o = extractJson(raw)
        if (o && typeof o === 'object' && (o.minutes || o.tasks)) result = { minutes: String(o.minutes || ''), tasks: Array.isArray(o.tasks) ? o.tasks : [] }
      } catch {}
    }
    if (result?.minutes) {
      this.minutes = result.minutes
      this.meeting.minutes = result.minutes
      this.meeting.file = this.saveMinutes(text, result.minutes)
    }
    this.meeting.status = 'closed'
    this.emitEvent({ type: 'meeting', meeting: this.meeting })
    for (const id of ids) this.setAgent(id, { status: 'idle', text: '' })
    this.setAgent('shaniu', { status: 'idle', text: '' })
    if (this.stopFlag) return null
    this.addMessage(
      'shaniu',
      result?.minutes
        ? `会开完啦！${chair.name}拍板了方案${this.meeting.file ? `，纪要存在 \`${this.meeting.file}\`` : ''}：\n\n${truncate(result.minutes, 2500)}`
        : '会上没讨论出结果，傻妞按原计划安排。',
    )
    return result
  }

  saveMinutes(text, minutes) {
    if (this.config.meeting?.save === false) return ''
    try {
      const d = new Date()
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const slug = skillId(text).slice(0, 40).replace(/^skill-.*/, 'kickoff')
      let rel = path.join('docs', 'meetings', `${date}-${slug}.md`)
      for (let i = 2; fs.existsSync(path.join(this.workdir, rel)); i++) rel = path.join('docs', 'meetings', `${date}-${slug}-${i}.md`)
      const file = path.join(this.workdir, rel)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      const who = this.meeting.attendees.map((id) => this.team.employee(id).name).join('、')
      const speeches = this.meeting.speeches.map((x) => `### ${x.who}\n\n${x.text}`).join('\n\n')
      fs.writeFileSync(file, `# 项目会议纪要\n\n- 需求：${text}\n- 日期：${date}\n- 参会：${who}\n- 议题：${this.meeting.topics.join('、')}\n\n${minutes}\n\n## 发言记录\n\n${speeches}\n`)
      return rel.split(path.sep).join('/')
    } catch {
      return ''
    }
  }

  // ---- acceptance ----------------------------------------------------------------

  verifier() {
    const brain = this.brain()
    const inBrain = this.team.employees.filter((e) => e.group === brain?.id && this.team.isAvailable(e.id))
    return (
      inBrain.find((e) => e.skill.id === 'reviewer')?.id ||
      this.team.employees.find((e) => e.skill.id === 'reviewer' && this.team.isAvailable(e.id))?.id ||
      inBrain[0]?.id ||
      pickEmployee(this.team, { difficulty: 'medium', kind: 'verify' })
    )
  }

  async verify(base) {
    const who = this.verifier()
    if (!who) return { done: true, problems: [], tasks: [] }
    const emp = this.team.employee(who)
    // If this round built or tested web pages in a browser, the checker gets one too.
    const tools = this.tasks.some((x) => x.tools.includes('browser')) && this.team.canUse(who, ['browser']) ? ['browser'] : []
    const t = makeTask({
      id: `v${this.iteration}`,
      tools,
      title: `验收（第 ${this.iteration} 次）`,
      agent: who,
      who: emp.name,
      kind: 'verify',
      difficulty: 'medium',
      why: '对照主人的需求整体检查',
      iter: this.iteration,
      deps: [],
      prompt: verifyPrompt({
        userText: this.request,
        tasks: this.tasks,
        base,
        iteration: this.iteration,
        maxIterations: this.config.maxIterations ?? 3,
        team: this.team,
        stats: this.stats,
        minutes: this.minutes,
      }),
    })
    this.tasks.push(t)
    this.emitTask(t)
    await this.dispatch(t)
    if (this.stopFlag) return { done: true, problems: [], tasks: [] }
    await this.runTask(t)
    if (t.status !== 'done') {
      this.addMessage('shaniu', `验收没跑成（${truncate(t.error, 60)}），这一轮就先到这里。`)
      return { done: true, problems: [], tasks: [] }
    }
    const v = extractVerdict(t.result)
    t.verdict = v.done ? 'approve' : 'changes'
    this.emitTask(t)
    this.setAgent(who, { status: 'done', text: v.done ? '验收通过！' : '还差一点', taskId: null })
    return v
  }

  // ---- git -------------------------------------------------------------------------

  async gitStart() {
    if (!this.config.git?.autoCommit) return null
    try {
      if (!(await git.isRepo(this.workdir))) {
        if (!this.config.git.autoInit || !(await git.initRepo(this.workdir))) return null
        await git.commitAll(this.workdir, '傻妞：初始化仓库（开工前的原始文件）')
        this.addMessage('system', '已把工作目录初始化成 Git 仓库并存了一档：每一轮都会自动存档，说「/撤销」就能撤回。')
      } else if (await git.isDirty(this.workdir)) {
        const h = await git.commitAll(this.workdir, '傻妞：开工前存档（主人未提交的改动）')
        if (h) this.addMessage('system', `开工前先把你没提交的改动存了一档：${h.slice(0, 7)}`)
      }
      return await git.head(this.workdir)
    } catch {
      return null
    }
  }

  async gitFinish(text) {
    if (!this.config.git?.autoCommit) return null
    try {
      if (!(await git.isRepo(this.workdir))) return null
      const lines = this.tasks.filter((t) => t.kind !== 'verify').map((t) => `- [${STATUS_ZH[t.status] || t.status}] ${t.title}（${t.who}）`)
      const h = await git.commitAll(this.workdir, `傻妞${this.stopFlag ? '（中途叫停）' : ''}：${truncate(text.replace(/\s+/g, ' '), 60)}\n\n${lines.join('\n')}`)
      if (h) {
        this.lastCommit = h
        this.emitEvent({ type: 'commit', commit: h })
      }
      return h
    } catch {
      return null
    }
  }

  async undo() {
    if (!this.lastCommit) return this.addMessage('shaniu', '没有可以撤销的存档哦（傻妞只撤销自己这次启动后做的改动）。')
    const r = await git.revertCommit(this.workdir, this.lastCommit)
    if (r.ok) {
      this.addMessage('shaniu', `已撤回上一轮的改动（${this.lastCommit.slice(0, 7)}），撤销本身也存了档：${r.hash.slice(0, 7)}。`)
      this.lastCommit = null
      this.emitEvent({ type: 'commit', commit: null })
    } else this.addMessage('shaniu', `撤销没成功：${r.error}。可能之后又有人改了同样的地方，需要主人手动处理。`)
  }

  // ---- hiring --------------------------------------------------------------------------

  async hire(description) {
    if (!this.brain()) return this.addMessage('shaniu', '现在没有能帮傻妞写岗位说明的项目组。')
    this.setAgent('shaniu', { status: 'thinking', text: '写招聘启事…' })
    try {
      const raw = await this.think(hirePrompt({ description, team: this.team }), 'hire')
      const o = extractJson(raw)
      if (!o || !o.name || !o.instructions) return this.addMessage('shaniu', '唔，岗位说明没写好，主人再描述具体一点？')
      const group = this.team.groups.has(o.group) ? o.group : this.brain().id
      const id = skillId(o.id || o.name)
      const file = writeSkill(path.join(os.homedir(), '.niuma', 'skills'), {
        id,
        name: String(o.name),
        description: String(o.description || ''),
        group,
        look: LOOKS.has(o.look) ? o.look : 'none',
        instructions: String(o.instructions),
      })
      this.team.load()
      this.syncAgents()
      const emp = this.team.employees.find((e) => e.skill.file === file)
      this.emitEvent({ type: 'hired', id: emp?.id })
      this.addMessage(
        'shaniu',
        `新同事到岗啦！**${o.name}**，坐在${this.team.groups.get(group).name}：${o.description}\n岗位说明存在 \`${file}\`，主人随时可以改。`,
      )
    } finally {
      this.setAgent('shaniu', { status: 'idle', text: '' })
    }
  }

  /** Tool specs for a run: what the plugin is, and how to start it when the worker doesn't load it itself. */
  toolsFor(t, g) {
    return t.tools
      .map((id) => this.team.tools.get(id))
      .filter((x) => x && this.team.tools.supports(g, x.id))
      .map((x) => ({ ...x, ...(this.team.tools.spec(x.id) || {}) }))
  }

  introduceTools(t, tools) {
    for (const x of tools) {
      if (x.takesOver) {
        this.addMessage('shaniu', `注意：${t.who}要接管电脑操作了（${t.title}）。这段时间屏幕上的鼠标会自己动，主人先别碰鼠标键盘哦～ 想叫停随时说 /stop`)
        continue
      }
      if (this.toolsIntroduced.has(x.id)) continue
      this.toolsIntroduced.add(x.id)
      const download = x.source === 'builtin' && x.id === 'browser' ? '（第一次用会自动下载插件，稍等一小会儿）' : ''
      this.addMessage('shaniu', `这个活要用${x.name}，傻妞给${t.who}配好啦～${download}`)
    }
  }

  toolsMessage() {
    const tools = this.team.tools.list()
    if (!tools.length) return '工具柜现在是空的。'
    const groups = [...this.team.groups.values()].filter((g) => g.available)
    const lines = tools.map((x) => {
      const who = groups.filter((g) => this.team.tools.supports(g, x.id)).map((g) => g.name)
      const from = x.source === 'installed' ? '（主人自己装的）' : x.source === 'config' ? '（配置里加的）' : ''
      return `- **${x.name}**${from}：${x.description}\n  能用的组：${who.length ? who.join('、') : '暂时没有'}`
    })
    return `工具柜里现在有这些插件。派活时需要哪个，傻妞会自动给员工配好，第一次用会自动下载：\n${lines.join('\n')}\n\n想加别的插件：装进 Claude Code（\`claude mcp add …\`）或 Codex，傻妞重启后会自动发现；也可以写进配置文件的 \`tools\` 里。`
  }

  teamMessage() {
    const lines = []
    for (const g of this.team.groups.values()) {
      lines.push(`**${g.name}**（${g.available ? '在岗' : `不在岗：${g.note}`}）${this.team.modelsLine(g)}`)
      for (const e of this.team.employees.filter((x) => x.group === g.id)) {
        const s = this.stats[e.id]
        lines.push(`- \`${e.id}\` ${e.name}：${e.skill.description}${s ? `（完成 ${s.done}，失败 ${s.failed}）` : ''}`)
      }
    }
    return lines.join('\n')
  }

  // ---- report ------------------------------------------------------------------------------

  async summarize(text, verdict, commit) {
    const tasks = this.tasks
    const work = tasks.filter((t) => t.kind !== 'verify')
    const done = work.filter((t) => t.status === 'done')
    const saved = commit ? `\n\n已自动存档：\`${commit.slice(0, 7)}\`，不满意就说「/撤销」。` : ''
    if (this.stopFlag) return `已经停下啦。完成了 ${done.length} 个任务，${work.length - done.length} 个没做完。${saved}`
    if (!work.length) return `这一轮没有派出任务。${saved}`
    const template = () => {
      const lines = work.map((t) => `- ${STATUS_ZH[t.status]}｜${t.title}（${t.who}）${t.error ? `：${t.error}` : ''}`)
      return `${done.length === work.length ? '这一轮都搞定啦：' : '这一轮有些没做完：'}\n${lines.join('\n')}${saved}`
    }
    if (work.length === 1 && tasks.length === 1) {
      const t = work[0]
      return (t.status === 'done' ? `${t.who}交活啦：\n\n${truncate(t.result, 3000)}` : `${t.who}没做成：${t.error}`) + saved
    }
    if (!this.brain()) return template()
    this.setAgent('shaniu', { status: 'thinking', text: '整理汇报…' })
    try {
      const changes = commit ? await git.changedFiles(this.workdir, null) : ''
      const out = await this.think(summaryPrompt({ userText: text, tasks, changes, verdict, commit }), `summary-r${this.round}`)
      return (out.trim() || template()) + saved
    } catch {
      return template()
    } finally {
      this.setAgent('shaniu', { status: 'idle', text: '' })
    }
  }

  remember(user, reply, tasks, summary) {
    this.history.push({
      user,
      reply,
      summary: truncate(summary, 600),
      tasks: tasks.filter((t) => t.kind !== 'verify').map((t) => ({ title: t.title, who: t.who, status: STATUS_ZH[t.status] || t.status })),
    })
    const keep = this.config.historyRounds ?? 6
    if (this.history.length > keep) this.history.splice(0, this.history.length - keep)
  }
}
