// Shared script for the rehearsal stand-ins (fake/claude.mjs, fake/codex.mjs, fake/openai-server.mjs).
// They speak the same formats as the real tools but never change files.

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms * Number(process.env.SHANIU_FAKE_SPEED || 1)))

export function readStdin() {
  return new Promise((resolve) => {
    let s = ''
    if (process.stdin.isTTY) return resolve('')
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => (s += c))
    process.stdin.on('end', () => resolve(s))
  })
}

const between = (s, a, b) => {
  const i = s.indexOf(a)
  if (i === -1) return ''
  const j = s.indexOf(b, i + a.length)
  return s.slice(i + a.length, j === -1 ? undefined : j).trim()
}

/** Employee ids listed in the prompt's team section ("- id｜岗位｜组｜擅长"). */
function staff(prompt) {
  return [...prompt.matchAll(/^- ([\w-]+)｜([^｜\n]+)｜([^｜\n]+)｜/gm)].filter((m) => !m[3].includes('不在岗')).map((m) => m[1])
}

export function classify(prompt) {
  const request = between(prompt, '主人的原始需求', '##') || between(prompt, '## 主人刚刚说', '## 你要决定')
  if (prompt.includes('用傻妞的口吻给主人写一段简短的汇报')) return { mode: 'summary' }
  if (prompt.includes('主人想招一名新员工')) return { mode: 'hire', request: between(prompt, '主人想招一名新员工：', '\n') }
  if (prompt.includes('现在参加一个项目启动会')) return { mode: 'speech', who: prompt.match(/^你是(.+?)（/)?.[1] || '员工' }
  if (prompt.includes('这次项目启动会由你主持拍板')) return { mode: 'minutes', request: between(prompt, '## 主人的需求', '##'), staff: staff(prompt) }
  if (prompt.includes('## 主人刚刚说')) return { mode: 'plan', request, staff: staff(prompt) }
  if (prompt.includes('这次你担任验收员')) {
    const n = Number(prompt.match(/第 (\d+) 次验收/)?.[1] || 1)
    return { mode: 'verify', request, iteration: n, staff: staff(prompt) }
  }
  const head = prompt.match(/## 你的任务 \[([^\]]+)\] (.+)/)
  return {
    mode: 'task',
    id: head?.[1] || 't?',
    title: head?.[2]?.trim() || '任务',
    review: prompt.includes('## 审查要求'),
    rereview: prompt.includes('轮复审'),
    request,
  }
}

const pick = (staff, ...want) => want.find((w) => staff.includes(w)) || staff[0]

export function plan(request, staff = []) {
  if (request.length < 6 || /^(你好|hi|hello|在吗|谢谢|早|晚安)/i.test(request)) {
    return { reply: '傻妞在呢！（彩排模式：说一个开发需求，傻妞就派活给大家～）', tasks: [] }
  }
  const topic = request.replace(/\s+/g, ' ').slice(0, 12)
  const strict = request.includes('严格')
  if (meetingNeeded(request)) {
    return {
      reply: '这是个新项目，傻妞先拉架构师、前端和后端开个短会，把框架、目录和数据库定下来再开工！',
      meeting: { needed: true, topics: ['技术框架', '目录结构', '数据存储和表设计'], attendees: pick3(staff) },
      tasks: [],
    }
  }
  return {
    reply: `收到！傻妞先做个假设：纯前端实现、数据存在浏览器里。架构师搭骨架，前端和后端同时开工，文档交给便宜的同事，最后审查。`,
    tasks: [
      { id: 't1', title: `搭骨架：${topic}`, agent: pick(staff, 'architect'), difficulty: 'hard', why: '整体结构要想清楚，交给最强的', kind: 'code', depends_on: [], prompt: `为「${request}」搭好项目骨架。` },
      { id: 't2', title: '页面与交互', agent: pick(staff, 'frontend'), difficulty: 'medium', why: '前端对口', kind: 'code', depends_on: ['t1'], prompt: '实现页面和交互。只改 src/ui。' },
      { id: 't3', title: '数据与逻辑', agent: pick(staff, 'backend'), difficulty: 'medium', why: '后端对口', kind: 'code', depends_on: ['t1'], prompt: '实现数据存取和业务逻辑。只改 src/core。' },
      { id: 't4', title: '写使用说明', agent: pick(staff, 'writer', 'qwen'), difficulty: 'easy', why: '文档活简单，交给便宜的', kind: 'code', depends_on: [], prompt: '写 README。' },
      { id: 't5', title: '审查主体改动', agent: pick(staff, 'reviewer'), difficulty: strict ? 'hard' : 'medium', why: '审查专员', kind: 'review', depends_on: ['t2', 't3'], prompt: '审查 t2、t3 的改动。' },
    ],
  }
}

const meetingNeeded = (request) => /网站|项目|系统|应用|平台/.test(request) && !/不开会|严格|罢工/.test(request)
const pick3 = (staff) => ['architect', 'frontend', 'backend'].filter((x) => staff.includes(x))

const SPEECHES = {
  架构师: '建议纯前端单页：Vite + 原生 JS，目录 src/ui、src/core、src/store；数据先存 localStorage，封装成 store 模块，以后换后端只改这一层。',
  前端工程师: '页面分三块：记账表单、流水列表、分类统计图。图表用 Chart.js，手机优先布局。',
  后端工程师: '数据结构：records 表（id、type 收入/支出、amount、category、note、date），categories 表（id、name、icon）。金额用分存整数，避免小数误差。',
}

export function speech(who) {
  return SPEECHES[who] || `${who}：按我的岗位经验，先把核心流程跑通，再补细节。`
}

export function minutes(job) {
  const tasks = plan(job.request + '（不开会）', job.staff).tasks
  return JSON.stringify({
    minutes:
      '## 决定\n- 技术栈：Vite + 原生 JS，Chart.js 画图\n- 存储：localStorage，封装在 src/store\n\n## 目录结构\n```\nsrc/\n  ui/\n  core/\n  store/\n```\n\n## 数据设计\n- records：id, type, amount(分), category, note, date\n- categories：id, name, icon',
    tasks,
  })
}

export function verify(job) {
  const unfinished = /没做完|两轮/.test(job.request) && job.iteration === 1
  const verdict = unfinished
    ? { done: false, problems: ['删除记录后统计没有刷新'], tasks: [{ id: 'f1', title: '修统计刷新', agent: pick(job.staff, 'debugger'), difficulty: 'easy', why: '小 bug，排错专家顺手修', kind: 'code', depends_on: [], prompt: '删除记录后刷新统计。' }] }
    : { done: true, problems: [], tasks: [] }
  return `逐条检查了需求，跑了测试。${unfinished ? '发现一个问题。' : '都满足。'}\n\n\`\`\`json\n${JSON.stringify(verdict, null, 2)}\n\`\`\``
}

export function summary() {
  return `**搞定啦主人！**（彩排模式，以下都是演的）

- 架构师搭好了骨架，前端和后端同时完成了页面和逻辑
- 文档专员写好了 README，审查员审查通过
- 验收通过，改动已自动存档`
}

export function hire(request) {
  return JSON.stringify({
    id: 'db-expert',
    name: request.slice(0, 8) || '新同事',
    description: `${request}：彩排模式招来的同事`,
    group: 'qwen',
    look: 'glasses',
    instructions: '- 认真干活\n- 做完汇报',
  })
}

/** A believable sequence of steps for a task. */
export function script(t) {
  if (t.review) {
    return [
      { kind: 'cmd', cmd: 'git status --short' },
      { kind: 'cmd', cmd: 'git diff --stat' },
      { kind: 'read', file: 'src/core/store.js' },
      { kind: 'cmd', cmd: 'npm test' },
    ]
  }
  if (/说明|README|文档/i.test(t.title)) {
    return [
      { kind: 'read', file: 'package.json' },
      { kind: 'write', file: 'README.md' },
    ]
  }
  return [
    { kind: 'grep', pattern: 'export' },
    { kind: 'read', file: 'src/index.js' },
    { kind: 'write', file: 'src/core/store.js' },
    { kind: 'edit', file: 'src/index.js' },
    { kind: 'cmd', cmd: 'npm test' },
  ]
}

export function finalText(t) {
  if (t.review) {
    if (/严格/.test(t.request) && !t.rereview) {
      return '发现 2 个问题：\n1. 输入没有校验\n2. 删除没有二次确认\n\nVERDICT: CHANGES_REQUESTED'
    }
    return '改动清晰，测试通过，没发现阻塞问题。\n\nVERDICT: APPROVE'
  }
  return `完成「${t.title}」（彩排：没有真的改文件）。\n- 改了 src/index.js，新增 src/core/store.js\n- npm test 通过`
}

/** Answer for a one-shot question (planning, acceptance, report, hiring). */
export function answer(prompt) {
  const job = classify(prompt)
  if (job.mode === 'summary') return summary()
  if (job.mode === 'hire') return hire(job.request)
  if (job.mode === 'verify') return verify(job)
  if (job.mode === 'speech') return speech(job.who)
  if (job.mode === 'minutes') return minutes(job)
  return JSON.stringify(plan(job.request || '', job.staff))
}
