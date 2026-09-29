import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { startFakeOpenAI } from '../fake/openai-server.mjs'
import * as git from '../src/git.js'
import { OpenAIWorker, Toolbox } from '../src/workers/openai.js'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'niuma-agent-'))

test('toolbox reads, writes, edits and searches inside the project only', async () => {
  const dir = tmp()
  const box = new Toolbox(dir)
  assert.match(await box.exec('write_file', { path: 'src/a.js', content: 'const x = 1\nconst y = 2\n' }), /已写入/)
  assert.match(await box.exec('read_file', { path: 'src/a.js' }), /1\tconst x = 1/)
  assert.match(await box.exec('edit_file', { path: 'src/a.js', old_string: 'const', new_string: 'let' }), /出现了 2 次/)
  assert.match(await box.exec('edit_file', { path: 'src/a.js', old_string: 'const y', new_string: 'let y' }), /已修改/)
  assert.equal(fs.readFileSync(path.join(dir, 'src/a.js'), 'utf8'), 'const x = 1\nlet y = 2\n')
  assert.match(await box.exec('search', { pattern: 'let y' }), /src\/a\.js:2/)
  assert.match(await box.exec('list_files', {}), /src\//)
  assert.match(await box.exec('read_file', { path: '../../etc/passwd' }), /只能访问工作目录/)
  assert.match(await box.exec('write_file', { path: '/tmp/evil.txt', content: 'x' }), /只能访问工作目录/)
  assert.match(await box.exec('run_command', { command: 'node -e "console.log(6*7)"' }), /退出码 0\n42/)
  assert.match(await box.exec('run_command', { command: 'git push origin main' }), /太危险/)

  const ro = new Toolbox(dir, { readOnly: true })
  assert.match(await ro.exec('write_file', { path: 'b.js', content: '' }), /只读/)
  const safe = new Toolbox(dir, { autonomy: 'safe' })
  assert.match(await safe.exec('run_command', { command: 'curl example.com' }), /安全模式/)
})

test('the built-in API agent loops through tool calls against an OpenAI-compatible endpoint', async () => {
  process.env.NIUMA_FAKE_SPEED = '0.01'
  const api = await startFakeOpenAI()
  const dir = tmp()
  fs.writeFileSync(path.join(dir, 'index.js'), 'function main() {}\n')
  const w = new OpenAIWorker({ id: 'deepseek', type: 'openai-api', baseUrl: api.url, apiKey: 'k', model: 'deepseek-chat' }, { workdir: dir, logDir: dir })
  assert.equal(await w.check(), true)
  const acts = []
  const res = await w.run({ prompt: '## 你的任务 [t1] 写使用说明\n写 README', onActivity: (a) => acts.push(a.text) })
  assert.equal(res.ok, true, res.error)
  assert.match(res.text, /完成「写使用说明」/)
  assert.deepEqual(acts.filter((a) => /^(看目录|搜|跑)/.test(a)), ['看目录 .', '搜 “function”', '跑 git status --short'])
  assert.equal(res.usage.in, 800 * 4)
  const plan = JSON.parse(await w.ask('## 主人刚刚说\n做个网站\n## 你要决定'))
  assert.ok(Array.isArray(plan.tasks))

  const noKey = new OpenAIWorker({ id: 'x', type: 'openai-api', baseUrl: api.url, model: 'm', apiKeyEnv: 'NIUMA_TEST_MISSING_KEY' }, { workdir: dir, logDir: dir })
  assert.equal(await noKey.check(), false)
  assert.match(noKey.note, /NIUMA_TEST_MISSING_KEY/)
  api.close()
})

test('git save points skip dependencies and secrets, and a round can be undone', async () => {
  const dir = tmp()
  assert.equal(await git.isRepo(dir), false)
  assert.equal(await git.initRepo(dir), true)
  fs.writeFileSync(path.join(dir, 'app.js'), 'v1\n')
  fs.mkdirSync(path.join(dir, 'node_modules', 'x'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'node_modules', 'x', 'i.js'), '')
  fs.writeFileSync(path.join(dir, '.env'), 'KEY=secret\n')
  fs.rmSync(path.join(dir, '.gitignore'))
  const first = await git.commitAll(dir, 'first')
  assert.ok(first)
  const files = (await git.git(dir, 'ls-files')).out.split('\n')
  assert.deepEqual(files, ['app.js'])
  assert.equal(await git.commitAll(dir, 'nothing'), null)

  fs.writeFileSync(path.join(dir, 'app.js'), 'v2\n')
  const round = await git.commitAll(dir, 'round')
  const r = await git.revertCommit(dir, round)
  assert.equal(r.ok, true, r.error)
  assert.equal(fs.readFileSync(path.join(dir, 'app.js'), 'utf8'), 'v1\n')
})
