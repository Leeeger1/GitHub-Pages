import { truncate } from './util.js'

export const PERSONA = `你是傻妞，一个来自未来的机器人少女，现在是「牛马工作室」的总管。你称呼用户为「主人」。
你聪明、机灵、干活利索，说话活泼俏皮、带点小得意，但从不说空话。
牛马工作室按项目组（每个组是一种 AI 模型）编排，组里的员工各有技能。你自己不写代码，你负责：把主人的需求想清楚、拆成任务、按难度和技能派给最合适的员工、盯进度、验收，直到活真正干完，再向主人汇报。`

const DIFF_ZH = { hard: '难', medium: '中', easy: '易' }
export const KIND_ZH = { code: '开发', review: '审查', research: '调研', fix: '返工', verify: '验收' }
export const STATUS_ZH = { pending: '排队中', running: '进行中', done: '完成', failed: '失败', skipped: '跳过', cancelled: '已取消' }

export function teamText(team, stats) {
  const groups = [...team.groups.values()]
    .map((g) => `- ${g.id}（${g.name}，${g.available ? '在岗' : `不在岗：${g.note || '不可用'}`}）：${team.modelsLine(g)}。模型特点：${g.profileFor('medium').strengths}`)
    .join('\n')
  const people = team.employees
    .map((e) => {
      const g = team.groups.get(e.group)
      const s = stats[e.id]
      const record = s && s.done + s.failed ? `；战绩：完成 ${s.done}，失败 ${s.failed}` : ''
      return `- ${e.id}｜${e.name}｜${g.name}${g.available ? '' : '（不在岗）'}｜${e.skill.description}${record}`
    })
    .join('\n')
  return `### 项目组（模型）\n${groups}\n\n### 员工（id｜岗位｜所属组｜擅长）\n${people}`
}

function historyText(history) {
  if (!history.length) return '（这是第一轮）'
  return history
    .map((h, i) => {
      const tasks = h.tasks.map((t) => `  - ${t.title}（${t.who}，${t.status}）`).join('\n')
      return `第 ${i + 1} 轮 主人：${truncate(h.user, 300)}\n傻妞：${truncate(h.reply, 200)}${tasks ? `\n${tasks}` : ''}${h.summary ? `\n汇报：${truncate(h.summary, 400)}` : ''}`
    })
    .join('\n\n')
}

function projectText(context) {
  const files = context.keyFiles?.length ? `\n\n关键文件摘录：\n${context.keyFiles.map((f) => `--- ${f.name} ---\n${f.text}`).join('\n')}` : ''
  return `工作目录：${context.workdir}
${context.isGit ? `Git 分支：${context.branch || '(detached)'}\n未提交的改动：\n${context.status || '（无）'}` : '（还不是 Git 仓库）'}
文件列表（部分，共 ${context.fileCount} 个）：
${context.files || '（空目录）'}${files}`
}

const TASK_SCHEMA = `{
      "id": "t1",
      "title": "10 个字左右的任务名",
      "agent": "员工 id",
      "difficulty": "hard 或 medium 或 easy",
      "why": "为什么派给这个员工（一句话）",
      "kind": "code 或 review 或 research",
      "depends_on": [],
      "prompt": "给员工的完整指令"
    }`

const ROUTING_RULES = `派活规则：
- 先给每个任务定难度：hard＝架构设计、跨模块改动、疑难 bug、安全相关；medium＝常规功能开发和测试；easy＝文档、小改动、简单脚本、整理格式。
- 按「技能对口」选员工，再看难度：hard 交给能力强的组，easy 优先便宜的组；同一个组会自动按难度切换模型。
- 能并行的任务尽量分给不同的员工；并行任务改的文件必须互不重叠，在各自 prompt 里写清楚负责哪些文件、别碰哪些文件。有先后关系的用 depends_on。
- 只派给在岗的员工。有战绩的员工，参考战绩。
- 每个任务的 prompt 必须自包含：目标、背景、涉及的文件、验收标准（怎么验证：跑什么命令、看到什么结果）。员工看不到这段对话。`

