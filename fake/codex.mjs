#!/usr/bin/env node
// Rehearsal stand-in for `codex exec` (used by `shaniu --fake` and the tests).
import fs from 'node:fs'
import { answer, classify, finalText, readStdin, script, sleep, verify } from './common.mjs'

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
  const text = answer(prompt)
  if (outFile) fs.writeFileSync(outFile, text)
  else console.log(text)
  process.exit(0)
}

out({ type: 'thread.started', thread_id: `fake-${Date.now()}` })
out({ type: 'turn.started' })
await sleep(500)
out({ type: 'item.completed', item: { id: 'r0', type: 'reasoning', text: `**Planning ${job.title}**` } })
let n = 0
const steps = job.mode === 'verify' ? script({ review: true }) : script(job)
for (const step of steps) {
  await sleep(700 + Math.random() * 900)
  const id = `item_${++n}`
  if (step.kind === 'edit' || step.kind === 'write') {
    out({ type: 'item.completed', item: { id, type: 'file_change', status: 'completed', changes: [{ path: step.file, kind: step.kind === 'write' ? 'add' : 'update' }] } })
  } else {
    const command = step.kind === 'cmd' ? step.cmd : step.kind === 'grep' ? `rg ${step.pattern}` : `cat ${step.file}`
    out({ type: 'item.started', item: { id, type: 'command_execution', command: `bash -lc '${command}'`, status: 'in_progress' } })
    out({ type: 'item.completed', item: { id, type: 'command_execution', command: `bash -lc '${command}'`, exit_code: 0, status: 'completed' } })
  }
}
await sleep(500)
const text = job.mode === 'verify' ? verify(job) : finalText(job)
out({ type: 'item.completed', item: { id: 'msg', type: 'agent_message', text } })
out({ type: 'turn.completed', usage: { input_tokens: 1200, output_tokens: 300 } })
if (outFile) fs.writeFileSync(outFile, text)
