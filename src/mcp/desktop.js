#!/usr/bin/env node
// 电脑操作: a small MCP server (stdio) that lets an employee look at the screen and use the mouse and
// keyboard. Zero dependencies: Windows uses PowerShell, macOS uses screencapture + JXA/AppleScript,
// Linux uses xdotool + ImageMagick. Coordinates are in screenshot pixels; the server maps them to the
// real screen, so the model never has to know about DPI scaling or Retina displays.
import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PLATFORM = process.env.NIUMA_DESKTOP_PLATFORM || process.platform
const MAX_W = Math.max(320, Number(process.env.NIUMA_SCREEN_MAX_WIDTH) || 1280)
const OS_ZH = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[PLATFORM] || PLATFORM
const MOD_HINT = PLATFORM === 'darwin' ? '（macOS 上复制粘贴等用 cmd，比如 cmd+c）' : '（比如 ctrl+c、alt+tab、win）'

// Screen units per screenshot pixel, set by the last screenshot (or measured on first use).
let scale = null

// xdotool types multi-byte text only under a UTF-8 locale; minimal systems often run with POSIX.
// Apps opened from here must not inherit ELECTRON_RUN_AS_NODE (set when 傻妞 runs inside the desktop app).
const ENV = { ...process.env }
delete ENV.ELECTRON_RUN_AS_NODE
if (PLATFORM === 'linux' && !/utf-?8/i.test(process.env.LC_ALL || process.env.LC_CTYPE || process.env.LANG || '')) ENV.LC_ALL = 'C.UTF-8'

function run(cmd, args, { input, timeout = 30000, encoding = 'utf8' } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { timeout, encoding, env: ENV, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        const why = err.code === 'ENOENT' ? `找不到命令 ${cmd}${PLATFORM === 'linux' ? '（Linux 上请先安装 xdotool 和 imagemagick）' : ''}` : String(stderr || err.message).trim().split('\n').slice(-3).join(' ')
        reject(new Error(why))
      } else resolve({ stdout, stderr })
    })
    if (input != null) child.stdin.end(input)
  })
}

function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(12) !== 0x49484452) throw new Error('截图不是 PNG')
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
}

const num = (v, name) => {
  const n = Number(v)
  if (!Number.isFinite(n)) throw new Error(`${name} 必须是数字`)
  return n
}

// ---- key names -------------------------------------------------------------------------------

const ALIASES = {
  control: 'ctrl', ctl: 'ctrl', option: 'alt', opt: 'alt', command: 'cmd', meta: 'cmd', super: 'win', windows: 'win',
  return: 'enter', escape: 'esc', del: 'delete', pgup: 'pageup', pgdn: 'pagedown', page_up: 'pageup', page_down: 'pagedown',
  arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right', spacebar: 'space', bksp: 'backspace', ins: 'insert',
}
const MODS = new Set(['ctrl', 'shift', 'alt', 'cmd', 'win'])

export function parseKeys(keys) {
  const parts = String(keys || '')
    .toLowerCase()
    .split(/\s*\+\s*/)
    .map((k) => ALIASES[k.trim()] || k.trim())
    .filter(Boolean)
  if (!parts.length) throw new Error('keys 不能为空')
  const mods = parts.filter((k) => MODS.has(k))
  const rest = parts.filter((k) => !MODS.has(k))
  if (rest.length > 1) throw new Error(`一次只能按一个主键：${keys}`)
  return { mods, key: rest[0] || null }
}

// ---- Linux (X11) -------------------------------------------------------------------------------

const X_KEYS = {
  enter: 'Return', esc: 'Escape', backspace: 'BackSpace', delete: 'Delete', tab: 'Tab', space: 'space', up: 'Up', down: 'Down',
  left: 'Left', right: 'Right', home: 'Home', end: 'End', pageup: 'Prior', pagedown: 'Next', insert: 'Insert', capslock: 'Caps_Lock',
}
const X_MODS = { ctrl: 'ctrl', shift: 'shift', alt: 'alt', cmd: 'super', win: 'super' }
const X_BUTTON = { left: 1, middle: 2, right: 3 }

