import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { startFakeOpenAI } from '../fake/openai-server.mjs'
import { loadConfig } from '../src/config.js'
import { Coordinator } from '../src/coordinator.js'
import { createSetup, testApi, userConfigFile } from '../src/setup.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'niuma-setup-'))
process.env.HOME = tmp()
process.env.USERPROFILE = process.env.HOME
process.env.NIUMA_FAKE_SPEED = '0.01'

function refuse(status) {
  const server = http.createServer((req, res) => {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end('{"error":{"message":"nope"}}')
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}/v1`, close: () => server.close() })))
}

test('testApi says in plain words what is wrong', async (t) => {
  const api = await startFakeOpenAI()
  const denied = await refuse(401)
  t.after(() => (api.close(), denied.close()))
  const ok = await testApi({ baseUrl: api.url, apiKey: 'k', models: { medium: 'deepseek-v4-flash' } })
  assert.equal(ok.ok, true, ok.error)
  assert.equal(ok.model, 'deepseek-v4-flash')
  // 地址末尾多写了 /chat/completions 也认
  assert.equal((await testApi({ baseUrl: `${api.url}/chat/completions`, apiKey: 'k', models: { hard: 'm' } })).ok, true)
  assert.match((await testApi({ baseUrl: denied.url, apiKey: 'k', models: { medium: 'm' } })).error, /Key 不对/)
  assert.match((await testApi({ baseUrl: api.url, models: { medium: 'm' } })).error, /还没填 API Key/)
  assert.equal((await testApi({ baseUrl: api.url, noKey: true, models: { medium: 'm' } })).ok, true)
  assert.match((await testApi({ baseUrl: 'api.example.com', apiKey: 'k', models: { medium: 'm' } })).error, /http/)
  assert.match((await testApi({ baseUrl: api.url, apiKey: 'k' })).error, /模型名/)
})

test('connecting an API group from the panel saves it and seats the new staff without a restart', async (t) => {
  const api = await startFakeOpenAI()
  const denied = await refuse(401)
  t.after(() => (api.close(), denied.close()))
  const workdir = tmp()
  const load = () => loadConfig({ workdir })
  const coord = new Coordinator(load(), { mode: 'live', root })
  await coord.team.check()
  const rosters = []
  coord.on('event', (ev) => ev.type === 'roster' && rosters.push(ev))
  const setup = createSetup({ coord, reload: () => coord.reconfigure(load()) })

  const bad = await setup.saveApi({ preset: 'relay', baseUrl: denied.url, apiKey: 'wrong', models: { medium: 'm' } })
  assert.equal(bad.ok, false)
  assert.equal(fs.existsSync(userConfigFile()), false, 'a failed test must not write the key anywhere')

  const r = await setup.saveApi({ preset: 'relay', baseUrl: api.url, apiKey: 'sk-1', models: { hard: 'deepseek-v4-pro' } })
  assert.equal(r.ok, true, r.error)
  assert.equal(r.id, 'relay')
  assert.equal(r.available, true)
  const saved = JSON.parse(fs.readFileSync(userConfigFile(), 'utf8'))
  assert.deepEqual(saved.groups, [{ id: 'relay', name: '中转站组', type: 'openai-api', baseUrl: api.url, models: { hard: 'deepseek-v4-pro', medium: 'deepseek-v4-pro' }, apiKey: 'sk-1' }])
  if (process.platform !== 'win32') assert.equal(fs.statSync(userConfigFile()).mode & 0o777, 0o600)
  assert.equal(coord.team.groups.get('relay').available, true)
  assert.ok(coord.team.employees.some((e) => e.group === 'relay'), 'an empty group gets a generalist')
  assert.ok(rosters.at(-1).roster.groups.some((g) => g.id === 'relay'), 'the page hears about the new group')
  assert.match(coord.messages.at(-1).text, /新同事到岗啦/)

  // 同一家再接一次不会覆盖前一个
  const again = await setup.saveApi({ preset: 'relay', baseUrl: api.url, apiKey: 'sk-2', models: { medium: 'qwen3-coder' }, name: '备用组' })
  assert.equal(again.id, 'relay-2')

  const st = await setup.status()
  assert.equal(st.groups.find((g) => g.id === 'relay').removable, true)
  assert.equal(st.groups.find((g) => g.id === 'claude').removable, false)
  assert.ok(st.presets.some((p) => p.id === 'deepseek'))

  await setup.remove('relay')
  assert.equal(coord.team.groups.has('relay'), false)
  assert.deepEqual(JSON.parse(fs.readFileSync(userConfigFile(), 'utf8')).groups.map((g) => g.id), ['relay-2'])
  await assert.rejects(setup.remove('claude'), /不是在这里接入的/)

  coord.busy = true
  await assert.rejects(setup.saveApi({ preset: 'relay', baseUrl: api.url, apiKey: 'k', models: { medium: 'm' } }), /还有活/)
  coord.busy = false
})

test('rehearsal mode refuses to connect real staff', async () => {
  const coord = new Coordinator(loadConfig({ workdir: tmp() }), { mode: 'fake', root })
  const setup = createSetup({ coord, fake: true, reload: async () => {} })
  await assert.rejects(setup.saveApi({ preset: 'deepseek', apiKey: 'k' }), /彩排/)
  await assert.rejects(setup.install('claude'), /彩排/)
})
