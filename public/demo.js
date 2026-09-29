/* Demo mode: plays a scripted round so the office can be seen without a local Mavis server.
   It emits exactly the same events the real server sends. */
;(function () {
  'use strict'

  const NAMES = { claude: 'Claude', codex: 'Codex' }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const jitter = (a, b) => a + Math.random() * (b - a)

  const STEPS = {
    theme: [
      ['tool', '搜 “theme”'],
      ['tool', '读 src/components/Header.jsx'],
      ['tool', '读 src/styles/theme.css'],
      ['say', '先把颜色抽成 CSS 变量，再加开关'],
      ['tool', '改 src/styles/theme.css'],
      ['tool', '写 src/components/ThemeToggle.jsx'],
      ['tool', '改 src/components/Header.jsx'],
      ['tool', '跑 npm run build'],
    ],
    tests: [
      ['think', 'Planning theme tests'],
      ['tool', '跑 ls test'],
      ['tool', '读 package.json'],
      ['tool', '改 test/theme.test.js'],
      ['tool', '跑 npm test'],
      ['warn', '命令没跑通（退出码 1）'],
      ['tool', '改 test/theme.test.js'],
      ['tool', '跑 npm test'],
      ['say', '12 个用例全部通过'],
    ],
    review: [
      ['tool', '跑 git diff --stat'],
      ['tool', '跑 git diff src/components'],
      ['tool', '读 src/components/ThemeToggle.jsx'],
      ['tool', '跑 npm test'],
      ['say', '改动清晰，没发现阻塞问题'],
    ],
    generic: [
      ['tool', '跑 git status --short'],
      ['tool', '搜 “TODO”'],
      ['tool', '读 src/index.js'],
      ['tool', '改 src/index.js'],
      ['tool', '写 src/feature.js'],
      ['tool', '跑 npm test'],
    ],
  }

  window.MavisDemo = function (emit) {
    const agents = {
      mavis: { status: 'idle', text: '', available: true },
      claude: { status: 'idle', text: '', available: true, version: '演示' },
      codex: { status: 'idle', text: '', available: true, version: '演示' },
    }
    let tasks = []
    let round = 0
    let busy = false
    let epoch = 0
    const queue = []

    const now = () => Date.now()
    const agent = (id, patch) => {
      Object.assign(agents[id], patch)
      emit({ type: 'agent', id, ...agents[id] })
    }
    const msg = (role, text) => emit({ type: 'message', message: { role, text, ts: now() } })
    const put = (t) => emit({ type: 'task', task: { ...t } })

    emit({
      type: 'snapshot',
      state: { mode: 'demo', workdir: '~/projects/pixel-blog', busy: false, round: 0, agents, tasks: [], messages: [] },
    })
    msg('mavis', '晚上好，老板。我是 Mavis。Claude 和 Codex 都已就位，工作目录是 `~/projects/pixel-blog`。有什么吩咐？')

    async function runTask(t, my) {
      Object.assign(t, { status: 'running', startedAt: now() })
      put(t)
      agent(t.agent, { status: 'working', text: t.title, taskId: t.id })
      for (const [kind, text] of t.steps) {
        await wait(jitter(1100, 2100))
        if (my !== epoch) return
        const a = { kind, text, ts: now() }
        t.activity.push(a)
        emit({ type: 'activity', id: t.agent, taskId: t.id, ...a })
      }
      await wait(800)
      if (my !== epoch) return
      Object.assign(t, { status: 'done', endedAt: now(), result: t.report, verdict: t.kind === 'review' ? t.verdict || 'approve' : null })
      put(t)
      agent(t.agent, { status: 'done', text: t.verdict === 'changes' ? '有几处要改' : '搞定！', taskId: null })
      if (t.onDone) t.onDone(t)
    }

    async function execute(my) {
      const running = new Map()
      const busyAgents = new Set()
      while (my === epoch) {
        const pending = tasks.filter((t) => t.status === 'pending')
        if (!pending.length && !running.size) break
        for (const t of pending) {
          if (busyAgents.has(t.agent) || !t.deps.every((d) => tasks.find((x) => x.id === d).status === 'done')) continue
          busyAgents.add(t.agent)
          emit({ type: 'dispatch', to: t.agent, taskId: t.id })
          agent('mavis', { status: 'walking', text: '' })
          await wait(1600)
          if (my !== epoch) return
          agent('mavis', { status: 'idle', text: '' })
          const p = runTask(t, my).finally(() => {
            running.delete(t.id)
            busyAgents.delete(t.agent)
          })
          running.set(t.id, p)
        }
        if (!running.size) break
        await Promise.race(running.values())
      }
    }

    const mk = (t) => ({ status: 'pending', deps: [], activity: [], result: '', error: '', startedAt: null, endedAt: null, kind: 'code', ...t })

    function plan(text) {
      if (/^(你好|hi|hello|在吗|谢谢)/i.test(text.trim()) || text.trim().length < 5) {
        return { reply: '随时待命，老板。说一个具体的开发需求，我就派活给他们俩。', tasks: [] }
      }
      if (/暗色|主题|dark/i.test(text)) {
        return {
          reply: '收到。Claude 负责主题样式和开关按钮，Codex 同时写测试；Claude 写完后让 Codex 审一遍。',
          tasks: [
            mk({ id: 't1', title: '暗色主题与切换开关', agent: 'claude', prompt: '把颜色抽成 CSS 变量，新增 ThemeToggle 组件并放进 Header。只改 src/ 下的文件。', steps: STEPS.theme, report: '完成：\n- src/styles/theme.css 抽出颜色变量，新增 [data-theme=dark]\n- 新增 src/components/ThemeToggle.jsx\n- Header 里挂上开关\n- npm run build 通过' }),
            mk({ id: 't2', title: '主题切换的单元测试', agent: 'codex', prompt: '为主题切换写单元测试，只改 test/ 下的文件，并跑通。', steps: STEPS.tests, report: '新增 test/theme.test.js，12 个用例，全部通过。' }),
            mk({ id: 't3', title: '审查主题改动', agent: 'codex', kind: 'review', deps: ['t1'], prompt: '审查 t1 的改动：可访问性、持久化、样式回归。', steps: STEPS.review, report: '改动清晰，开关有 aria-label，主题写进了 localStorage。\n\nVERDICT: APPROVE' }),
          ],
          summary: '**搞定了，老板。**\n\n- Claude 把颜色抽成了变量，新增 `ThemeToggle` 并放进了页头\n- Codex 写了 `test/theme.test.js`，12 个用例全绿\n- Codex 审查通过，没有阻塞问题\n\n改动还没提交，您过目后再 commit。',
        }
      }
      const strict = /严格/.test(text)
      const topic = text.replace(/^严格审查[:：]?\s*/, '').slice(0, 16)
      const t1 = mk({ id: 't1', title: `实现：${topic}`, agent: 'claude', prompt: `实现老板的需求：${text}`, steps: STEPS.generic, report: `完成「${topic}」的主体实现，改了 src/index.js，新增 src/feature.js。` })
      const t2 = mk({ id: 't2', title: '补测试并跑通', agent: 'codex', prompt: `为「${topic}」补充测试并运行。`, steps: STEPS.tests, report: '新增 8 个用例，全部通过。' })
      const t3 = mk({
        id: 't3', title: '审查主体改动', agent: 'codex', kind: 'review', deps: ['t1'], prompt: '审查 t1 的改动。', steps: STEPS.review,
        report: strict ? '发现 2 个问题：\n1. 边界输入没有校验\n2. 错误信息直接暴露了堆栈\n\nVERDICT: CHANGES_REQUESTED' : '没发现阻塞问题。\n\nVERDICT: APPROVE',
        verdict: strict ? 'changes' : 'approve',
      })
      if (strict) {
        t3.onDone = () => {
          const fix = mk({ id: 't1-fix1', title: `返工：${t1.title}`, agent: 'claude', kind: 'fix', deps: ['t3'], prompt: '按 Codex 的审查意见逐条修改。', steps: STEPS.generic.slice(2), report: '两处都改了：加了输入校验，错误信息改成友好提示。' })
          const re = mk({ id: 't3-re1', title: `复审：${t1.title}`, agent: 'codex', kind: 'review', deps: ['t1-fix1'], prompt: '复审：确认上一轮的问题已解决。', steps: STEPS.review.slice(0, 3), report: '两个问题都已修复。\n\nVERDICT: APPROVE' })
          tasks.splice(3, 0, fix, re)
          put(fix)
          put(re)
          msg('mavis', 'Codex 挑出了几处问题，我让 Claude 返工一下，改完再复审。')
        }
      }
      return {
        reply: strict ? '明白，这次审严一点。Claude 写实现，Codex 写测试并负责审查。' : '收到。Claude 负责主体实现，Codex 同时写测试，最后 Codex 审一遍。',
        tasks: [t1, t2, t3],
        summary: `**这一轮搞定了，老板。**\n\n- Claude 完成了「${topic}」的实现${strict ? '，并按审查意见返工了一次' : ''}\n- Codex 补了测试，全部通过\n- 审查${strict ? '复审' : ''}通过\n\n（演示模式：以上都是演的）`,
      }
    }

    async function handleText(text, my) {
      msg('user', text)
      agent('mavis', { status: 'thinking', text: '让我想想怎么安排…' })
      await wait(2200)
      if (my !== epoch) return
      agent('mavis', { status: 'idle', text: '' })
      const p = plan(text)
      msg('mavis', p.reply)
      if (!p.tasks.length) return
      round++
      tasks = p.tasks
      emit({ type: 'round', round })
      tasks.forEach(put)
      await execute(my)
      if (my !== epoch) return
      agent('mavis', { status: 'thinking', text: '整理汇报…' })
      await wait(1600)
      if (my !== epoch) return
      agent('mavis', { status: 'idle', text: '' })
      msg('mavis', p.summary)
    }

    async function drain() {
      if (busy) return
      busy = true
      emit({ type: 'busy', busy: true })
      const my = epoch
      while (queue.length && my === epoch) await handleText(queue.shift(), my)
      if (my !== epoch) return
      busy = false
      emit({ type: 'busy', busy: false })
    }

    const post = (text) => {
      if (/^\/stop$/.test(text.trim())) return stop()
      queue.push(text)
      if (busy) msg('system', `已记下，等手上这轮忙完就处理：${text.slice(0, 40)}`)
      drain()
    }

    function stop() {
      if (!busy) {
        msg('mavis', '现在没有在跑的活，老板。')
        return
      }
      epoch++
      queue.length = 0
      for (const t of tasks) {
        if (t.status === 'pending' || t.status === 'running') {
          Object.assign(t, { status: 'cancelled', error: '被叫停', endedAt: now() })
          put(t)
        }
      }
      for (const id of ['mavis', 'claude', 'codex']) agent(id, { status: 'idle', text: '', taskId: null })
      msg('mavis', '收到，全部停下。')
      busy = false
      emit({ type: 'busy', busy: false })
    }

    setTimeout(() => {
      if (!busy && round === 0) post('给博客加一个暗色模式开关，顺便把测试补上')
    }, 900)

    return {
      send: async (text) => post(text),
      stop: async () => stop(),
    }
  }
})()
