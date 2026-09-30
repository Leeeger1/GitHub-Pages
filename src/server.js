import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
}

// public/index.html is written as a document fragment (so the same file can be published as a
// standalone page); the server supplies the document shell.
const SHELL =
  '<!doctype html>\n<html lang="zh-CN">\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

export function isLoopback(host) {
  return LOOPBACK.has(host)
}

export function createServer(coord, { publicDir, host, token, setup }) {
  const clients = new Set()
  const loopbackOnly = isLoopback(host)
  // The request really comes from this computer (not a phone on the LAN), whatever address we listen on.
  const fromThisComputer = (req) => isLoopback(String(req.socket.remoteAddress || '').replace(/^::ffff:/, ''))

  coord.on('event', (ev) => {
    const data = `data: ${JSON.stringify(ev)}\n\n`
    for (const res of clients) res.write(data)
  })

  const heartbeat = setInterval(() => {
    for (const res of clients) res.write(': ping\n\n')
  }, 20000)
  heartbeat.unref()

  const send = (res, code, body, type = 'text/plain; charset=utf-8') => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' })
    res.end(body)
  }
  const json = (res, code, obj) => send(res, code, JSON.stringify(obj), 'application/json; charset=utf-8')

  const hostOk = (req) => {
    if (!loopbackOnly) return true
    const h = String(req.headers.host || '').replace(/:\d+$/, '')
    return isLoopback(h)
  }
  const originOk = (req) => {
    const origin = req.headers.origin
    if (!origin) return true
    try {
      return new URL(origin).host === req.headers.host
    } catch {
      return false
    }
  }
  const authOk = (req, url) => !token || req.headers['x-niuma-token'] === token || url.searchParams.get('token') === token

  const readBody = (req) =>
    new Promise((resolve, reject) => {
      let body = ''
      req.setEncoding('utf8')
      req.on('data', (c) => {
        body += c
        if (body.length > 200_000) {
          reject(new Error('too large'))
          req.destroy()
        }
      })
      req.on('end', () => resolve(body))
      req.on('error', reject)
    })

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://niuma.local')
    // Blocks DNS-rebinding: a page on another domain can't talk to us through a hostname it controls.
    if (!hostOk(req)) return send(res, 403, 'Forbidden host')

    if (url.pathname === '/events' || url.pathname.startsWith('/api/')) {
      if (!authOk(req, url)) return send(res, 401, 'Missing or wrong token')

      if (req.method === 'GET' && url.pathname === '/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        })
        res.write(`data: ${JSON.stringify({ type: 'snapshot', state: coord.snapshot() })}\n\n`)
        clients.add(res)
        req.on('close', () => clients.delete(res))
        return
      }
      if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, coord.snapshot())

      // 「接入员工」会装软件、开终端、写配置：只给本机用，局域网里的手机不行。
      if (url.pathname.startsWith('/api/setup')) {
        if (!setup) return send(res, 404, 'Not found')
        if (!fromThisComputer(req)) return json(res, 403, { ok: false, error: '只能在运行牛马工作室的那台电脑上接入员工' })
        if (req.method === 'GET' && url.pathname === '/api/setup') {
          try {
            return json(res, 200, await setup.status())
          } catch (e) {
            return json(res, 500, { ok: false, error: e.message })
          }
        }
      }

      if (req.method === 'POST') {
        // Only same-origin JSON requests: a random website can't make the browser send these.
        if (!originOk(req) || !String(req.headers['content-type'] || '').startsWith('application/json')) {
          return send(res, 403, 'Forbidden')
        }
        let body = {}
        try {
          body = JSON.parse((await readBody(req)) || '{}')
        } catch {
          return send(res, 400, 'Bad JSON')
        }
        if (url.pathname === '/api/message') {
          const text = String(body.text || '').trim()
          if (!text) return send(res, 400, 'Empty message')
          coord.post(text)
          return json(res, 200, { ok: true })
        }
        if (url.pathname === '/api/stop') {
          coord.stop()
          return json(res, 200, { ok: true })
        }
        if (setup && url.pathname.startsWith('/api/setup/')) {
          const actions = {
            install: () => setup.install(body.tool),
            'install-terminal': () => setup.installInTerminal(body.tool),
            login: () => setup.login(body.tool),
            test: () => (body.tool ? setup.testCli(body.tool) : setup.testApi(body.api || {})),
            api: () => setup.saveApi(body),
            remove: () => setup.remove(body.id),
            recheck: () => setup.recheck(),
          }
          const act = actions[url.pathname.slice('/api/setup/'.length)]
          if (!act) return send(res, 404, 'Not found')
          try {
            return json(res, 200, await act())
          } catch (e) {
            return json(res, 200, { ok: false, error: e.message })
          }
        }
      }
      return send(res, 404, 'Not found')
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed')
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '')
    const file = path.resolve(publicDir, rel)
    if (!file.startsWith(path.resolve(publicDir) + path.sep)) return send(res, 403, 'Forbidden')
    fs.readFile(file, (err, data) => {
      if (err) return send(res, 404, 'Not found')
      const type = TYPES[path.extname(file)] || 'application/octet-stream'
      if (rel === 'index.html') data = SHELL + data.toString('utf8')
      send(res, 200, data, type)
    })
  })
}