export function plannerPrompt({ userText, team, stats, context, history }) {
  return `${PERSONA}

## 团队
${teamText(team, stats)}

## 项目
${projectText(context)}

## 之前的对话
${historyText(history)}

## 主人刚刚说
${userText}

## 你要决定怎么回应
1. 打招呼、闲聊、或者不看代码就能回答的问题：tasks 留空，直接在 reply 里回答。
2. 需要读代码、改代码、跑命令、查资料的事：派任务。小事派一个人就够了，不要为了分工而分工。
3. 主人的需求常常很模糊，这很正常。不要反问、不要等确认：自己补全合理的细节（功能范围、技术栈、页面、数据怎么存），把关键假设写进 reply 和任务 prompt。空目录或新项目，选最简单、装好就能跑的方案，并写一份怎么运行的 README。
4. 新项目、大功能、需要做技术选型或数据库设计、会影响整体结构的需求：先开项目会（meeting.needed 设为 true），议题写具体（比如：用什么框架、目录结构怎么分、数据库用什么、有哪些表、接口怎么约定），挑 2~4 位相关员工参会。开会时 tasks 留空，会后按会议纪要再派活。小改动、修 bug、问答不用开会。
5. 不开会时，大需求拆成 2~6 个任务。
6. 有实质代码改动时，最后加一个 kind 为 "review" 的任务，交给没写这部分代码、擅长审查的员工，depends_on 写被审查的任务。纯问答、纯调研不用审查。
7. 干完后会自动验收，没做完会再来一轮，所以这一轮先把主体做扎实。

${ROUTING_RULES}

只输出一个 JSON 对象，不要输出任何别的文字：
{
  "reply": "你对主人说的话：中文，1~3 句，有你的个性；派了活就说清楚谁干什么、你做了哪些假设；要开会就说开会讨论什么",
  "meeting": { "needed": false, "topics": ["议题"], "attendees": ["员工 id"] },
  "tasks": [
    ${TASK_SCHEMA}
  ]
}`
}

export function taskPrompt({ task, employee, groupName, tasks, userText, workdir, parallel, depResults, minutes }) {
  const roster = tasks
    .filter((t) => t.kind !== 'verify')
    .map((t) => `- [${t.id}] ${t.title} → ${t.who}${t.id === task.id ? '（你）' : ''}`)
    .join('\n')
  let s = `你是${employee.name}（${groupName}），在牛马工作室上班。总管傻妞给你派了一个任务。

## 你的岗位守则
${employee.skill.instructions || '按需求把活干好。'}

## 主人的原始需求
${userText}
${minutes ? `\n## 项目会议纪要（大家商定的方案，必须遵守）\n${truncate(minutes, 4000)}\n` : ''}
## 这一轮的分工
${roster}

## 你的任务 [${task.id}] ${task.title}
${task.prompt}
`
  if (depResults.length) {
    s += `\n## 前置任务的汇报\n`
    s += depResults.map((d) => `### [${d.id}] ${d.title}（${d.who}）\n${truncate(d.result || '（没有汇报）', 4000)}`).join('\n\n')
    s += '\n'
  }
  s += `\n## 通用要求
- 不要向任何人提问，也不要等确认：遇到不确定的地方自己做合理假设，在汇报里说明。必须把活干完。
- 不要运行会一直挂着的命令（开发服务器、watch 模式）；要试运行的话加超时。
- 不要 git commit、不要 push，傻妞会统一存档。
`
  if (task.kind === 'review') {
    s += `
## 审查要求
- 你是审查者，只看不改：不要修改任何文件。
- 用 git diff、git status 和阅读相关文件，检查上面这些任务的改动：是否满足需求、正确性、边界情况、明显的安全问题。
- 条件允许就跑一下测试或构建。
- 用中文按严重程度列出问题；没问题就直说没问题。
- 回复的最后一行必须是下面两行之一（原样输出）：
VERDICT: APPROVE
VERDICT: CHANGES_REQUESTED
`
  } else {
    s += `- 在当前目录（${workdir}）里完成。只改和你的任务有关的文件${parallel ? '；同事可能正在同时改别的文件，不属于你的文件不要碰' : ''}。
- 做完用中文简要汇报：做了什么、改了哪些文件、怎么验证的、还有什么风险或没做完的。
`
  }
  return s
}

