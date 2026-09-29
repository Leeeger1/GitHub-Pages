import { EventEmitter } from 'node:events'
import { AgentRunner, AGENT_NAMES } from './agents.js'
import { HELP, STATUS_ZH, fixPrompt, plannerPrompt, rereviewPrompt, summaryPrompt, taskPrompt } from './prompts.js'
import { extractJson, gitChanges, projectContext, sleep, truncate } from './util.js'

const WORKERS = ['claude', 'codex']
const name = (id) => AGENT_NAMES[id] || id
const FINISHED_BAD = new Set(['failed', 'skipped', 'cancelled'])

export function parseCommand(text) {
  const m = text.match(/^[/@](\w+)\s*([\s\S]*)$/)
  if (!m) return null
  const cmd = m[1].toLowerCase()
  const rest = m[2].trim()
  if (WORKERS.includes(cmd)) return rest ? { type: 'direct', agent: cmd, text: rest } : { type: 'help' }
  if (text.startsWith('/')) {
    if (cmd === 'stop') return { type: 'stop' }
    if (cmd === 'reset' || cmd === 'clear') return { type: 'reset' }
    if (cmd === 'help') return { type: 'help' }
  }
  return null
}

export function parseVerdict(text) {
  const all = [...String(text || '').matchAll(/VERDICT:\s*(APPROVE|CHANGES_REQUESTED)/gi)]
  if (!all.length) return 'unknown'
  return all[all.length - 1][1].toUpperCase() === 'APPROVE' ? 'approve' : 'changes'
}

/** Turn whatever the planner produced into a clean, acyclic task list for available agents. */
export function normalizeTasks(raw, isAvailable) {
  if (!Array.isArray(raw)) return []
  const ids = new Set()
  const tasks = []
  raw.forEach((t, i) => {
    if (!t || typeof t !== 'object') return
    let agent = String(t.agent || '').toLowerCase().includes('codex') ? 'codex' : 'claude'
    if (!isAvailable(agent)) agent = agent === 'claude' ? 'codex' : 'claude'
    if (!isAvailable(agent)) return
    let id = String(t.id || `t${i + 1}`).trim().replace(/\s+/g, '-') || `t${i + 1}`
    while (ids.has(id)) id += "'"
    ids.add(id)
    const deps = t.depends_on ?? t.dependsOn ?? t.deps ?? []
    tasks.push(
      makeTask({
        id,
        title: truncate(String(t.title || t.prompt || '任务').trim(), 40),
        agent,
        kind: ['code', 'review', 'research'].includes(t.kind) ? t.kind : 'code',
        deps: (Array.isArray(deps) ? deps : [deps]).map(String),
        prompt: String(t.prompt || t.title || '').trim(),
      }),
    )
  })
  const index = new Map(tasks.map((t, i) => [t.id, i]))
  for (const t of tasks) t.deps = [...new Set(t.deps)].filter((d) => index.has(d) && d !== t.id)
  // Break cycles: tasks stuck in a cycle may only depend on tasks listed before them.
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
    ...t,
  }
}

const publicTask = (t) => ({ ...t, activity: t.activity.slice(-40) })

export class Coordinator extends EventEmitter {
  constructor(config, { mode = 'live' } = {}) {
    super()
    this.config = config
    this.mode = mode
    this.workdir = config.workdir
    this.runners = Object.fromEntries(
      WORKERS.map((id) => [id, new AgentRunner(id, config.agents[id], { workdir: this.workdir, logDir: config.logDir })]),
    )
    this.agents = {
      mavis: { status: 'idle', text: '', available: true },
      claude: { status: 'offline', text: '检查中…', available: false },
      codex: { status: 'offline', text: '检查中…', available: false },
    }
    this.messages = []
    this.tasks = []
    this.round = 0
    this.busy = false
    this.queue = []
    this.history = []
    this.stopFlag = false
  }