const linux = {
  async size() {
    const { stdout } = await run('xdotool', ['getdisplaygeometry'])
    const [w, h] = stdout.trim().split(/\s+/).map(Number)
    return { w, h }
  },
  async screenshot() {
    const { stdout } = await run('import', ['-silent', '-window', 'root', '-resize', `${MAX_W}x>`, 'png:-'], { encoding: 'buffer', timeout: 20000 })
    return { png: stdout, screen: await linux.size() }
  },
  // One xdotool process per action, so the move and the click happen on the same connection.
  async click(x, y, button, count) {
    await run('xdotool', ['mousemove', String(x), String(y), 'click', '--repeat', String(count), '--delay', '80', String(X_BUTTON[button])])
  },
  async move(x, y) {
    await run('xdotool', ['mousemove', String(x), String(y)])
  },
  async drag(x1, y1, x2, y2) {
    const steps = []
    for (let i = 1; i <= 10; i++) steps.push('mousemove', String(Math.round(x1 + ((x2 - x1) * i) / 10)), String(Math.round(y1 + ((y2 - y1) * i) / 10)), 'sleep', '0.02')
    await run('xdotool', ['mousemove', String(x1), String(y1), 'mousedown', '1', 'sleep', '0.1', ...steps, 'mouseup', '1'])
  },
  async scroll(x, y, dir, amount) {
    const b = { up: 4, down: 5, left: 6, right: 7 }[dir]
    const pre = x != null ? ['mousemove', String(x), String(y)] : []
    await run('xdotool', [...pre, 'click', '--repeat', String(amount), '--delay', '40', String(b)])
  },
  async type(text) {
    await run('xdotool', ['type', '--delay', '15', '--', text])
  },
  async key(keys) {
    const { mods, key } = parseKeys(keys)
    const main = key ? X_KEYS[key] || (/^f\d{1,2}$/.test(key) ? key.toUpperCase() : key) : null
    const combo = [...mods.map((m) => X_MODS[m]), ...(main ? [main] : [])].join('+')
    await run('xdotool', ['key', combo])
  },
  async open(target) {
    const isPath = /^[a-z]+:\/\//i.test(target) || fs.existsSync(target)
    const child = isPath ? spawn('xdg-open', [target], { detached: true, stdio: 'ignore', env: ENV }) : spawn('sh', ['-c', target], { detached: true, stdio: 'ignore', env: ENV })
    child.on('error', () => {})
    child.unref()
  },
}

// ---- macOS -------------------------------------------------------------------------------------

const MAC_CODES = {
  enter: 36, tab: 48, space: 49, backspace: 51, esc: 53, delete: 117, left: 123, right: 124, down: 125, up: 126,
  home: 115, end: 119, pageup: 116, pagedown: 121, f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98, f8: 100,
  f9: 101, f10: 109, f11: 103, f12: 111,
}
const MAC_MODS = { ctrl: 'control down', shift: 'shift down', alt: 'option down', cmd: 'command down', win: 'command down' }
const jxa = (src) => run('osascript', ['-l', 'JavaScript', '-e', src])
const applescript = (src) => run('osascript', ['-e', src])
const MAC_MOUSE = `ObjC.import('CoreGraphics');
function post(t, x, y, b, n) { var e = $.CGEventCreateMouseEvent(null, t, $.CGPointMake(x, y), b); if (n) $.CGEventSetIntegerValueField(e, 1, n); $.CGEventPost(0, e); }`