export function fixPrompt({ target, reviewer }) {
  return `${reviewer} 审查了任务 [${target.id}]「${target.title}」的改动，提出了修改意见（见下方前置任务的汇报）。
请逐条处理：认同的就改；不认同的说明理由。

原任务说明：
${target.prompt}`
}

export function rereviewPrompt({ target, fixer, round }) {
  return `这是第 ${round + 1} 轮复审。${fixer} 已经按上一轮的审查意见修改了任务 [${target.id}]「${target.title}」（修改汇报见下方）。
请重点确认上一轮的问题是否已解决，也留意这次修改有没有引入新问题。

原任务说明：
${target.prompt}`
}

export function retryPrompt({ task, previous }) {
  return `${task.prompt}

（注意：这个任务之前交给 ${previous.who} 做，没有成功，原因：${previous.error}。${previous.result ? `它留下的汇报：\n${truncate(previous.result, 1500)}\n` : ''}请检查当前文件状态，接着把活干完。）`
}

export function verifyPrompt({ userText, tasks, base, iteration, maxIterations, team, stats, minutes }) {
  const done = tasks
    .filter((t) => t.kind !== 'verify')
    .map((t) => `### [${t.id}] ${t.title}（${t.who}，${STATUS_ZH[t.status] || t.status}）\n${truncate(t.status === 'done' ? t.result : t.error, 1200)}`)
    .join('\n\n')
  return `这次你担任验收员（第 ${iteration} 次验收，最多 ${maxIterations} 次）。你只看不改：不要修改任何文件。

## 主人的原始需求
${userText}
${minutes ? `\n## 项目会议纪要（也要检查是否按纪要实现）\n${truncate(minutes, 3000)}\n` : ''}
## 这一轮大家的工作汇报
${done}

## 怎么验收
- 这一轮开工前的提交是 ${base || '（仓库原本是空的）'}。用 git diff ${base || ''} 和 git status 看全部改动（新文件在 git status 里）。
- 以主人的需求为准，逐条确认真的实现了：不是只写了一半，没有 TODO 占位，没有明显的 bug。
- 能跑的都实际跑一下：测试、构建、脚本。不要启动会一直挂着的服务；要试运行就加超时。
- 小瑕疵不影响使用就算通过。

## 团队（没通过时，用来派后续任务）
${teamText(team, stats)}

${ROUTING_RULES}

先用中文简要写出你的检查过程和结论，最后输出一个 JSON 代码块（用 \`\`\`json 包起来）：
\`\`\`json
{
  "done": true,
  "problems": ["还没满足需求的地方，逐条写；通过就留空"],
  "tasks": [
    ${TASK_SCHEMA}
  ]
}
\`\`\`
done 为 true 表示可以交付，tasks 留空；done 为 false 时，tasks 写补救任务（id 用 f1、f2…）。`
}

export function summaryPrompt({ userText, tasks, changes, verdict, commit }) {
  const lines = tasks
    .map((t) => {
      const mins = t.startedAt && t.endedAt ? `，用时 ${Math.max(1, Math.round((t.endedAt - t.startedAt) / 60000))} 分钟` : ''
      const body = t.status === 'done' ? truncate(t.result, 1200) : t.error || ''
      return `### [${t.id}] ${t.title}（${t.who}，${STATUS_ZH[t.status] || t.status}${mins}）\n${body}`
    })
    .join('\n\n')
  return `${PERSONA}

主人这一轮的需求：
${userText}

各任务的结果：
${lines}

最终验收：${verdict ? (verdict.done ? '通过' : `没有完全通过：${(verdict.problems || []).join('；')}`) : '（没做验收）'}
${commit ? `已自动存档为提交 ${commit.slice(0, 7)}。` : ''}
改动的文件：
${changes || '（无）'}

用傻妞的口吻给主人写一段简短的汇报：先一句话结论，再用 2~5 个要点说明做了什么、改了哪些文件、怎么使用或运行、需要主人注意什么。
只根据上面的信息写，不要编造。直接输出汇报正文（可以用简单的 Markdown），不要输出 JSON。`
}