  async init() {
    await Promise.all(
      WORKERS.map(async (id) => {
        if (this.config.agents[id]?.enabled === false) {
          this.setAgent(id, { status: 'offline', available: false, text: '在配置里停用了' })
          return
        }
        const r = await this.runners[id].check()
        this.setAgent(
          id,
          r.available
            ? { status: 'idle', available: true, version: r.version, text: '' }
            : { status: 'offline', available: false, text: `没找到 ${id} 命令` },
        )
      }),
    )
    const on = WORKERS.filter((id) => this.agents[id].available).map(name)
    const hour = new Date().getHours()
    const hello = hour < 6 ? '这么晚还在忙' : hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好'
    const team = on.length === 2 ? 'Claude 和 Codex 都已就位' : on.length ? `今天只有 ${on[0]} 在岗` : '两位工程师都还没到岗（没找到 claude / codex 命令）'
    this.addMessage('mavis', `${hello}，老板。我是 Mavis。${team}，工作目录是 \`${this.workdir}\`。有什么吩咐？`)
  }

  snapshot() {
    return {
      mode: this.mode,
      workdir: this.workdir,
      busy: this.busy,
      round: this.round,
      agents: this.agents,
      tasks: this.tasks.map(publicTask),
      messages: this.messages.slice(-100),
    }
  }

  emitEvent(ev) {
    this.emit('event', ev)
  }

  setAgent(id, patch) {
    Object.assign(this.agents[id], patch)
    this.emitEvent({ type: 'agent', id, ...this.agents[id] })
  }

  addMessage(role, text) {
    const message = { role, text: String(text ?? ''), ts: Date.now() }
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

  isAvailable = (id) => !!this.agents[id]?.available

  brain() {
    const first = this.config.planner === 'codex' ? 'codex' : 'claude'
    return [first, first === 'claude' ? 'codex' : 'claude'].find(this.isAvailable) || null
  }

  // ---- inbox -------------------------------------------------------------

  post(text) {
    text = String(text || '').trim()
    if (!text) return
    if (parseCommand(text)?.type === 'stop') {
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
        this.setAgent('mavis', { status: 'error', text: '出岔子了' })
        if (!this.stopFlag) this.addMessage('mavis', `抱歉老板，出了点状况：${e.message}`)
        this.setAgent('mavis', { status: 'idle', text: '' })
      }
    }
    this.setBusy(false)
  }

  stop() {
    if (!this.busy) {
      this.addMessage('mavis', '现在没有在跑的活，老板。')
      return
    }
    this.stopFlag = true
    this.queue = []
    for (const r of Object.values(this.runners)) r.stopAll()
    this.addMessage('mavis', '收到，全部停下。')
  }

  stopAll() {
    this.stopFlag = true
    for (const r of Object.values(this.runners)) r.stopAll()
  }

  // ---- one round -----------------------------------------------------------

  async handle(text) {
    this.stopFlag = false
    this.addMessage('user', text)
    const cmd = parseCommand(text)
    if (cmd?.type === 'help') return this.addMessage('mavis', HELP)
    if (cmd?.type === 'reset') {
      this.history = []
      return this.addMessage('mavis', '好的，之前聊过的我先放下了，咱们重新开始。')
    }

    let plan
    if (cmd?.type === 'direct') {
      if (!this.isAvailable(cmd.agent)) return this.addMessage('mavis', `${name(cmd.agent)} 今天不在岗，派不了。`)
      plan = {
        reply: `好的，直接交给 ${name(cmd.agent)}。`,
        tasks: [{ id: 't1', title: truncate(cmd.text, 24), agent: cmd.agent, kind: 'code', prompt: cmd.text }],
      }
    } else {
      plan = await this.makePlan(text)
    }
    if (this.stopFlag) return

    const tasks = normalizeTasks(plan.tasks, this.isAvailable)
    this.addMessage('mavis', plan.reply)
    if (!tasks.length) {
      this.remember(text, plan.reply, [], '')
      return
    }

    this.round++
    this.tasks = tasks
    this.request = text
    this.emitEvent({ type: 'round', round: this.round })
    for (const t of tasks) this.emitTask(t)

    await this.execute()
    const summary = await this.summarize(text)
    this.addMessage('mavis', summary)
    this.remember(text, plan.reply, tasks, summary)
  }