const mac = {
  async size() {
    const { stdout } = await jxa(`ObjC.import('AppKit'); var f = $.NSScreen.mainScreen.frame; var s = $.NSScreen.mainScreen.backingScaleFactor; [f.size.width, f.size.height, s].join(' ')`)
    const [w, h, s] = stdout.trim().split(/\s+/).map(Number)
    return { w, h, pixelW: Math.round(w * s) }
  },
  async screenshot() {
    const file = path.join(os.tmpdir(), `niuma-shot-${process.pid}-${Date.now()}.png`)
    try {
      await run('screencapture', ['-x', '-t', 'png', file], { timeout: 20000 })
      let png = fs.readFileSync(file)
      if (pngSize(png).w > MAX_W) {
        await run('sips', ['--resampleWidth', String(MAX_W), file, '--out', file])
        png = fs.readFileSync(file)
      }
      return { png, screen: await mac.size() }
    } finally {
      fs.rm(file, { force: true }, () => {})
    }
  },
  async click(x, y, button, count) {
    const [down, up, b] = { left: [1, 2, 0], right: [3, 4, 1], middle: [25, 26, 2] }[button]
    let s = `${MAC_MOUSE}\npost(5, ${x}, ${y}, 0, 0); delay(0.05);`
    for (let i = 1; i <= count; i++) s += `post(${down}, ${x}, ${y}, ${b}, ${i}); post(${up}, ${x}, ${y}, ${b}, ${i}); delay(0.06);`
    await jxa(s)
  },
  async move(x, y) {
    await jxa(`${MAC_MOUSE}\npost(5, ${x}, ${y}, 0, 0);`)
  },
  async drag(x1, y1, x2, y2) {
    let s = `${MAC_MOUSE}\npost(5, ${x1}, ${y1}, 0, 0); delay(0.05); post(1, ${x1}, ${y1}, 0, 1); delay(0.1);`
    for (let i = 1; i <= 10; i++) s += `post(6, ${x1 + ((x2 - x1) * i) / 10}, ${y1 + ((y2 - y1) * i) / 10}, 0, 0); delay(0.02);`
    s += `post(2, ${x2}, ${y2}, 0, 1);`
    await jxa(s)
  },
  async scroll(x, y, dir, amount) {
    const [dy, dx] = { up: [amount, 0], down: [-amount, 0], left: [0, amount], right: [0, -amount] }[dir]
    const pre = x != null ? `post(5, ${x}, ${y}, 0, 0); delay(0.05);` : ''
    await jxa(`${MAC_MOUSE}\n${pre} var e = $.CGEventCreateScrollWheelEvent2(null, 1, 2, ${dy}, ${dx}, 0); $.CGEventPost(0, e);`)
  },
  async type(text) {
    // Paste through the clipboard so Chinese and symbols arrive intact; the old clipboard is put back.
    let old = null
    try {
      old = (await run('pbpaste', [])).stdout
    } catch {}
    await run('pbcopy', [], { input: text })
    await applescript('tell application "System Events" to keystroke "v" using command down')
    await new Promise((r) => setTimeout(r, 300))
    if (old != null) await run('pbcopy', [], { input: old }).catch(() => {})
  },
  async key(keys) {
    const { mods, key } = parseKeys(keys)
    const using = mods.length ? ` using {${mods.map((m) => MAC_MODS[m]).join(', ')}}` : ''
    if (!key) throw new Error('macOS 上不能只按修饰键')
    const code = MAC_CODES[key]
    const press = code != null ? `key code ${code}` : `keystroke ${JSON.stringify(key)}`
    await applescript(`tell application "System Events" to ${press}${using}`)
  },
  async open(target) {
    const isPath = /^[a-z]+:\/\//i.test(target) || fs.existsSync(target)
    await run('open', isPath ? [target] : ['-a', target])
  },
}

// ---- Windows -----------------------------------------------------------------------------------

const WIN_PRELUDE = `$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NiumaInput {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, int data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
}
'@
[NiumaInput]::SetProcessDPIAware() | Out-Null
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
function Mouse([uint32]$f, [int]$d = 0) { [NiumaInput]::mouse_event($f, 0, 0, $d, [UIntPtr]::Zero) }
function KeyDown([byte]$vk, [uint32]$x = 0) { [NiumaInput]::keybd_event($vk, 0, $x, [UIntPtr]::Zero) }
function KeyUp([byte]$vk, [uint32]$x = 0) { [NiumaInput]::keybd_event($vk, 0, (2 -bor $x), [UIntPtr]::Zero) }
function MoveTo([int]$x, [int]$y) { [NiumaInput]::SetCursorPos($screen.Left + $x, $screen.Top + $y) | Out-Null; Start-Sleep -Milliseconds 40 }
`
const WIN_VK = {
  ctrl: 0x11, shift: 0x10, alt: 0x12, win: 0x5b, cmd: 0x5b, enter: 0x0d, tab: 0x09, esc: 0x1b, space: 0x20, backspace: 0x08,
  delete: 0x2e, insert: 0x2d, home: 0x24, end: 0x23, pageup: 0x21, pagedown: 0x22, left: 0x25, up: 0x26, right: 0x27, down: 0x28,
  capslock: 0x14, printscreen: 0x2c,
}
const WIN_EXTENDED = new Set([0x2e, 0x2d, 0x24, 0x23, 0x21, 0x22, 0x25, 0x26, 0x27, 0x28])

