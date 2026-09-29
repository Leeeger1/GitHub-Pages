# 接入 API 指南

牛马工作室里，一个**项目组**就是一种模型。接入新模型，就是在配置文件里加一个项目组。这份指南讲清楚三种接法、每家平台怎么填，以及连不上时怎么排查。

> 各家的地址和模型名更新很快，下面的例子整理于 2026 年 9 月。以平台控制台和官方文档为准。

## 三种接法，先选一种

| 接法 | `type` | 适合 | 员工能做什么 |
|---|---|---|---|
| **API 员工**（最通用） | `openai-api` | 任何 OpenAI 兼容接口：DeepSeek、中转站、通义、Kimi、智谱、硅基流动、OpenRouter、本地 Ollama… | 用工作室内置的编程员工干活：列目录、读写文件、精确替换、搜索、跑命令 |
| **Claude Code 走中转** | `claude-cli` + `env` | 平台提供 **Anthropic 兼容**地址时（Claude 中转站、DeepSeek、Kimi、智谱都有） | 用 Claude Code 的全套工具干活，能力最强 |
| **Codex** | `codex-cli` | 已登录 OpenAI 账号的 Codex | Codex 自带的工具 |

拿不准就用第一种。第二种需要电脑上装了 Claude Code（`npm i -g @anthropic-ai/claude-code`），但不需要 Claude 账号，走的是你填的地址和 Key。

注意：API 员工要靠模型的**工具调用**（function calling）来读写文件。不支持工具调用的模型可以当傻妞的大脑（规划、汇报），但当不了员工。

## 第一步：配置文件和 Key 放哪

配置写在下面任一位置（后面的覆盖前面的）：

- `~/.niuma/config.json`：所有项目通用，**推荐放在这里**
- `项目目录/niuma.config.json`：只对这个项目生效
- `--config 文件路径`：启动时指定

Key 不要直接写进配置文件，放进环境变量：

```bash
# macOS / Linux（写进 ~/.zshrc 或 ~/.bashrc 以后每次都生效）
export DEEPSEEK_API_KEY="sk-..."
```

```powershell
# Windows PowerShell（setx 永久生效，重新打开终端后可用）
setx DEEPSEEK_API_KEY "sk-..."
```

配置里有两种写法引用它：

```json
{ "apiKeyEnv": "DEEPSEEK_API_KEY" }
{ "apiKey": "${DEEPSEEK_API_KEY}" }
```

`${变量名}` 在任何字段里都能用，包括 `baseUrl` 和 `env` 里的值。

## 第二步：确认连上了

启动时终端会列出每个项目组：

```
  项目组：
  ✓ Claude 组     2.1.284 (Claude Code)  ·  架构师、前端工程师、代码审查员
  ✓ DeepSeek 组   API · deepseek-v4-flash  ·  文档专员
  ✗ Kimi 组       缺少 API Key（环境变量 MOONSHOT_API_KEY）  ·  Kimi通才
```

打 ✗ 的组会显示原因，网页上这个组的工位也会显示「未到岗」。在聊天框里输入 `/团队`，可以看到每个组按难度用哪个模型。

API 组启动时会请求一次 `baseUrl/models` 做检查：Key 被拒绝（401/403）或者地址连不上，就标记为未到岗；其他情况都算在岗。

## 各家平台怎么填

下面每段都是 `groups` 数组里的一项。完整的配置文件长这样：

```json
{
  "groups": [
    { "id": "deepseek", "name": "DeepSeek 组", "type": "openai-api", "...": "..." }
  ]
}
```

`groups` 按 `id` 合并：写一个新 id 就是新增一个组，写已有的 id（比如 `claude`）就是修改它。

### DeepSeek

```json
{
  "id": "deepseek",
  "name": "DeepSeek 组",
  "type": "openai-api",
  "baseUrl": "https://api.deepseek.com",
  "apiKeyEnv": "DEEPSEEK_API_KEY",
  "models": { "hard": "deepseek-v4-pro", "medium": "deepseek-v4-flash", "easy": "deepseek-v4-flash" }
}
```

旧的 `deepseek-chat`、`deepseek-reasoner` 已在 2026-07-24 下线，请改用 `deepseek-v4-pro` / `deepseek-v4-flash`。

**用 Claude Code 驱动 DeepSeek**（DeepSeek 提供 Anthropic 兼容地址）：

```json
{
  "id": "deepseek-cc",
  "name": "DeepSeek 组",
  "type": "claude-cli",
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.deepseek.com/anthropic",
    "ANTHROPIC_AUTH_TOKEN": "${DEEPSEEK_API_KEY}",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "deepseek-v4-flash"
  },
  "models": { "hard": "deepseek-v4-pro", "medium": "deepseek-v4-flash", "easy": "deepseek-v4-flash" },
  "fallbackModel": ""
}
```