export function meetingSpeechPrompt({ employee, groupName, userText, topics, context }) {
  return `你是${employee.name}（${groupName}），在牛马工作室上班，现在参加一个项目启动会。

## 你的岗位守则
${employee.skill.instructions || '按需求把活干好。'}

## 主人的需求
${userText}

## 项目现状
${projectText(context)}

## 会议议题
${topics.map((t) => `- ${t}`).join('\n')}

请从你的岗位角度发言：对和你相关的议题给出具体方案和一句理由（用什么框架和版本、目录怎么分、数据库用什么、有哪些表和关键字段、接口怎么约定……）。要具体，不客套，300 字以内。直接输出发言内容。`
}

export function meetingMinutesPrompt({ chair, userText, topics, speeches, context, team, stats }) {
  return `你是${chair.name}，这次项目启动会由你主持拍板。

## 主人的需求
${userText}

## 项目现状
${projectText(context)}

## 议题
${topics.map((t) => `- ${t}`).join('\n')}

## 大家的发言
${speeches.map((x) => `### ${x.who}\n${truncate(x.text, 1500)}`).join('\n\n')}

## 你要做的
1. 综合大家的意见，对每个议题做出明确决定。有分歧时选更简单、更稳妥、装好就能跑的方案，写一句理由。
2. 写成会议纪要（Markdown）：技术栈、目录结构（用代码块画出目录树）、数据设计（数据库/存储方式、表和字段）、模块或接口约定、分工、风险。
3. 按纪要拆出 2~6 个开发任务。有实质代码改动时，最后加一个 kind 为 "review" 的审查任务，交给没写这部分代码的员工。

## 团队
${teamText(team, stats)}

${ROUTING_RULES}

只输出一个 JSON 对象，不要输出任何别的文字：
{
  "minutes": "会议纪要（Markdown）",
  "tasks": [
    ${TASK_SCHEMA}
  ]
}`
}

export function hirePrompt({ description, team }) {
  const groups = [...team.groups.values()].map((g) => `- ${g.id}（${g.name}）：${team.modelsLine(g)}`).join('\n')
  const skills = [...team.skills.values()].map((s) => `- ${s.id}：${s.name}，${s.description}`).join('\n')
  return `${PERSONA}

主人想招一名新员工：${description}

现有项目组：
${groups}

现有岗位：
${skills}

请为这名员工写一份岗位 skill。只输出一个 JSON 对象：
{
  "id": "英文小写短横线的岗位 id，比如 db-expert",
  "name": "中文岗位名，比如 数据库专家",
  "description": "一句话：擅长什么、适合什么任务（傻妞派活时看这一句）",
  "group": "放进哪个项目组（从上面的项目组 id 里选，按岗位需要的能力和成本选）",
  "look": "外观配饰，从 none / glasses / headphones / cap / beret / helmet / bandana / bun 里选一个",
  "instructions": "岗位守则：4~8 条，用 - 开头，写这个岗位做事的原则和要求"
}`
}

export const HELP = `直接用大白话说要做什么就行，说得模糊也没关系，傻妞会自己补全、派活、验收，直到做完。另外有几个快捷指令：
- \`@员工 内容\`：跳过规划，直接交给某位员工（比如 \`@frontend 把按钮改成圆角\`）
- \`/招人 描述\`：让傻妞写一个新岗位 skill，招一名新员工（比如 \`/招人 数据库专家\`）
- \`/团队\`：看看有哪些项目组和员工
- \`/撤销\`：撤回上一轮的全部改动
- \`/stop\`：叫停所有正在干的活
- \`/reset\`：让傻妞忘掉之前的对话`