export function winVk(key) {
  if (WIN_VK[key] != null) return WIN_VK[key]
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(key)) return 0x6f + Number(key.slice(1))
  if (/^[a-z0-9]$/.test(key)) return key.toUpperCase().charCodeAt(0)
  const punct = { ';': 0xba, '=': 0xbb, ',': 0xbc, '-': 0xbd, '.': 0xbe, '/': 0xbf, '`': 0xc0, '[': 0xdb, '\\': 0xdc, ']': 0xdd, "'": 0xde }
  if (punct[key] != null) return punct[key]
  throw new Error(`不认识的按键：${key}`)
}

const ps = async (body, timeout = 30000) => {
  const script = WIN_PRELUDE + body
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { timeout })
  return stdout
}
const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64')
const WIN_BUTTON = { left: [0x02, 0x04], right: [0x08, 0x10], middle: [0x20, 0x40] }

const win = {
  async size() {
    const out = await ps('"$($screen.Width) $($screen.Height)"')
    const [w, h] = out.trim().split(/\s+/).map(Number)
    return { w, h }
  },
  async screenshot() {
    const out = await ps(
      `$bmp = New-Object System.Drawing.Bitmap $screen.Width, $screen.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($screen.Left, $screen.Top, 0, 0, $bmp.Size)
$s = [Math]::Min(1.0, ${MAX_W} / $screen.Width)
$ow = [int][Math]::Round($screen.Width * $s); $oh = [int][Math]::Round($screen.Height * $s)
$out = New-Object System.Drawing.Bitmap $ow, $oh
$g2 = [System.Drawing.Graphics]::FromImage($out)
$g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g2.DrawImage($bmp, 0, 0, $ow, $oh)
$ms = New-Object System.IO.MemoryStream
$out.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
"$($screen.Width) $($screen.Height)"
[Convert]::ToBase64String($ms.ToArray())`,
      40000,
    )
    const [dims, data] = out.trim().split(/\r?\n/)
    const [w, h] = dims.trim().split(/\s+/).map(Number)
    return { png: Buffer.from(data.trim(), 'base64'), screen: { w, h } }
  },
  async click(x, y, button, count) {
    const [down, up] = WIN_BUTTON[button]
    let s = `MoveTo ${x} ${y}\n`
    for (let i = 0; i < count; i++) s += `Mouse ${down}; Mouse ${up}; Start-Sleep -Milliseconds 70\n`
    await ps(s)
  },
  async move(x, y) {
    await ps(`MoveTo ${x} ${y}`)
  },
  async drag(x1, y1, x2, y2) {
    let s = `MoveTo ${x1} ${y1}\nMouse 0x02\nStart-Sleep -Milliseconds 100\n`
    for (let i = 1; i <= 10; i++) s += `MoveTo ${Math.round(x1 + ((x2 - x1) * i) / 10)} ${Math.round(y1 + ((y2 - y1) * i) / 10)}\n`
    s += 'Mouse 0x04'
    await ps(s)
  },
  async scroll(x, y, dir, amount) {
    const pre = x != null ? `MoveTo ${x} ${y}\n` : ''
    const [flag, sign] = { up: [0x0800, 1], down: [0x0800, -1], left: [0x1000, -1], right: [0x1000, 1] }[dir]
    await ps(`${pre}Mouse ${flag} ${sign * 120 * amount}`)
  },
  async type(text) {
    // Paste through the clipboard so Chinese and symbols arrive intact; the old clipboard is put back.
    await ps(`$text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64(text)}'))
$old = $null
try { $old = Get-Clipboard -Raw -ErrorAction SilentlyContinue } catch {}
Set-Clipboard -Value $text
Start-Sleep -Milliseconds 80
KeyDown 0x11; KeyDown 0x56; KeyUp 0x56; KeyUp 0x11
Start-Sleep -Milliseconds 300
if ($null -ne $old) { Set-Clipboard -Value $old }`)
  },
  async key(keys) {
    const { mods, key } = parseKeys(keys)
    const vks = [...mods.map((m) => WIN_VK[m]), ...(key ? [winVk(key)] : [])]
    const x = (vk) => (WIN_EXTENDED.has(vk) ? 1 : 0)
    const s = [...vks.map((vk) => `KeyDown ${vk} ${x(vk)}`), 'Start-Sleep -Milliseconds 40', ...vks.reverse().map((vk) => `KeyUp ${vk} ${x(vk)}`)].join('\n')
    await ps(s)
  },
  async open(target) {
    await ps(`Start-Process -FilePath ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64(target)}')))`)
  },
}

