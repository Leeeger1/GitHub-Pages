// Rehearsal stand-in for an OpenAI-compatible API (a relay / DeepSeek / Qwen).
// With tools it drives the built-in agent through a few read-only tool calls, then reports.
import http from 'node:http'
import { answer, classify, finalText, sleep, verify } from './common.mjs'

const STEPS = [
  { name: 'list_files', args: { path: '.', depth: 1 } },
  { name: 'search', args: { pattern: 'function' } },
  { name: 'run_command', args: { command: 'git status --short' } },
]

function reply(body) {
  const messages = body.messages || []
  const user = messages.find((m) => m.role === 'user')?.content || ''
  if (!body.tools) return { content: answer(user) }
  const job = classify(user)
  const done = messages.filter((m) => m.role === 'tool').length
  if (done < STEPS.length) {
    const s = STEPS[done]
    return {
      content: done === 0 ? `先看看项目结构，再处理「${job.title}」。` : null,
      tool_calls: [{ id: `call_${done}`, type: 'function', function: { name: s.name, arguments: JSON.stringify(s.args) } }],
    }
  }
  return { content: job.mode === 'verify' ? verify(job) : finalText(job) }
}

export function startFakeOpenAI(port = 0) {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url.endsWith('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ data: [{ id: 'deepseek-chat' }, { id: 'qwen3-coder' }] }))
    }
    let raw = ''
    for await (const c of req) raw += c
    let body = {}
    try {
      body = JSON.parse(raw)
    } catch {}
    await sleep(body.tools ? 900 + Math.random() * 900 : 1400)
    const message = { role: 'assistant', ...reply(body) }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        id: 'fake',
        model: body.model,
        choices: [{ index: 0, message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }],
        usage: { prompt_tokens: 800, completion_tokens: 120 },
      }),
    )
  })
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}/v1`, close: () => (server.close(), server.closeAllConnections?.()) })))
}
