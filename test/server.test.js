import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import http from 'node:http'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from '../src/server.js'

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public')

function fakeCoord() {
  const c = new EventEmitter()
  c.posted = []
  c.snapshot = () => ({ mode: 'live', agents: {}, tasks: [], messages: [] })
  c.post = (t) => c.posted.push(t)
  c.stop = () => {}
  return c
}

async function start(t, opts) {
  const coord = fakeCoord()
  const server = createServer(coord, { publicDir, ...opts })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  t.after(() => {
    server.close()
    server.closeAllConnections()
  })
  const port = server.address().port
  const req = (p, { method = 'GET', headers = {}, body } = {}) =>
    new Promise((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { Host: `localhost:${port}`, ...headers } }, (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => resolve({ status: res.statusCode, body: data, type: res.headers['content-type'] }))
      })
      r.on('error', reject)
      r.end(body)
    })
  return { coord, server, port, req }
}

test('serves the page with a document shell and blocks path traversal', async (t) => {
  const { server, req } = await start(t, { host: '127.0.0.1' })
  const page = await req('/')
  assert.equal(page.status, 200)
  assert.match(page.body, /^<!doctype html>/)
  assert.match(page.body, /傻妞像素工作室/)
  assert.equal((await req('/app.js')).status, 200)
  assert.notEqual((await req('/../package.json')).status, 200)
  assert.notEqual((await req('/%2e%2e/package.json')).status, 200)
})

test('loopback mode rejects foreign Host headers and cross-site posts', async (t) => {
  const { coord, server, port, req } = await start(t, { host: '127.0.0.1' })
  assert.equal((await req('/api/state', { headers: { Host: 'evil.example:80' } })).status, 403)
  const json = { 'Content-Type': 'application/json' }
  const body = JSON.stringify({ text: '你好' })
  assert.equal((await req('/api/message', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body })).status, 403)
  assert.equal((await req('/api/message', { method: 'POST', headers: { ...json, Origin: 'https://evil.example' }, body })).status, 403)
  const ok = await req('/api/message', { method: 'POST', headers: { ...json, Origin: `http://localhost:${port}` }, body })
  assert.equal(ok.status, 200)
  assert.deepEqual(coord.posted, ['你好'])
})

test('LAN mode requires the token', async (t) => {
  const { server, req } = await start(t, { host: '0.0.0.0', token: 'secret' })
  assert.equal((await req('/api/state')).status, 401)
  assert.equal((await req('/api/state?token=secret')).status, 200)
  assert.equal((await req('/api/state', { headers: { 'X-Shaniu-Token': 'secret' } })).status, 200)
  assert.equal((await req('/')).status, 200)
})