const backend = { linux, darwin: mac, win32: win }[PLATFORM]

// ---- tools -------------------------------------------------------------------------------------

async function ensureScale() {
  if (scale) return scale
  const s = await backend.size()
  const pixelW = s.pixelW || s.w
  scale = s.w / Math.min(MAX_W, pixelW)
  return scale
}

async function point(a, xs = 'x', ys = 'y') {
  const k = await ensureScale()
  return [Math.round(num(a[xs], xs) * k), Math.round(num(a[ys], ys) * k)]
}

const text = (t) => ({ content: [{ type: 'text', text: t }] })

const TOOLS = [
  {
    name: 'screenshot',
    description: `截一张屏幕图，看看现在屏幕上是什么。其他工具的坐标都按这张截图的像素算。每次操作后都建议再截图确认结果。当前系统：${OS_ZH}。`,
    inputSchema: { type: 'object', properties: {} },
    async run() {
      const { png, screen } = await backend.screenshot()
      const { w, h } = pngSize(png)
      scale = screen.w / w
      return { content: [{ type: 'image', data: png.toString('base64'), mimeType: 'image/png' }, { type: 'text', text: `截图 ${w}×${h}（坐标按这张图算）` }] }
    },
  },
  {
    name: 'click',
    description: '在截图坐标 (x, y) 处点击鼠标。button 默认 left；双击把 double 设为 true。',
    inputSchema: {
      type: 'object',
      properties: { x: { type: 'number' }, y: { type: 'number' }, button: { type: 'string', enum: ['left', 'right', 'middle'] }, double: { type: 'boolean' } },
      required: ['x', 'y'],
    },
    async run(a) {
      const [x, y] = await point(a)
      const button = ['left', 'right', 'middle'].includes(a.button) ? a.button : 'left'
      await backend.click(x, y, button, a.double ? 2 : 1)
      return text(`已${a.double ? '双击' : button === 'right' ? '右键点击' : '点击'} (${a.x}, ${a.y})`)
    },
  },
  {
    name: 'move',
    description: '把鼠标移到截图坐标 (x, y)，不点击（比如为了显示悬停菜单）。',
    inputSchema: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] },
    async run(a) {
      const [x, y] = await point(a)
      await backend.move(x, y)
      return text(`鼠标已移到 (${a.x}, ${a.y})`)
    },
  },
  {
    name: 'drag',
    description: '按住左键从 (from_x, from_y) 拖到 (to_x, to_y)。',
    inputSchema: {
      type: 'object',
      properties: { from_x: { type: 'number' }, from_y: { type: 'number' }, to_x: { type: 'number' }, to_y: { type: 'number' } },
      required: ['from_x', 'from_y', 'to_x', 'to_y'],
    },
    async run(a) {
      const [x1, y1] = await point(a, 'from_x', 'from_y')
      const [x2, y2] = await point(a, 'to_x', 'to_y')
      await backend.drag(x1, y1, x2, y2)
      return text(`已从 (${a.from_x}, ${a.from_y}) 拖到 (${a.to_x}, ${a.to_y})`)
    },
  },
  {
    name: 'scroll',
    description: '滚动鼠标滚轮。可以先指定位置 (x, y)。amount 是滚几格，默认 3。',
    inputSchema: {
      type: 'object',
      properties: { direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] }, amount: { type: 'number' }, x: { type: 'number' }, y: { type: 'number' } },
      required: ['direction'],
    },
    async run(a) {
      const dir = ['up', 'down', 'left', 'right'].includes(a.direction) ? a.direction : 'down'
      const amount = Math.max(1, Math.min(30, Math.round(Number(a.amount) || 3)))
      const [x, y] = a.x != null && a.y != null ? await point(a) : [null, null]
      await backend.scroll(x, y, dir, amount)
      return text(`已向${{ up: '上', down: '下', left: '左', right: '右' }[dir]}滚动 ${amount} 格`)
    },
  },
  {
    name: 'type',
    description: '在当前输入焦点处输入一段文字（支持中文）。先点击输入框再用它。',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    async run(a) {
      const t = String(a.text ?? '')
      if (!t) throw new Error('text 不能为空')
      if (t.length > 4000) throw new Error('一次最多输入 4000 字，请分几次输入')
      await backend.type(t)
      return text(`已输入 ${t.length} 个字`)
    },
  },
  {
    name: 'key',
    description: `按一个键或组合键，用 + 连接，比如 enter、esc、tab、ctrl+s、alt+tab、ctrl+shift+t、f5${MOD_HINT}。`,
    inputSchema: { type: 'object', properties: { keys: { type: 'string' } }, required: ['keys'] },
    async run(a) {
      await backend.key(String(a.keys || ''))
      return text(`已按 ${a.keys}`)
    },
  },
  {
    name: 'open',
    description: '打开一个软件、文件或网址。软件写名字（比如 notepad、Excel、微信 的可执行名），文件写完整路径，网址写 https://…',
    inputSchema: { type: 'object', properties: { target: { type: 'string' } }, required: ['target'] },
    async run(a) {
      const t = String(a.target || '').trim()
      if (!t) throw new Error('target 不能为空')
      await backend.open(t)
      return text(`已打开 ${t}，稍等它启动后截图看看`)
    },
  },
  {
    name: 'wait',
    description: '等几秒（等软件启动、网页加载、动画结束）。',
    inputSchema: { type: 'object', properties: { seconds: { type: 'number' } }, required: ['seconds'] },
    async run(a) {
      const s = Math.max(0.1, Math.min(30, Number(a.seconds) || 1))
      await new Promise((r) => setTimeout(r, s * 1000))
      return text(`等了 ${s} 秒`)
    },
  },
]