  async makePlan(text) {
    const brain = this.brain()
    if (!brain) {
      return {
        reply: '两位工程师都没到岗，我一个人可写不了代码。请先安装 Claude Code（`npm i -g @anthropic-ai/claude-code`）或 Codex（`npm i -g @openai/codex`）并登录，然后重启我。',
        tasks: [],
      }
    }
    this.setAgent('mavis', { status: 'thinking', text: '让我想想怎么安排…' })
    try {
      const context = await projectContext(this.workdir)
      const prompt = plannerPrompt({ userText: text, agents: this.agents, config: this.config, context, history: this.history })
      const raw = await this.runners[brain].ask(prompt, {
        model: this.config.plannerModel,
        label: `plan-r${this.round + 1}`,
      })
      const obj = extractJson(raw)
      if (!obj || typeof obj !== 'object') return { reply: truncate(raw.trim(), 2000) || '嗯……我没想好，老板能再说具体点吗？', tasks: [] }
      return { reply: String(obj.reply || '明白，这就安排。'), tasks: Array.isArray(obj.tasks) ? obj.tasks : [] }
    } finally {
      this.setAgent('mavis', { status: 'idle', text: '' })
    }
  }

  async execute() {
    const running = new Map()
    const busyAgents = new Set()
    while (!this.stopFlag) {
      this.skipBlocked()
      const pending = this.tasks.filter((t) => t.status === 'pending')
      if (!pending.length && !running.size) break
      for (const t of pending) {
        if (this.stopFlag) break
        if (!this.config.parallel && running.size) break
        if (busyAgents.has(t.agent)) continue
        if (!t.deps.every((d) => this.task(d)?.status === 'done')) continue
        busyAgents.add(t.agent)
        await this.dispatch(t)
        if (this.stopFlag) {
          busyAgents.delete(t.agent)
          break
        }
        const p =this.runTask(t).finally(() => {
          running.delete(t.id)
          busyAgents.delete(t.agent)
        })
        running.set(t.id, p)
      }
      if (!running.size) {
        // Nothing can start and nothing is running: whatever is left can never run.
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
        if (t.status === 'pending' && t.deps.some((d) => FINISHED_BAD.has(this.task(d)?.status))) {
          Object.assign(t, { status: 'skipped', error: '前置任务没完成' })
          this.emitTask(t)
          changed = true
        }
      }
    }
  }

  async dispatch(t) {
    this.emitEvent({ type: 'dispatch', to: t.agent, taskId: t.id })
    this.setAgent('mavis', { status: 'walking', text: `${name(t.agent)}，这个交给你：${t.title}` })
    await sleep(this.config.dispatchDelayMs || 0)
    this.setAgent('mavis', { status: 'idle', text: '' })
  }

  async runTask(t) {
    Object.assign(t, { status: 'running', startedAt: Date.now() })
    this.emitTask(t)
    this.setAgent(t.agent, { status: 'working', text: t.title, taskId: t.id })
    const depResults = t.deps.map((d) => this.task(d)).filter(Boolean)
    const prompt = taskPrompt({
      task: t,
      tasks: this.tasks,
      userText: this.request,
      workdir: this.workdir,
      parallel: this.config.parallel,
      depResults,
    })
    let res
    try {
      res = await this.runners[t.agent].run({
        prompt,
        readOnly: t.kind === 'review',
        timeoutMs: (this.config.taskTimeoutMin || 30) * 60 * 1000,
        label: `r${this.round}-${t.id}`,
        onActivity: (a) => this.onActivity(t, a),
      })
    } catch (e) {
      res = { ok: false, text: '', error: e.message }
    }
    Object.assign(t, {
      endedAt: Date.now(),
      result: res.text || '',
      cost: res.cost ?? null,
      error: res.ok ? '' : res.error || '失败',
      status: res.ok ? 'done' : this.stopFlag ? 'cancelled' : 'failed',
    })
    if (t.kind === 'review' && t.status === 'done') {
      t.verdict = parseVerdict(t.result)
      if (t.verdict === 'changes') this.scheduleFix(t)
    }
    this.emitTask(t)
    if (t.status === 'done') this.setAgent(t.agent, { status: 'done', text: t.verdict === 'changes' ? '有几处要改' : '搞定！', taskId: null })
    else if (t.status === 'cancelled') this.setAgent(t.agent, { status: 'idle', text: '', taskId: null })
    else this.setAgent(t.agent, { status: 'error', text: truncate(t.error, 60), taskId: null })
  }