- `ANTHROPIC_DEFAULT_HAIKU_MODEL` 让 Claude Code 在后台跑小任务时也用 DeepSeek 的模型。
- `fallbackModel` 设成空，关掉默认的「退回 Sonnet」，因为 DeepSeek 上没有 Sonnet。

### 中转站

大部分中转站同时提供两种格式，按中转站文档选。

**OpenAI 格式**（地址一般以 `/v1` 结尾）：

```json
{
  "id": "relay",
  "name": "中转站组",
  "type": "openai-api",
  "baseUrl": "https://你的中转站地址/v1",
  "apiKeyEnv": "RELAY_API_KEY",
  "models": { "hard": "中转站里的强模型名", "medium": "常用模型名", "easy": "便宜模型名" }
}
```

模型名填中转站后台列出的名字，原样照抄。

**Anthropic 格式**（给 Claude 用，地址一般**不带** `/v1`）：

```json
{
  "id": "claude-relay",
  "name": "Claude 中转组",
  "type": "claude-cli",
  "env": {
    "ANTHROPIC_BASE_URL": "https://你的中转站地址",
    "ANTHROPIC_AUTH_TOKEN": "${RELAY_API_KEY}"
  },
  "models": { "hard": "opus", "medium": "sonnet", "easy": "haiku" }
}
```

想让默认的 Claude 组直接走中转，把 `id` 写成 `claude`（修改已有的组），不用另起一组。

### 通义千问（阿里云百炼）

```json
{
  "id": "qwen",
  "name": "通义组",
  "type": "openai-api",
  "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
  "apiKeyEnv": "DASHSCOPE_API_KEY",
  "models": { "hard": "qwen3-max", "medium": "qwen3-coder-plus", "easy": "qwen-flash" }
}
```

海外账号把域名换成 `dashscope-intl.aliyuncs.com`。

### Kimi（月之暗面）

```json
{
  "id": "kimi",
  "name": "Kimi 组",
  "type": "openai-api",
  "baseUrl": "https://api.moonshot.cn/v1",
  "apiKeyEnv": "MOONSHOT_API_KEY",
  "model": "控制台里的模型名，比如 kimi-k3"
}
```

Kimi 也提供 Anthropic 兼容地址 `https://api.moonshot.cn/anthropic`，可以按 DeepSeek 那段的写法用 Claude Code 驱动。海外账号用 `api.moonshot.ai`。

### 智谱 GLM

```json
{
  "id": "glm",
  "name": "智谱组",
  "type": "openai-api",
  "baseUrl": "https://open.bigmodel.cn/api/paas/v4",
  "apiKeyEnv": "ZHIPU_API_KEY",
  "models": { "hard": "glm-5.2", "medium": "glm-4.7", "easy": "glm-4.5-air" }
}
```

智谱的地址结尾是 `/api/paas/v4`，不是 `/v1`，照抄即可。用 Claude Code 驱动时，Anthropic 兼容地址是 `https://open.bigmodel.cn/api/anthropic`（海外 `https://api.z.ai/api/anthropic`）。

### 硅基流动

```json
{
  "id": "siliconflow",
  "name": "硅基流动组",
  "type": "openai-api",
  "baseUrl": "https://api.siliconflow.cn/v1",
  "apiKeyEnv": "SILICONFLOW_API_KEY",
  "model": "平台上的模型全名，比如 Qwen/Qwen3-Coder-480B-A35B-Instruct"
}
```

### OpenRouter

```json
{
  "id": "openrouter",
  "name": "OpenRouter 组",
  "type": "openai-api",
  "baseUrl": "https://openrouter.ai/api/v1",
  "apiKeyEnv": "OPENROUTER_API_KEY",
  "model": "厂商/模型名，比如 deepseek/deepseek-v4-pro"
}
```

### 本地模型（Ollama、LM Studio 等）

```json
{
  "id": "local",
  "name": "本地组",
  "type": "openai-api",
  "baseUrl": "http://localhost:11434/v1",
  "noKey": true,
  "model": "qwen3-coder",
  "maxParallel": 1,
  "tier": "fast",
  "cost": "low"
}
```

`noKey: true` 表示不需要 Key。本地模型一般一次只能跑一个任务，所以 `maxParallel` 设成 1。LM Studio 的地址通常是 `http://localhost:1234/v1`。

## 让傻妞认对新模型

傻妞按模型的**能力档次**（`tier`：`strong` 强 / `balanced` 中 / `fast` 快）和**价位**（`cost`：`high` / `medium` / `low`）来决定派什么难度的活。常见模型她认识，按模型名自动判断（Claude、GPT、Codex、DeepSeek、通义、Kimi、GLM、Gemini…）。新出的模型没认出来，或者你觉得她判断得不对，就在组里直接写：

```json
{
  "id": "relay",
  "tier": "strong",
  "cost": "low",
  "strengths": "推理强、便宜，适合难题和审查"
}
```

