# Mavis 像素工作室

你只跟 **Mavis（马维斯）** 说话。她是一位 J.A.R.V.I.S. 风格的 AI 总管：听懂你要什么，把活拆成任务，分给 **Claude Code** 和 **Codex**，盯进度、安排交叉审查，最后向你汇报。

整个过程在一间像素办公室里直播：三个小人坐在电脑前，谁在读哪个文件、跑什么命令，头顶的气泡里都看得到；派活的时候，Mavis 会起身把任务单送到工位上。

![Mavis 像素工作室](docs/screenshot.png)

## 它会做什么

1. **听**：你用大白话说需求，比如「给首页加个暗色模式，顺便把测试补上」。
2. **拆**：Mavis 看一眼项目结构，把需求拆成 1～5 个任务，写清楚每个任务的目标、负责的文件和验收标准。
3. **派**：按两位工程师的特长分配。互不依赖的任务让两人**同时开工**；有先后关系的排好顺序，前一个人的汇报会自动转交给下一个人。
4. **审**：有实质代码改动时，让**没写这段代码的另一位**来审查。审查要求返工，就自动退回原作者修改，再复审一次（次数可配置）。
5. **报**：全部完成后，Mavis 用几句话告诉你做了什么、改了哪些文件、有什么需要你决定的。

闲聊或者不用看代码就能回答的问题，Mavis 会直接回答，不派活。

## 准备

- Node.js 18 或更高版本
- 至少装好并登录其中一个（两个都有最好）：
  - Claude Code：`npm i -g @anthropic-ai/claude-code`，然后运行一次 `claude` 登录
  - Codex：`npm i -g @openai/codex`，然后运行一次 `codex` 登录

不需要 `npm install`，Mavis 没有任何第三方依赖。

## 快速开始

```bash
git clone https://github.com/Leeeger1/GitHub-Pages.git mavis
cd mavis

# 先彩排：用假的 Claude / Codex 演一遍，不花钱、不改文件
node bin/mavis.js --fake

# 真干活：把你的项目目录传进去
node bin/mavis.js ~/code/my-project
# Windows：node bin\mavis.js D:\code\my-project
```

浏览器会自动打开 `http://localhost:7777`。想在任何目录直接敲 `mavis`，在仓库目录里运行一次 `npm link`。

## 在网页里怎么用

- **直接说**：在右边输入框说需求，Enter 发送，Shift+Enter 换行（中文输入法选词时按 Enter 不会误发）。
- **点名**：`@claude 内容` 或 `@codex 内容`，跳过 Mavis 的规划，直接交给某一位。
- **叫停**：`/stop` 或点「全部停下」，正在跑的 Claude / Codex 进程会被结束。
- **重来**：`/reset` 让 Mavis 忘掉之前的对话。
- **任务板**：每个任务可以展开，看 Mavis 的原始交代、实时过程和最终汇报。
- 忙的时候发的新消息会排队，这一轮结束后自动处理。

办公室会跟着系统的深色 / 浅色模式切换成夜晚或白天；墙上的钟是真实时间，白板上的便利贴就是当前的任务。

## 安全和权限

Mavis 让工程师**直接在你的项目目录里改文件**，所以强烈建议在 Git 仓库里用，改坏了随时 `git checkout`。默认设置是偏保守的：

| | 默认 | 含义 |
|---|---|---|
| Claude | `permissionMode: acceptEdits` | 可以随意改文件；命令只允许 `allowedTools` 白名单里的（git 只读命令、npm、node、python、pytest、go、cargo、make 等），其他命令会被拒绝 |
| Codex | `sandbox: workspace-write` | 只能写项目目录，命令在沙箱里跑 |
| 审查任务 | 只读 | Claude 禁用编辑工具，Codex 用 `read-only` 沙箱 |
| Git | 不提交 | 提示词要求工程师不要 commit / push，改动留给你过目 |
| 网页 | 只监听 `127.0.0.1` | 拒绝其他域名和跨站请求 |

想让 Claude 能跑任何命令，把 `permissionMode` 改成 `bypassPermissions`（只在你信任的项目里这么做）。

想用手机看直播：`node bin/mavis.js --host 0.0.0.0`，终端会打印一个带访问口令的局域网地址，没有口令的请求会被拒绝。

## 配置

配置按这个顺序叠加，后面的覆盖前面的：内置默认值 → `~/.mavis/config.json` → `项目目录/mavis.config.json` → `--config 指定的文件` → 命令行参数。可以从 [`mavis.config.example.json`](mavis.config.example.json) 复制一份改。

| 字段 | 默认 | 说明 |
|---|---|---|
| `port` / `host` | `7777` / `127.0.0.1` | 网页地址。端口被占用会自动往后找 |
| `planner` | `claude` | 谁来当 Mavis 的大脑（规划和汇报）。不在岗时自动换另一位 |
| `plannerModel` | 空 | 规划用的模型，比如 `sonnet` 会更快更省 |
| `parallel` | `true` | 允许两人同时干活。`--serial` 可临时关掉 |
| `maxFixRounds` | `1` | 审查要求返工时，最多返工几轮 |
| `summarize` | `true` | 多任务时让 Mavis 写汇报；关掉就用简单列表 |
| `dispatchDelayMs` | `1500` | 派活前的停顿（Mavis 走过去送任务单的时间），设 `0` 就不等 |
| `taskTimeoutMin` | `30` | 单个任务超时（分钟） |
| `historyRounds` | `6` | Mavis 记住最近几轮对话 |
| `logDir` | `~/.mavis/logs` | 每次调用的完整提示词和原始输出 |
| `agents.claude` | | `command`、`model`、`permissionMode`、`allowedTools`、`extraArgs`、`strengths` |
| `agents.codex` | | `command`、`model`、`sandbox`、`extraArgs`、`strengths` |
| `agents.*.enabled` | `true` | 设成 `false` 让某一位休假 |

`strengths` 是写给 Mavis 看的「这个人擅长什么」，直接影响派活。你觉得谁更擅长什么，改这里就行。

## 常见问题

**显示「没找到 claude 命令」**：确认终端里能直接运行 `claude --version` / `codex --version`。如果装在别的路径，在配置里写 `"command": "完整路径"`。

**会花多少钱？** 每轮至少调用一次规划；多任务时还有一次汇报；每个任务一次工程师调用。Claude 的任务会在任务板上显示费用。用订阅登录的话按订阅额度走。规划换成 `sonnet` 能省不少。

**哪里看细节？** 任务板里展开任务；更完整的记录在 `~/.mavis/logs`。

**两个人同时改会冲突吗？** Mavis 只在任务改的文件互不重叠时才并行，并且在交代里写明各自负责的文件。不放心就用 `--serial`。

## 项目结构

```
bin/mavis.js        命令行入口
src/coordinator.js  调度核心：规划、依赖排序、并行派活、审查返工、汇报
src/agents.js       启动 claude / codex，解析它们的实时输出
src/prompts.js      Mavis 的人设和各种提示词
src/server.js       本地网页服务（Server-Sent Events 推送实时状态）
public/             像素办公室网页（office.js 是画面，demo.js 是没有服务器时的演示）
fake/               彩排用的假 Claude / Codex
test/               测试：npm test
```
