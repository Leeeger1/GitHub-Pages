// Shared script for the rehearsal CLIs (fake/claude.mjs, fake/codex.mjs).
// They speak the same stdout formats as the real tools but never touch files.

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms * Number(process.env.MAVIS_FAKE_SPEED || 1)))

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

export function classify(prompt) {
  if (prompt.includes('请用 Mavis 的口吻给老板写一段简短的汇报')) return { mode: 'summary' }
  if (prompt.includes('## 老板刚刚说')) return { mode: 'plan', request: between(prompt, '## 老板刚刚说', '## 你要决定') }
  const head = prompt.match(/## 你的任务 \[([^\]]+)\] (.+)/)
  return {
    mode: 'task',
    id: head?.[1] || 't?',
    title: head?.[2]?.trim() || '任务',
    review: prompt.includes('## 审查要求'),
    rereview: prompt.includes('轮复审'),
    strict: between(prompt, '老板的原始需求：', '这一轮的分工').includes('严格'),
  }
}

export function plan(request) {
  if (request.length < 8 || /^(你好|hi|hello|在吗|谢谢|早|晚安)/i.test(request)) {
    return { reply: '随时待命，老板。（彩排模式：说一个具体的开发需求，我就派活给他们俩。）', tasks: [] }
  }
  const topic = request.replace(/\s+/g, ' ').slice(0, 14)
  return {
    reply: `收到。Claude 负责主体实现，Codex 同时写测试，最后让 Codex 审一遍 Claude 的改动。`,
    tasks: [
      { id: 't1', title: `实现：${topic}`, agent: 'claude', kind: 'code', depends_on: [], prompt: `实现老板的需求：${request}。只改 src/ 下的文件。` },
      { id: 't2', title: '补测试并跑通', agent: 'codex', kind: 'code', depends_on: [], prompt: `为「${request}」编写测试，只改 test/ 下的文件，并运行测试。` },
      { id: 't3', title: '审查主体改动', agent: 'codex', kind: 'review', depends_on: ['t1'], prompt: '审查 t1 的改动。' },
    ],
  }
}

export function summary() {
  return `**搞定了，老板。**（彩排模式，以下都是演的）

- Claude 改了 \`src/theme.css\` 和 \`src/components/Header.jsx\`，加了切换按钮
- Codex 写了 \`test/theme.test.js\`，12 个用例全绿
- Codex 审查通过，没发现阻塞问题

改动都还没提交，您过目后再 commit。`
}

/** A believable sequence of steps for a task, as [{tool, input|command|file}] items. */
export function script(t) {
  if (t.review) {
    return [
      { kind: 'cmd', cmd: 'git status --short' },
      { kind: 'cmd', cmd: 'git diff --stat' },
      { kind: 'read', file: 'src/components/Header.jsx' },
      { kind: 'read', file: 'src/theme.css' },
      { kind: 'cmd', cmd: 'npm test' },
    ]
  }
  if (/测试|test/i.test(t.title)) {
    return [
      { kind: 'cmd', cmd: 'ls test' },
      { kind: 'read', file: 'package.json' },
      { kind: 'write', file: 'test/theme.test.js' },
      { kind: 'cmd', cmd: 'npm test' },
      { kind: 'edit', file: 'test/theme.test.js' },
      { kind: 'cmd', cmd: 'npm test' },
    ]
  }
  return [
    { kind: 'grep', pattern: 'theme' },
    { kind: 'read', file: 'src/components/Header.jsx' },
    { kind: 'read', file: 'src/theme.css' },
    { kind: 'edit', file: 'src/theme.css' },
    { kind: 'write', file: 'src/components/ThemeToggle.jsx' },
    { kind: 'edit', file: 'src/components/Header.jsx' },
    { kind: 'cmd', cmd: 'npm run build' },
  ]
}

export function finalText(t) {
  if (t.review) {
    if (t.strict && !t.rereview) {
      return '发现 2 个问题：\n1. 切换按钮缺少 aria-label\n2. 主题没有持久化，刷新后会丢\n\nVERDICT: CHANGES_REQUESTED'
    }
    return '改动清晰，测试通过，没发现阻塞问题。\n\nVERDICT: APPROVE'
  }
  return `完成「${t.title}」（彩排：没有真的改文件）。\n- 改了 src/theme.css、src/components/Header.jsx\n- 新增 src/components/ThemeToggle.jsx\n- npm run build 通过`
}
