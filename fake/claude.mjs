#!/usr/bin/env node
// Rehearsal stand-in for `claude -p` (used by `shaniu --fake` and the tests).
import { answer, classify, finalText, readStdin, script, sleep, verify } from './common.mjs'

const argv = process.argv.slice(2)
if (argv.includes('--version')) {
  console.log('0.0.0 (Rehearsal Claude)')
  process.exit(0)
}

const out = (o) => process.stdout.write(JSON.stringify(o) + '\n')
const format = argv[argv.indexOf('--output-format') + 1]
const prompt = await readStdin()
const job = classify(prompt)

if (format === 'json') {
  await sleep(job.mode === 'plan' ? 1600 : 1200)
  out({ type: 'result', subtype: 'success', is_error: false, result: answer(prompt), total_cost_usd: 0, session_id: 'fake' })
  process.exit(0)
}

// "罢工" in the request makes the Claude group fail every task, to rehearse hand-offs.
if (job.request?.includes('罢工')) {
  await sleep(500)
  out({ type: 'result', subtype: 'error_during_execution', is_error: true, result: '额度用完了（彩排）' })
  process.exit(1)
}

out({ type: 'system', subtype: 'init', session_id: `fake-${Date.now()}`, model: 'rehearsal' })
await sleep(400)
out({ type: 'assistant', message: { content: [{ type: 'text', text: `好的，我来处理「${job.title}」。` }] } })
let n = 0
const steps = job.mode === 'verify' ? script({ review: true }) : script(job)
for (const step of steps) {
  await sleep(800 + Math.random() * 800)
  const block =
    step.kind === 'cmd'
      ? { name: 'Bash', input: { command: step.cmd } }
      : step.kind === 'grep'
        ? { name: 'Grep', input: { pattern: step.pattern } }
        : { name: { read: 'Read', edit: 'Edit', write: 'Write' }[step.kind], input: { file_path: `${process.cwd()}/${step.file}` } }
  out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: `tu${++n}`, ...block }] } })
  out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: `tu${n}`, content: 'ok' }] } })
}
await sleep(600)
const text = job.mode === 'verify' ? verify(job) : finalText(job)
out({ type: 'assistant', message: { content: [{ type: 'text', text }] } })
out({ type: 'result', subtype: 'success', is_error: false, result: text, total_cost_usd: 0.01, num_turns: n + 2 })
