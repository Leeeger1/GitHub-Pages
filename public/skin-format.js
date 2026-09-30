/* 自制皮肤的文件格式：读文件（允许 // 注释和多余的逗号）、检查每一项、按一个主色自动配出一整套颜色。
   网页和服务器（src/skins.js）共用这一份，所以只用纯函数，挂在 globalThis.NiumaSkinFormat 上。
   皮肤里的颜色会写进 SVG 和 CSS，这里把每一项都卡死在「确实是颜色 / 图片 / 选项」的范围内，
   别人分享来的皮肤文件夹带不了代码。 */
;(function (root) {
  'use strict'

  const BUILTIN = ['sakura', 'night', 'neon', 'neko', 'pixel']
  const DARK_BASES = ['night', 'neon']

  // 界面颜色 → CSS 变量
  const COLOR_VARS = {
    bg: '--bg',
    panel: '--panel',
    panel2: '--panel-2',
    ink: '--ink',
    muted: '--muted',
    line: '--line',
    edge: '--edge',
    drop: '--drop',
    accent: '--accent',
    onAccent: '--on-accent',
    ok: '--ok',
    warn: '--warn',
    bad: '--bad',
  }
  const COLOR_KEYS = Object.keys(COLOR_VARS)

  // 办公室画面：数字表示要几个颜色（渐变），1 就是一个颜色
  const ROOM_COLORS = {
    wall: 2, wainscot: 1, trim: 1, floor: 2, floorLine: 1, sky: 3,
    desk: 1, deskTop: 1, deskEdge: 1, monitor: 1, monitorEdge: 1,
    table: 1, tableEdge: 1, rug: 1, frame: 1, frameEdge: 1, boss: 1, bossEdge: 1,
    ink: 1, plant: 2, pot: 1,
  }
  const ROOM_CHOICES = {
    window: ['sakura', 'city', 'cyber', 'garden', 'sea', 'sky', 'image'],
    particles: ['petals', 'snow', 'stars', 'bubbles', 'none'],
    wallPattern: ['paws', 'dots', 'stripes', 'grid', 'none'],
  }
  const ROOM_FLAGS = ['catEars', 'cat', 'lamps', 'neon']
  const IMAGE_KEYS = ['wall', 'window']
  const MAX_IMAGE_CHARS = 6 * 1024 * 1024

  const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
  const FUNC = /^(?:rgb|rgba|hsl|hsla)\(\s*[-+0-9.%\s,/deg]+\)$/i
  const NAMED = /^[a-z]{3,20}$/i
  const IMAGE = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/
  const ID = /^[\w一-鿿-]{1,40}$/
  const FONT = /^[\w\s一-鿿.-]{1,40}$/

  const isColor = (v) => typeof v === 'string' && (HEX.test(v.trim()) || FUNC.test(v.trim()) || NAMED.test(v.trim()))
  const text = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max)

  /** 读皮肤文件：普通 JSON，外加允许 // 和 /* *\/ 注释、结尾多余的逗号。 */
  function parse(src) {
    let s = String(src ?? '').replace(/^﻿/, '')
    let out = ''
    let inStr = false
    for (let i = 0; i < s.length; i++) {
      const c = s[i]
      if (inStr) {
        out += c
        if (c === '\\') out += s[++i] ?? ''
        else if (c === '"') inStr = false
        continue
      }
      if (c === '"') {
        inStr = true
        out += c
      } else if (c === '/' && s[i + 1] === '/') {
        while (i < s.length && s[i] !== '\n') i++
        out += '\n'
      } else if (c === '/' && s[i + 1] === '*') {
        const end = s.indexOf('*/', i + 2)
        i = end === -1 ? s.length : end + 1
      } else if (c === ',') {
        // 逗号后面（跳过空白和注释）紧跟 } 或 ] 就是多余的
        let j = i + 1
        for (;;) {
          while (j < s.length && /\s/.test(s[j])) j++
          if (s[j] === '/' && s[j + 1] === '/') while (j < s.length && s[j] !== '\n') j++
          else if (s[j] === '/' && s[j + 1] === '*') j = s.indexOf('*/', j + 2) === -1 ? s.length : s.indexOf('*/', j + 2) + 2
          else break
        }
        if (s[j] !== '}' && s[j] !== ']') out += c
      } else out += c
    }
    try {
      return JSON.parse(out)
    } catch (e) {
      throw new Error(`皮肤文件格式不对：${e.message}`)
    }
  }

  function toId(v) {
    let id = text(v, 40).replace(/\s+/g, '-').replace(/[^\w一-鿿-]/g, '')
    if (!ID.test(id)) return ''
    if (BUILTIN.includes(id)) id = `my-${id}`
    return id
  }

  /**
   * 检查并整理一份皮肤。写错的项跳过，记在 warnings 里；没写的项照 base 那套皮肤来。
   * @returns {{id,name,base,dark,author,font,colors,room,images,warnings:string[]}}
   */
  function normalize(raw, { id } = {}) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('皮肤文件里要是一个 { … } 对象')
    const warnings = []
    const base = BUILTIN.includes(raw.base) ? raw.base : 'sakura'
    if (raw.base != null && raw.base !== base) warnings.push(`base 只能是 ${BUILTIN.join(' / ')}，先按 sakura 算`)
    const name = text(raw.name, 24) || text(id, 24) || '我的皮肤'
    const skin = {
      id: toId(raw.id) || toId(id) || toId(name) || 'my-skin',
      name,
      base,
      dark: typeof raw.dark === 'boolean' ? raw.dark : DARK_BASES.includes(base),
      author: text(raw.author, 40),
      font: '',
      colors: {},
      room: {},
      images: {},
      warnings,
    }
    if (raw.font) {
      if (FONT.test(String(raw.font))) skin.font = String(raw.font).trim()
      else warnings.push('font 只能写字体名字')
    }
    const colors = raw.colors && typeof raw.colors === 'object' ? raw.colors : {}
    for (const k of COLOR_KEYS) {
      if (colors[k] == null || colors[k] === '') continue
      if (isColor(colors[k])) skin.colors[k] = colors[k].trim()
      else warnings.push(`colors.${k} 不是颜色：${text(colors[k], 30)}`)
    }
    const room = raw.room && typeof raw.room === 'object' ? raw.room : {}
    for (const [k, n] of Object.entries(ROOM_COLORS)) {
      const v = room[k]
      if (v == null || v === '') continue
      if (n === 1) {
        if (isColor(v)) skin.room[k] = v.trim()
        else warnings.push(`room.${k} 不是颜色：${text(v, 30)}`)
      } else if (Array.isArray(v) && v.length === n && v.every(isColor)) skin.room[k] = v.map((c) => c.trim())
      else if (isColor(v)) skin.room[k] = Array(n).fill(v.trim())
      else warnings.push(`room.${k} 要写 ${n} 个颜色，比如 [${Array(n).fill('"#ffffff"').join(', ')}]`)
    }
    for (const [k, list] of Object.entries(ROOM_CHOICES)) {
      if (room[k] == null || room[k] === '') continue
      if (list.includes(room[k])) skin.room[k] = room[k]
      else warnings.push(`room.${k} 只能是 ${list.join(' / ')}`)
    }
    for (const k of ROOM_FLAGS) if (typeof room[k] === 'boolean') skin.room[k] = room[k]
    const images = raw.images && typeof raw.images === 'object' ? raw.images : {}
    for (const k of IMAGE_KEYS) {
      const v = images[k]
      if (!v) continue
      if (typeof v === 'string' && v.length <= MAX_IMAGE_CHARS && IMAGE.test(v.replace(/\s+/g, ''))) skin.images[k] = v.replace(/\s+/g, '')
      else warnings.push(`images.${k} 用不了（只支持 png、jpg、gif、webp，不超过 4MB）`)
    }
    if (skin.room.window === 'image' && !skin.images.window) {
      delete skin.room.window
      warnings.push('room.window 写了 image，但 images.window 没有图片')
    }
    return skin
  }

  /** 这套皮肤要设置的 CSS 变量 */
  function cssVars(skin) {
    const out = {}
    for (const [k, v] of Object.entries(skin.colors || {})) if (COLOR_VARS[k]) out[COLOR_VARS[k]] = v
    return out
  }

  /** 存成文件时的样子（去掉内部字段；图片由调用方决定写成文件名还是 data URL） */
  function toFile(skin, images = skin.images) {
    const o = { name: skin.name, base: skin.base, dark: skin.dark }
    if (skin.author) o.author = skin.author
    if (skin.font) o.font = skin.font
    o.colors = { ...skin.colors }
    if (skin.base !== 'pixel') o.room = { ...skin.room }
    if (images && Object.keys(images).length) o.images = { ...images }
    return `// 牛马工作室皮肤「${skin.name}」。可以直接改这个文件，说明见 docs/skin-guide.md\n${JSON.stringify(o, null, 2)}\n`
  }

  // ---- 一个主色配一整套 -----------------------------------------------------------------

  function hexToRgb(hex) {
    let h = String(hex).replace('#', '')
    if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map((c) => c + c).join('')
    const n = parseInt(h.slice(0, 6), 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }

  function rgbToHsl([r, g, b]) {
    r /= 255
    g /= 255
    b /= 255
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const l = (max + min) / 2
    if (max === min) return [0, 0, l * 100]
    const d = max - min
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    return [h * 60, s * 100, l * 100]
  }

  function hsl(h, s, l) {
    h = ((h % 360) + 360) % 360
    s = Math.max(0, Math.min(100, s)) / 100
    l = Math.max(0, Math.min(100, l)) / 100
    const a = s * Math.min(l, 1 - l)
    const f = (n) => {
      const k = (n + h / 30) % 12
      const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
      return Math.round(c * 255).toString(16).padStart(2, '0')
    }
    return `#${f(0)}${f(8)}${f(4)}`
  }

  /** 只给一个主色，配出界面和办公室的全部颜色。dark = 深色皮肤。 */
  function paletteFrom(accent, dark = false) {
    const [h, s0, l0] = rgbToHsl(hexToRgb(isColor(accent) && HEX.test(accent) ? accent : '#ff5fa2'))
    const s = Math.max(s0, 35)
    const [r, g, b] = hexToRgb(accent)
    if (!dark) {
      const acc = hsl(h, s, Math.min(l0, 58))
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
      return {
        colors: {
          bg: hsl(h, 60, 97), panel: '#ffffff', panel2: hsl(h, 70, 95), ink: hsl(h, 25, 24), muted: hsl(h, 15, 50),
          line: hsl(h, 50, 89), edge: hsl(h, 55, 82), drop: `rgba(${r}, ${g}, ${b}, 0.16)`, accent: acc,
          onAccent: lum > 0.7 ? hsl(h, 40, 15) : '#ffffff',
        },
        room: {
          wall: [hsl(h, 70, 98), hsl(h, 60, 93)], wainscot: hsl(h, 55, 88), trim: hsl(h, 50, 76),
          floor: [hsl(32, 60, 88), hsl(30, 52, 82)], floorLine: hsl(28, 45, 72), sky: [hsl(205, 90, 74), hsl(200, 90, 88), hsl(h, 80, 96)],
          desk: hsl(30, 60, 91), deskTop: hsl(30, 100, 97), deskEdge: hsl(28, 40, 73), monitor: hsl(h, 40, 97), monitorEdge: hsl(h, 20, 82),
          table: hsl(30, 100, 98), tableEdge: hsl(28, 40, 78), rug: hsl(h, 80, 90), frame: '#ffffff', frameEdge: hsl(h, 55, 80),
          boss: hsl(h, 85, 90), bossEdge: acc, ink: hsl(h, 20, 35), plant: ['#5fbf7f', '#3f9c5f'], pot: hsl(h + 20, 70, 75),
        },
      }
    }
    const acc = hsl(h, s, Math.max(l0, 68))
    return {
      colors: {
        bg: hsl(h, 35, 11), panel: hsl(h, 30, 16), panel2: hsl(h, 30, 20), ink: hsl(h, 60, 94), muted: hsl(h, 25, 72),
        line: hsl(h, 30, 27), edge: hsl(h, 35, 40), drop: 'rgba(0, 0, 0, 0.35)', accent: acc, onAccent: hsl(h, 40, 14),
      },
      room: {
        wall: [hsl(h, 40, 17), hsl(h, 38, 23)], wainscot: hsl(h, 38, 19), trim: hsl(h, 40, 40),
        floor: [hsl(h, 25, 26), hsl(h, 25, 21)], floorLine: hsl(h, 25, 16), sky: [hsl(h, 70, 8), hsl(h, 55, 22), hsl(h, 45, 38)],
        desk: hsl(h, 20, 36), deskTop: hsl(h, 20, 45), deskEdge: hsl(h, 25, 24), monitor: hsl(h, 28, 26), monitorEdge: hsl(h, 35, 14),
        table: hsl(h, 20, 34), tableEdge: hsl(h, 25, 22), rug: hsl(h, 35, 30), frame: hsl(h, 30, 32), frameEdge: hsl(h, 40, 15),
        boss: hsl(h, 30, 38), bossEdge: acc, ink: hsl(h, 60, 93), plant: ['#3f8a63', '#2c6a4a'], pot: hsl(h, 30, 45),
      },
    }
  }

  root.NiumaSkinFormat = {
    BUILTIN,
    COLOR_VARS,
    COLOR_KEYS,
    ROOM_COLORS,
    ROOM_CHOICES,
    ROOM_FLAGS,
    IMAGE_KEYS,
    isColor,
    toId,
    parse,
    normalize,
    cssVars,
    toFile,
    paletteFrom,
    hsl,
  }
})(globalThis)
