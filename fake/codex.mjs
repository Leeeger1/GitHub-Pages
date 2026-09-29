#!/usr/bin/env node
// Rehearsal stand-in for `codex exec` (used by `mavis --fake` and the tests).
import fs from 'node:fs'
import { classify, finalText, plan, readStdin, script, sleep, summary } from './common.mjs'

const argv = process.argv.slice(2)
if (argv.includes('--version')) {
  console.log('codex-cli 0.0.0-rehearsal')
  process.exit(0)
}

const out = (o) => process.stdout.write(JSON.stringify(o) + '\n')
const outFile = argv.includes('-o') ? argv[argv.indexOf('-o') + 1] : null
const prompt = await readStdin()
const job = classify(prompt)

if (!argv.includes('--json')) {
  await sleep(1400)
  const text = job.mode === 'summary' ? summary() : JSON.stringify(plan(job.request || ''))
  if (outFile) fs.writeFileSync(outFile, text)
  else console.log(text)
  process.exit(0)
}

out({ type: 'thread.started', thread_id: `fake-${Date.now()}` })
out({ type: 'turn.started' })
await sleep(600)
out({ type: 'item.completed', item: { id: 'r0', type: 'reasoning', text: `**Planning ${job.title}**` } })
let n = 0
for (const step of script(job)) {
  await sleep(800 + Math.random() * 1000)
  const id = `item_${++n}`
  if (step.kind === 'edit' || step.kind === 'write') {
    out({ type: 'item.completed', item: { id, type: 'file_change', status: 'completed', changes: [{ path: step.file, kind: step.kind === 'write' ? 'add' : 'update' }] } })
  } else {
    const command = step.kind === 'cmd' ? step.cmd : step.kind === 'grep' ? `rg ${step.pattern}` : `cat ${step.file}`
    out({ type: 'item.started', item: { id, type: 'command_execution', command: `bash -lc '${command}'`, status: 'in_progress' } })
    out({ type: 'item.completed', item: { id, type: 'command_execution', command: `bash -lc '${command}'`, exit_code: 0, status: 'completed' } })
  }
}
await sleep(600)
const text = finalText(job)
out({ type: 'item.completed', item: { id: 'msg', type: 'agent_message', text } })
out({ type: 'turn.completed', usage: { input_tokens: 1200, output_tokens: 300 } })
if (outFile) fs.writeFileSync(outFile, text)