  onActivity(t, a) {
    const item = { ...a, ts: Date.now() }
    t.activity.push(item)
    if (t.activity.length > 200) t.activity.shift()
    this.agents[t.agent].text = a.text
    this.emitEvent({ type: 'activity', id: t.agent, taskId: t.id, ...item })
  }

  scheduleFix(review) {
    const round = review.fixRound || 0
    const target = review.deps.map((d) => this.task(d)).find((x) => x && x.kind !== 'review' && x.kind !== 'research')
    if (!target || round >= (this.config.maxFixRounds ?? 1)) {
      if (target) this.addMessage('mavis', `${name(review.agent)} 还有意见，但返工次数到上限了，留给老板定夺。`)
      return
    }
    const uniq = (base) => {
      let id = base
      while (this.task(id)) id += "'"
      return id
    }
    const fix = makeTask({
      id: uniq(`${target.id}-fix${round + 1}`),
      title: truncate(`返工：${target.title}`, 40),
      agent: target.agent,
      kind: 'fix',
      deps: [review.id],
      prompt: fixPrompt({ target, reviewer: review.agent }),
      fixRound: round + 1,
    })
    const recheck = makeTask({
      id: uniq(`${review.id}-re${round + 1}`),
      title: truncate(`复审：${target.title}`, 40),
      agent: review.agent,
      kind: 'review',
      deps: [fix.id],
      prompt: rereviewPrompt({ target, fixer: target.agent, round }),
      fixRound: round + 1,
    })
    for (const t of this.tasks) {
      if (t.status === 'pending') t.deps = t.deps.map((d) => (d === review.id ? recheck.id : d))
    }
    const at = this.tasks.indexOf(review) + 1
    this.tasks.splice(at, 0, fix, recheck)
    this.emitTask(fix)
    this.emitTask(recheck)
    this.addMessage('mavis', `${name(review.agent)} 挑出了几处问题，我让 ${name(target.agent)} 返工一下，改完再复审。`)
  }

  async summarize(text) {
    const tasks = this.tasks
    const done = tasks.filter((t) => t.status === 'done')
    const failed = tasks.filter((t) => t.status !== 'done')
    if (this.stopFlag) return `已经停下。完成了 ${done.length} 个任务，${failed.length} 个没做完。`
    const template = () => {
      const lines = tasks.map((t) => `- ${STATUS_ZH[t.status]}｜${t.title}（${name(t.agent)}）${t.error ? `：${t.error}` : ''}`)
      return `${failed.length ? '这一轮有些没做完：' : '这一轮都搞定了：'}\n${lines.join('\n')}`
    }
    if (tasks.length === 1) {
      const t = tasks[0]
      return t.status === 'done' ? `${name(t.agent)} 交活了：\n\n${truncate(t.result, 3000)}` : `${name(t.agent)} 没做成：${t.error}`
    }
    const brain = this.brain()
    if (!this.config.summarize || !brain) return template()
    this.setAgent('mavis', { status: 'thinking', text: '整理汇报…' })
    try {
      const changes = await gitChanges(this.workdir)
      const out = await this.runners[brain].ask(summaryPrompt({ userText: text, tasks, changes }), {
        model: this.config.plannerModel,
        label: `summary-r${this.round}`,
      })
      return out.trim() || template()
    } catch {
      return template()
    } finally {
      this.setAgent('mavis', { status: 'idle', text: '' })
    }
  }

  remember(user, reply, tasks, summary) {
    this.history.push({
      user,
      reply,
      summary: truncate(summary, 600),
      tasks: tasks.map((t) => ({ title: t.title, agent: t.agent, status: STATUS_ZH[t.status] || t.status })),
    })
    const keep = this.config.historyRounds ?? 6
    if (this.history.length > keep) this.history.splice(0, this.history.length - keep)
  }
}
