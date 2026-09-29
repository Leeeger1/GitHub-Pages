/* Demo mode: plays scripted rounds so the studio can be seen without a local 傻妞 server.
   It emits exactly the same events the real server sends. */
;(function () {
  'use strict'

  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const jitter = (a, b) => a + Math.random() * (b - a)

  const GROUPS = [
    { id: 'claude', name: 'Claude 组', type: 'claude-cli', typeLabel: 'Claude Code', color: '#c4602f', models: { hard: 'opus', medium: 'sonnet', easy: 'haiku' } },
    { id: 'codex', name: 'Codex 组', type: 'codex-cli', typeLabel: 'Codex', color: '#16837a', models: { hard: '', medium: '', easy: '' } },
    { id: 'deepseek', name: 'DeepSeek 组', type: 'openai-api', typeLabel: 'API', color: '#4d6bfe', models: { hard: 'deepseek-v4-pro', medium: 'deepseek-v4-flash', easy: 'deepseek-v4-flash' } },
    { id: 'qwen', name: 'Qwen 组', type: 'openai-api', typeLabel: 'API · 中转站', color: '#7a52e0', models: { hard: 'qwen3-coder', medium: 'qwen3-coder', easy: 'qwen3-coder' } },
  ]
  const PEOPLE = [
    ['architect', '架构师', 'claude', 'helmet', '设计整体方案、搭项目骨架、跨模块的大改动'],
    ['frontend', '前端工程师', 'claude', 'beret', '网页界面、交互、样式和前端组件'],
    ['reviewer', '代码审查员', 'claude', 'glasses', '审查代码，找 bug、安全问题和不合理的设计'],
    ['backend', '后端工程师', 'codex', 'headphones', '接口、数据处理、数据库和服务端逻辑'],
    ['tester', '测试工程师', 'codex', 'cap', '写测试、跑测试，找出功能里的漏洞'],
    ['debugger', '排错专家', 'codex', 'bandana', '定位和修复报错、崩溃、测试失败'],
    ['writer', '文档专员', 'deepseek', 'bun', '写 README、使用说明和注释'],
    ['qwen', 'Qwen通才', 'qwen', 'none', '什么都能干的通才'],
  ]

  const STEPS = {
    scaffold: [['tool', '看目录 .'], ['say', '先定目录结构和入口'], ['tool', '写 package.json'], ['tool', '写 vite.config.js'], ['tool', '写 src/main.js'], ['tool', '跑 npm install'], ['tool', '跑 npm run build']],
    ui: [['tool', '读 src/main.js'], ['tool', '写 src/ui/RecordForm.js'], ['tool', '写 src/ui/RecordList.js'], ['tool', '改 src/style.css'], ['tool', '跑 npm run build']],
    core: [['think', 'Planning store module'], ['tool', '写 src/store/records.js'], ['tool', '写 src/core/stats.js'], ['tool', '写 test/stats.test.js'], ['tool', '跑 npm test'], ['warn', '命令没跑通（退出码 1）'], ['tool', '改 src/core/stats.js'], ['tool', '跑 npm test']],
    docs: [['tool', '看目录 .'], ['tool', '读 package.json'], ['tool', '写 README.md']],
    review: [['tool', '跑 git diff --stat'], ['tool', '读 src/store/records.js'], ['tool', '读 src/ui/RecordList.js'], ['tool', '跑 npm test']],
    verify: [['tool', '跑 git status --short'], ['tool', '跑 npm test'], ['tool', '跑 npm run build'], ['tool', '读 src/ui/RecordList.js']],
    fix: [['tool', '搜 “deleteRecord”'], ['tool', '改 src/ui/RecordList.js'], ['tool', '跑 npm test']],
    generic: [['tool', '跑 git status --short'], ['tool', '搜 “TODO”'], ['tool', '读 src/index.js'], ['tool', '改 src/index.js'], ['tool', '跑 npm test']],
  }

  const SPEECH = {
    architect: '建议纯前端单页：Vite + 原生 JS，目录分 src/ui、src/core、src/store。数据先存 localStorage，封装成 store 模块，以后换成后端只改这一层。',
    frontend: '页面三块：记账表单、流水列表、分类统计图。图表用 Chart.js，手机优先布局，金额输入用数字键盘。',
    backend: '数据结构：records（id、type 收入/支出、amount、category、note、date），categories（id、name、icon）。金额用「分」存整数，避免小数误差。',
  }
  const MINUTES = `## 决定
- 技术栈：Vite + 原生 JS，Chart.js 画图
- 存储：localStorage，统一封装在 src/store，金额按分存整数

## 目录结构
\`\`\`
src/
  ui/      表单、列表、图表
  core/    统计和校验
  store/   records / categories
\`\`\`

## 数据设计
- records：id, type, amount, category, note, date
- categories：id, name, icon`

  window.ShaniuDemo = function (emit) {
    const roster = {
      groups: GROUPS.map((g) => ({ ...g, available: true, strengths: '' })),
      employees: PEOPLE.map(([id, name, group, look, description]) => ({ id, name, group, look, description, color: GROUPS.find((g) => g.id === group).color, available: true, stats: null })),
    }
    const agents = { shaniu: { status: 'idle', text: '', available: true } }
    for (const e of roster.employees) agents[e.id] = { status: 'idle', text: '', available: true }
    let tasks = []
    let round = 0
    let busy = false
    let epoch = 0
    let lastCommit = null
    const queue = []

    const now = () => Date.now()
    const name = (id) => roster.employees.find((e) => e.id === id)?.name || id
    const agent = (id, patch) => {
      Object.assign(agents[id], patch)
      emit({ type: 'agent', id, ...agents[id] })
    }
    const msg = (role, text, extra = {}) => emit({ type: 'message', message: { role, text, ts: now(), ...extra } })
    const put = (t) => emit({ type: 'task', task: { ...t, activity: t.activity.slice(-40) } })
    const mk = (t) => ({ status: 'pending', deps: [], activity: [], result: '', error: '', startedAt: null, endedAt: null, kind: 'code', difficulty: 'medium', iter: 1, attempts: [], who: name(t.agent), ...t })
    const model = (id, diff) => GROUPS.find((g) => g.id === roster.employees.find((e) => e.id === id).group).models[diff] || ''

    emit({ type: 'snapshot', state: { mode: 'demo', workdir: '~/projects/pocket-ledger', busy: false, round: 0, iteration: 0, roster, agents, tasks: [], messages: [], meeting: null, lastCommit: null } })
    msg('shaniu', '主人晚上好！牛马工作室开工啦～ Claude 组、Codex 组、DeepSeek 组、Qwen 组共 8 位牛马已就位。需求说得模糊也没关系，剩下的交给傻妞！')

    async function runTask(t, my) {
      Object.assign(t, { status: 'running', startedAt: now(), model: model(t.agent, t.difficulty) })
      put(t)
      agent(t.agent, { status: 'working', text: t.title, taskId: t.id })
      for (const [kind, text] of t.steps) {
        await wait(jitter(1000, 1900))
        if (my !== epoch) return
        const a = { kind, text, ts: now() }
        t.activity.push(a)
        emit({ type: 'activity', id: t.agent, taskId: t.id, ...a })
      }
      await wait(700)
      if (my !== epoch) return
      Object.assign(t, { status: 'done', endedAt: now(), result: t.report })
      if (t.kind === 'review' || t.kind === 'verify') t.verdict = t.pass === false ? 'changes' : 'approve'
      put(t)
      agent(t.agent, { status: 'done', text: t.verdict === 'changes' ? '还差一点' : t.kind === 'verify' ? '验收通过！' : '搞定！', taskId: null })
    }

    async function dispatch(t, my) {
      emit({ type: 'dispatch', to: t.agent, taskId: t.id })
      agent('shaniu', { status: 'walking', text: '' })
      await wait(1500)
      if (my === epoch) agent('shaniu', { status: 'idle', text: '' })
    }

    async function execute(my) {
      const running = new Map()
      const busyEmp = new Set()
      while (my === epoch) {
        const pending = tasks.filter((t) => t.status === 'pending')
        if (!pending.length && !running.size) break
        for (const t of pending) {
          if (busyEmp.has(t.agent) || !t.deps.every((d) => tasks.find((x) => x.id === d).status === 'done')) continue
          busyEmp.add(t.agent)
          await dispatch(t, my)
          if (my !== epoch) return
          running.set(
            t.id,
            runTask(t, my).finally(() => {
              running.delete(t.id)
              busyEmp.delete(t.agent)
            }),
          )
        }
        if (!running.size) break
        await Promise.race(running.values())
      }
    }

    async function verify(iteration, pass, problems, my) {
      const t = mk({ id: `v${iteration}`, title: `验收（第 ${iteration} 次）`, agent: 'reviewer', kind: 'verify', why: '对照主人的需求整体检查', iter: iteration, steps: STEPS.verify, pass, report: pass ? '逐条对照需求，测试和构建都通过。' : `发现问题：${problems.join('；')}` })
      tasks.push(t)
      put(t)
      await dispatch(t, my)
      if (my !== epoch) return
      await runTask(t, my)
    }

    async function meeting(my) {
      const attendees = ['architect', 'frontend', 'backend']
      const m = { topics: ['技术框架', '目录结构', '数据库和表设计'], attendees, speeches: [], minutes: '', file: '', status: 'open' }
      emit({ type: 'meeting', meeting: { ...m } })
      msg('system', `项目会议开始 · 议题：${m.topics.join('、')} · 参会：${attendees.map(name).join('、')}`)
      agent('shaniu', { status: 'meeting', text: '主持会议' })
      for (const id of attendees) agent(id, { status: 'meeting', text: '去会议室' })
      await wait(2600)
      for (const id of attendees) {
        if (my !== epoch) return
        agent(id, { status: 'meeting', text: '想方案…' })
        await wait(jitter(1400, 2200))
        if (my !== epoch) return
        m.speeches.push({ id, who: name(id), text: SPEECH[id] })
        msg('speech', SPEECH[id], { id, who: name(id) })
        agent(id, { status: 'meeting', text: SPEECH[id].slice(0, 22) + '…' })
      }
      agent('architect', { status: 'meeting', text: '整理会议纪要…' })
      await wait(2200)
      if (my !== epoch) return
      Object.assign(m, { minutes: MINUTES, file: 'docs/meetings/2026-09-29-pocket-ledger.md', status: 'closed' })
      emit({ type: 'meeting', meeting: { ...m } })
      for (const id of attendees) agent(id, { status: 'idle', text: '' })
      agent('shaniu', { status: 'idle', text: '' })
      msg('shaniu', `会开完啦！架构师拍板了方案，纪要存在 \`${m.file}\`：\n\n${MINUTES}`)
      await wait(1800)
    }

    function ledgerTasks() {
      return [
        mk({ id: 't1', title: '搭项目骨架', agent: 'architect', difficulty: 'hard', why: '牵扯整体结构，交给最强的 Opus', prompt: '按会议纪要搭好 Vite 项目骨架和目录。', steps: STEPS.scaffold, report: '骨架搭好：Vite + 原生 JS，src/ui、src/core、src/store 三层，npm run build 通过。' }),
        mk({ id: 't4', title: '写 README 和使用说明', agent: 'writer', difficulty: 'easy', why: '文档活简单，交给便宜的 DeepSeek', prompt: '写 README：怎么安装、运行、使用。', steps: STEPS.docs, report: '写好了 README.md：安装、运行、截图位置、数据存在哪里。' }),
        mk({ id: 't2', title: '记账表单和流水列表', agent: 'frontend', deps: ['t1'], why: '界面活，前端对口', prompt: '实现记账表单、流水列表和分类统计图。只改 src/ui。', steps: STEPS.ui, report: '表单、列表、统计图都做好了，手机上布局正常。' }),
        mk({ id: 't3', title: '数据存储和统计逻辑', agent: 'backend', deps: ['t1'], why: '数据和逻辑，后端对口', prompt: '实现 records/categories 存取和按月统计。只改 src/store、src/core。', steps: STEPS.core, report: '存储和统计完成，金额按分存整数，8 个测试全部通过。' }),
        mk({ id: 't5', title: '审查主体改动', agent: 'reviewer', kind: 'review', deps: ['t2', 't3'], why: '审查专员，没参与写代码', prompt: '审查 t2、t3 的改动。', steps: STEPS.review, report: '结构清楚，没有阻塞问题。\n\nVERDICT: APPROVE' }),
      ]
    }

    function genericTasks(text) {
      const topic = text.replace(/\s+/g, ' ').slice(0, 14)
      return [
        mk({ id: 't1', title: `实现：${topic}`, agent: 'frontend', why: '主要是界面和交互', prompt: `实现：${text}`, steps: STEPS.generic, report: `完成「${topic}」。` }),
        mk({ id: 't2', title: '补测试', agent: 'tester', difficulty: 'easy', why: '测试专员', prompt: '补测试并跑通。', steps: STEPS.core.slice(2), report: '新增 6 个用例，全部通过。' }),
        mk({ id: 't3', title: '审查改动', agent: 'reviewer', kind: 'review', deps: ['t1'], why: '审查专员', prompt: '审查 t1。', steps: STEPS.review, report: '没问题。\n\nVERDICT: APPROVE' }),
      ]
    }

    async function handleText(text, my) {
      msg('user', text)
      const t = text.trim()
      if (/^\/(团队|team)/.test(t)) {
        const lines = GROUPS.flatMap((g) => [`**${g.name}**（在岗）`, ...roster.employees.filter((e) => e.group === g.id).map((e) => `- \`${e.id}\` ${e.name}：${e.description}`)])
        return msg('shaniu', lines.join('\n'))
      }
      if (/^\/(撤销|undo)/.test(t)) {
        if (!lastCommit) return msg('shaniu', '没有可以撤销的存档哦。')
        msg('shaniu', `已撤回上一轮的改动（${lastCommit}），撤销本身也存了档：9f3e2d1。`)
        lastCommit = null
        return emit({ type: 'commit', commit: null })
      }
      const hire = t.match(/^\/(招人|hire)\s*(.*)$/)
      if (hire) {
        agent('shaniu', { status: 'thinking', text: '写招聘启事…' })
        await wait(1800)
        agent('shaniu', { status: 'idle', text: '' })
        const who = (hire[2] || '新同事').slice(0, 8)
        const id = `hire-${roster.employees.length}`
        roster.employees.push({ id, name: who, group: 'qwen', look: ['glasses', 'cap', 'beret', 'headphones'][roster.employees.length % 4], description: `${who}（演示招来的同事）`, color: '#7a52e0', available: true, stats: null })
        agents[id] = { status: 'idle', text: '', available: true }
        emit({ type: 'roster', roster, agents })
        return msg('shaniu', `新同事到岗啦！**${who}**，坐在 Qwen 组。岗位说明存在 \`~/.niuma/skills/${id}.md\`，主人随时可以改。`)
      }
      agent('shaniu', { status: 'thinking', text: '让傻妞想想怎么安排…' })
      await wait(2000)
      if (my !== epoch) return
      agent('shaniu', { status: 'idle', text: '' })
      if (/^(你好|hi|hello|在吗|谢谢)/i.test(t) || t.length < 5) return msg('shaniu', '傻妞在呢！说一个开发需求试试，说得模糊也没关系～')

      const ledger = /记账|账本/.test(t)
      const isNew = ledger || /网站|App|应用|系统|项目/i.test(t)
      msg('shaniu', isNew ? '这是个新项目！傻妞先拉架构师、前端和后端开个短会，把框架、目录和数据库定下来再开工～' : '收到！前端写实现，测试同时补用例，最后审查员把关。')
      round++
      emit({ type: 'round', round, iteration: 1 })
      if (isNew) await meeting(my)
      if (my !== epoch) return
      tasks = ledger ? ledgerTasks() : genericTasks(t)
      tasks.forEach(put)
      await execute(my)
      if (my !== epoch) return
      await verify(1, !ledger, ['删除记录后，统计图没有刷新'], my)
      if (my !== epoch) return
      if (ledger) {
        emit({ type: 'iteration', iteration: 2 })
        msg('shaniu', '验收发现还没完全做好：删除记录后，统计图没有刷新。傻妞安排第 2 轮继续！')
        const fix = mk({ id: 'i2-f1', title: '删除后刷新统计', agent: 'debugger', difficulty: 'easy', iter: 2, why: '小 bug，排错专家顺手修', prompt: '删除记录后刷新统计图。', steps: STEPS.fix, report: '删除后触发 stats 重新计算，已加测试。' })
        tasks.push(fix)
        put(fix)
        await execute(my)
        if (my !== epoch) return
        await verify(2, true, [], my)
        if (my !== epoch) return
      }
      lastCommit = ledger ? 'a1b2c3d' : 'c4d5e6f'
      emit({ type: 'commit', commit: lastCommit })
      agent('shaniu', { status: 'thinking', text: '整理汇报…' })
      await wait(1500)
      if (my !== epoch) return
      agent('shaniu', { status: 'idle', text: '' })
      msg(
        'shaniu',
        ledger
          ? `**搞定啦主人！记账小网站能用了～**\n\n- 开会定了方案：Vite + 原生 JS，数据存在浏览器里\n- 架构师搭骨架，前端和后端同时开工，DeepSeek 写好了 README\n- 第 1 次验收发现删除后统计没刷新，排错专家补上后第 2 次验收通过\n- 运行：\`npm install && npm run dev\`\n\n已自动存档：\`${lastCommit}\`，不满意就说「/撤销」。`
          : `**这一轮搞定啦！**\n\n- 前端完成了实现，测试补了 6 个用例\n- 审查和验收都通过\n\n已自动存档：\`${lastCommit}\`，不满意就说「/撤销」。（演示模式）`,
      )
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

    function stop() {
      if (!busy) return msg('shaniu', '现在没有在跑的活哦，主人。')
      epoch++
      queue.length = 0
      for (const t of tasks) {
        if (t.status === 'pending' || t.status === 'running') {
          Object.assign(t, { status: 'cancelled', error: '被叫停', endedAt: now() })
          put(t)
        }
      }
      emit({ type: 'meeting', meeting: null })
      for (const id of Object.keys(agents)) agent(id, { status: 'idle', text: '', taskId: null })
      msg('shaniu', '收到，全部停下！')
      busy = false
      emit({ type: 'busy', busy: false })
    }

    const post = (text) => {
      if (/^\/(stop|停)/.test(text.trim())) return stop()
      queue.push(text)
      if (busy) msg('system', `已记下，等手上这轮忙完就处理：${text.slice(0, 40)}`)
      drain()
    }

    // Recording scripts set window.NIUMA_NO_AUTOPLAY to type the first request themselves.
    if (!window.NIUMA_NO_AUTOPLAY) {
      setTimeout(() => {
        if (!busy && round === 0) post('帮我做一个记账小网站')
      }, 900)
    }

    return { send: async (text) => post(text), stop: async () => stop() }
  }
})()