// ---- MCP over stdio -----------------------------------------------------------------------------

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
}
function fail(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n')
}

async function handle(msg) {
  const { id, method, params } = msg
  if (id == null) return
  if (method === 'initialize') {
    return reply(id, {
      protocolVersion: params?.protocolVersion || '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'niuma-desktop', version: '0.1.0' },
      instructions: `控制这台 ${OS_ZH} 电脑的屏幕、鼠标和键盘。先 screenshot 看清楚，再点击或输入，每步之后再截图确认。`,
    })
  }
  if (method === 'ping') return reply(id, {})
  if (method === 'tools/list') return reply(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) })
  if (method === 'tools/call') {
    const tool = TOOLS.find((t) => t.name === params?.name)
    if (!tool) return fail(id, -32602, `没有叫 ${params?.name} 的工具`)
    if (!backend) return reply(id, { isError: true, content: [{ type: 'text', text: `暂不支持这个系统：${PLATFORM}` }] })
    try {
      return reply(id, await tool.run(params.arguments || {}))
    } catch (e) {
      return reply(id, { isError: true, content: [{ type: 'text', text: `出错了：${e.message}` }] })
    }
  }
  fail(id, -32601, `不支持的方法 ${method}`)
}

const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b)
const isMain = !!process.argv[1] && same(path.resolve(process.argv[1]), fileURLToPath(import.meta.url))
if (isMain) {
  let buf = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    buf += chunk
    let i
    while ((i = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line) continue
      let msg
      try {
        msg = JSON.parse(line)
      } catch {
        continue
      }
      handle(msg)
    }
  })
  process.stdin.on('end', () => process.exit(0))
}
