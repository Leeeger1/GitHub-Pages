#!/usr/bin/env node
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rehearsalConfig } from '../fake/rehearsal.mjs'
import { loadConfig } from '../src/config.js'
import { Coordinator } from '../src/coordinator.js'
import { createServer, isLoopback } from '../src/server.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const USAGE = `用法：shaniu [项目目录] [选项]

  项目目录            员工们干活的目录（默认：当前目录）

选项：
  --port <端口>       网页端口（默认 7777，被占用会自动往后找）
  --host <地址>       监听地址（默认 127.0.0.1；设成 0.0.0.0 可以用手机在局域网里看，会自动加访问口令）
  --config <文件>     额外的配置文件
  --brain <项目组>    谁来当傻妞的大脑（规划、验收、汇报），填项目组 id，比如 claude
  --safe              安全模式：员工只能跑白名单里的命令
  --serial            不并行，一个任务一个任务来
  --fake              彩排模式：用假的员工演一遍，不花钱、不改文件
  --no-open           不自动打开浏览器
  -h, --help          显示帮助
`

function parseArgs(argv) {
  const out = { overrides: {}, open: true }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => {
      const v = argv[++i]
      if (v === undefined) {
        console.error(`${a} 后面少了参数`)
        process.exit(1)
      }
      return v
    }
    if (a === '-h' || a === '--help') {
      console.log(USAGE)
      process.exit(0)
    } else if (a === '--port') out.overrides.port = Number(next())
    else if (a === '--host') out.overrides.host = next()
    else if (a === '--config') out.configFile = path.resolve(next())
    else if (a === '--brain') out.overrides.brain = next()
    else if (a === '--safe') out.overrides.autonomy = 'safe'
    else if (a === '--serial') out.overrides.parallel = false
    else if (a === '--fake') out.fake = true
    else if (a === '--no-open') out.open = false
    else if (a.startsWith('-')) {
      console.error(`不认识的选项：${a}\n\n${USAGE}`)
      process.exit(1)
    } else out.workdir = path.resolve(a)
  }
  return out
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]]
  try {
    const p = spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true, windowsHide: true })
    p.on('error', () => {})
    p.unref()
  } catch {}
}

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) return i.address
  }
  return 'localhost'
}

function listen(server, port, host, tries = 10) {
  return new Promise((resolve, reject) => {
    const onError = (e) => {
      server.off('listening', onListening)
      if (e.code === 'EADDRINUSE' && tries > 1) resolve(listen(server, port + 1, host, tries - 1))
      else reject(e)
    }
    const onListening = () => {
      server.off('error', onError)
      resolve(port)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, host)
  })
}

const args = parseArgs(process.argv.slice(2))
const workdir = args.workdir || process.cwd()
if (!fs.existsSync(workdir) || !fs.statSync(workdir).isDirectory()) {
  console.error(`目录不存在：${workdir}`)
  process.exit(1)
}

let config = loadConfig({ workdir, configFile: args.configFile, overrides: args.overrides })
let closeFake = () => {}
if (args.fake) {
  const r = await rehearsalConfig(config, root)
  config = { ...r.config, workdir, sources: config.sources }
  closeFake = r.close
}

const coord = new Coordinator(config, { mode: args.fake ? 'fake' : 'live', root })
const token = isLoopback(config.host) ? '' : crypto.randomBytes(12).toString('hex')
const server = createServer(coord, { publicDir: path.join(root, 'public'), host: config.host, token })

const shutdown = () => {
  coord.stopAll()
  closeFake()
  setTimeout(() => process.exit(0), 300)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

await coord.init()
const port = await listen(server, config.port || 7777, config.host)
const shownHost = isLoopback(config.host) ? 'localhost' : lanAddress()
const url = `http://${shownHost}:${port}/${token ? `?token=${token}` : ''}`

const lines = []
for (const g of coord.team.groups.values()) {
  const staff = coord.team.employees.filter((e) => e.group === g.id).map((e) => e.name)
  lines.push(`  ${g.available ? '✓' : '✗'} ${g.name.padEnd(12)} ${g.available ? g.version || '在岗' : g.note}  ·  ${staff.join('、')}`)
}
console.log(`
  ♥ 傻妞像素工作室${args.fake ? '（彩排模式）' : ''}

  工作目录  ${workdir}
  自主程度  ${config.autonomy === 'safe' ? '安全模式（命令走白名单）' : '全自动'}${config.git?.autoCommit ? '，每轮自动存档' : ''}
  项目组：
${lines.join('\n')}
  配置文件  ${config.sources?.length ? config.sources.join(', ') : '（默认配置）'}
  运行日志  ${config.logDir}

  打开 → ${url}
  按 Ctrl+C 退出
`)
if (args.open) openBrowser(url)
