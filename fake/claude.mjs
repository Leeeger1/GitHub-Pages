#!/usr/bin/env node
// Rehearsal stand-in for `claude -p` (used by `mavis --fake` and the tests).
import { classify, finalText, plan, readStdin, script, sleep, summary } from './common.mjs'

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
  const result = job.mode === 'summary' ? summary() : JSON.stringify(plan(job.request || ''))
  out({ type: 'result', subtype: 'success', is_error: false, result, total_cost_usd: 0, session_id: 'fake' })
  process.exit(0)
}

out({ type: 'system', subtype: 'init', session_id: `fake-${Date.now()}`, model: 'rehearsal' })
await sleep(500)
out({ type: 'assistant', message: { content: [{ type: 'text', text: `好的，我来处理「${job.title}」。` }] } })
let n = 0
for (const step of script(job)) {
  await sleep(900 + Math.random() * 900)
  const block =
    step.kind === 'cmd'
      ? { name: 'Bash', input: { command: step.cmd } }
      : step.kind === 'grep'
        ? { name: 'Grep', input: { pattern: step.pattern } }
        : { name: { read: 'Read', edit: 'Edit', write: 'Write' }[step.kind], input: { file_path: `${process.cwd()}/${step.file}` } }
  out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: `tu${++n}`, ...block }] } })
  out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: `tu${n}`, content: 'ok' }] } })
}
await sleep(700)
const text = finalText(job)
out({ type: 'assistant', message: { content: [{ type: 'text', text }] } })
out({ type: 'result', subtype: 'success', is_error: false, result: text, total_cost_usd: 0, num_turns: n + 2 })