`strengths` 是写给傻妞看的「这个组擅长什么」，派活时会参考。

## 把员工放进新组

新组没有安排员工时，会自动配一名全栈工程师。想让某个岗位坐进新组，在配置里写：

```json
{
  "employees": [
    { "id": "writer", "skill": "writer", "group": "deepseek" },
    { "id": "tester2", "skill": "tester", "group": "qwen" }
  ]
}
```

或者在 skill 文件的开头写 `group: deepseek`，放进 `~/.niuma/skills/` 就行。也可以直接对傻妞说「/招人 测试工程师，放在 DeepSeek 组」。

## 项目组的全部字段

| 字段 | 适用 | 说明 |
|---|---|---|
| `id` | 全部 | 组的编号，员工配置里的 `group` 用它 |
| `name` | 全部 | 显示名，比如「DeepSeek 组」 |
| `type` | 全部 | `openai-api` / `claude-cli` / `codex-cli` |
| `model` | 全部 | 所有难度都用这个模型 |
| `models` | 全部 | 按难度分别指定：`{ "hard": "…", "medium": "…", "easy": "…" }`，缺的档次用 `medium` |
| `tier` / `cost` / `strengths` | 全部 | 覆盖傻妞对这个模型的判断 |
| `color` | 全部 | 工位和卡片的颜色，比如 `"#4d6bfe"` |
| `maxParallel` | 全部 | 这个组同时最多干几件活（命令行组默认 2，API 组默认 3） |
| `enabled` | 全部 | 设成 `false` 就是整组放假 |
| `baseUrl` | openai-api | 接口地址，写到 `/v1` 这一级（智谱是 `/api/paas/v4`）。只写域名会自动补 `/v1` |
| `apiKey` / `apiKeyEnv` | openai-api | Key 本身（可用 `${变量}`）或者环境变量名 |
| `noKey` | openai-api | 不需要 Key 的接口（本地模型） |
| `headers` | openai-api | 额外请求头，有的中转站需要 |
| `temperature` / `maxTokens` | openai-api | 生成参数，不写就用平台默认 |
| `extraBody` | openai-api | 原样合并进请求体的额外字段，比如某些平台的思考开关 |
| `vision` | openai-api | 模型能看图片（比如 GPT-4o、Qwen-VL）就设 `true`：插件返回的截图会发给它，傻妞也会把「电脑操作」派给这个组 |
| `maxSteps` | openai-api | 一个任务最多调用多少次工具，默认 60 |
| `maxContextChars` | openai-api | 对话太长时会省略早先的工具输出，默认 30 万字符 |
| `price` | openai-api | 每百万 token 的价格 `{ "input": 1, "output": 2 }`，填了就在任务板显示花费 |
| `command` | 命令行组 | 命令路径，装在非标准位置时用，比如 `"C:\\tools\\claude.cmd"` |
| `env` | 命令行组 | 启动命令时额外设置的环境变量，走中转站就靠它 |
| `fallbackModel` | claude-cli | 指定模型不可用时退回哪个，默认 `sonnet`，设成 `""` 关掉 |
| `permissionMode` / `allowedTools` / `disallowedTools` | claude-cli | 覆盖默认的权限设置 |
| `sandbox` / `network` | codex-cli | 沙箱模式（默认 `workspace-write`），`network: false` 禁止联网 |
| `extraArgs` | 命令行组 | 传给命令行的额外参数 |

## 连不上怎么办

| 现象 | 多半是 | 怎么办 |
|---|---|---|
| 缺少 API Key | 环境变量没设，或者设了没重开终端 | 按「第一步」设置，重新打开终端再启动 |
| API Key 被拒绝 | Key 填错、过期、余额不足 | 去平台控制台核对 |
| 连不上地址 | 地址写错，或者网络不通 | 用浏览器或 `curl 地址/models` 试一下 |
| 接口报错 404 | `baseUrl` 少了或多了 `/v1` | 地址写到 `/v1` 这一级，不要带 `/chat/completions` |
| 接口报错 400，提到 model | 模型名不对 | 照抄平台模型列表里的名字，注意大小写 |
| 员工一直不动手、只说话 | 模型不支持工具调用 | 换支持 function calling 的模型 |
| 接口报错 429 | 触发限流 | 会自动重试几次；经常出现就把这个组的 `maxParallel` 调小 |
| 参数不是合法的 JSON | 模型输出太长被截断 | 设大一点的 `maxTokens` |
| Claude Code 走中转报模型不存在 | 后台小任务用了中转站没有的模型 | 在 `env` 里设 `ANTHROPIC_DEFAULT_HAIKU_MODEL`，并把 `fallbackModel` 设成 `""` |

更细的记录在 `~/.niuma/logs`：每次调用的完整提示词、原始输出和报错都在里面。
