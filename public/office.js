/* Pixel office: draws Mavis, Claude and Codex at their desks on a 320×180 canvas.
   Everything is procedural fillRect art, so there are no image assets to ship. */
;(function () {
  'use strict'

  const W = 320
  const H = 180
  const FLOOR_Y = 118
  const DESK_TOP = 132
  const FEET = 177
  const SEATS = { claude: 64, mavis: 160, codex: 256 }

  // 3×5 pixel font for signs, nameplates and floating code glyphs.
  const GLYPHS = {
    A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110',
    E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101',
    I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
    M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100',
    Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
    U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
    Y: '101101010010010', Z: '111001010100111',
    0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
    4: '101101111001001', 5: '111100110001110', 6: '011100111101111', 7: '111001010010010',
    8: '111101111101111', 9: '111101111001110',
    '{': '011010110010011', '}': '110010011010110', '<': '001010100010001', '>': '100010001010100',
    '/': '001001010100100', ';': '000010000010100', '*': '000101010101000', '+': '000010111010000',
    '!': '010010010000010', '?': '110001010000010', '.': '000000000000010', '-': '000000111000000',
    ':': '000010000010000', '=': '000111000111000', '(': '010100100100010', ')': '010001001001010',
    ' ': '000000000000000',
  }
  const CODE_GLYPHS = ['{', '}', '<', '>', '/', ';', '=', '(', ')', '*', '0', '1']

  const PAL = {
    day: {
      wall: '#c9d1e5', wainscot: '#b3bdd6', trim: '#8790b0', floor: '#c49b6c', floorLine: '#aa8155', seam: '#b58c5f',
      sky: ['#86bff0', '#a9d4f6', '#d4ebfb'], cloud: '#ffffff', city: '#8a9ec0', cityWin: '#dbe6f4',
      frame: '#f3f5fa', frameShade: '#c3c9dc', desk: '#a4774e', deskTop: '#c7976a', deskEdge: '#85603c',
      mDesk: '#3b3765', mDeskTop: '#55508a', mDeskEdge: '#2a274c', chair: '#394060', chairHi: '#4d5579',
      board: '#fbfcfe', boardFrame: '#99a2ba', boardInk: '#79809a', boardLine: '#e1e5ef',
      plate: '#f0e2c0', plateInk: '#4a3a24', mPlate: '#e7b84a', kbd: '#565d78', kbdHi: '#737a96',
      rug: '#7d78d8', rugEdge: '#6660c4', shade: 'rgba(20,20,40,0.18)', signPlate: '#232046', sign: '#7069ee',
      clock: '#fdfdfd', clockRim: '#5a6180', plant: ['#3f9c5c', '#2f7d48', '#5bbd77'], pot: '#bc6a4b', potRim: '#d27d5d',
      cooler: '#e6eaf2', coolerShade: '#c4cad9', water: '#9fd4f3', glow: 0,
    },
    night: {
      wall: '#2a2c4a', wainscot: '#23253f', trim: '#1a1c31', floor: '#4a3a30', floorLine: '#3d3028', seam: '#44352c',
      sky: ['#0d1230', '#141a40', '#1f2656'], cloud: '#262c58', city: '#161b36', cityWin: '#f6d88a',
      frame: '#3a3d5f', frameShade: '#292b46', desk: '#654a33', deskTop: '#7c5d3e', deskEdge: '#4d3826',
      mDesk: '#27244a', mDeskTop: '#39356b', mDeskEdge: '#1b1936', chair: '#20233a', chairHi: '#2d314d',
      board: '#d6d9e6', boardFrame: '#565d78', boardInk: '#5e6480', boardLine: '#c3c7d6',
      plate: '#b9a784', plateInk: '#2f2517', mPlate: '#c99a35', kbd: '#3a3f55', kbdHi: '#4f556e',
      rug: '#3a3674', rugEdge: '#2f2b61', shade: 'rgba(0,0,0,0.3)', signPlate: '#15132c', sign: '#aaa5ff',
      clock: '#d9dbe6', clockRim: '#2c3049', plant: ['#2c6d43', '#215535', '#3f8a58'], pot: '#8a4d37', potRim: '#9d5a42',
      cooler: '#9ba2b6', coolerShade: '#7a8197', water: '#4d7ea3', glow: 1,
    },
  }

  const LOOKS = {
    claude: {
      skin: '#f1c7a1', skinShade: '#d9a47e', hair: '#7b3f24', hairHi: '#a15a37',
      shirt: '#d2693f', shirtShade: '#ad522d', accent: '#ffe6c4', note: '#f3a57f', noteTape: '#d2693f',
    },
    codex: {
      skin: '#e3b68c', skinShade: '#c99870', hair: '#1c202e', hairHi: '#3a4058',
      shirt: '#1f8c80', shirtShade: '#166a61', accent: '#8ff0e2', phones: '#2a2e3e', note: '#79d8cb', noteTape: '#1f8c80',
    },
    mavis: {
      skin: '#f3d2bb', skinShade: '#dcb298', hair: '#c9c3ef', hairHi: '#e7e4fb',
      shirt: '#2a2d55', shirtShade: '#1d1f40', accent: '#7e78f2', accentDark: '#5750c9', collar: '#f5f5fb', gold: '#e8b84a',
    },
  }

  const STATUS_LED = { idle: '#8b93ad', thinking: '#e8b84a', working: '#5ce08a', walking: '#5ce08a', done: '#6fb6ff', error: '#ff5a5a', offline: '#40445a' }

  function hash(n) {
    n = (n ^ 61) ^ (n >>> 16)
    n = n + (n << 3)
    n = n ^ (n >>> 4)
    n = Math.imul(n, 0x27d4eb2d)
    return (n ^ (n >>> 15)) >>> 0
  }

  function isDark() {
    const t = document.documentElement.getAttribute('data-theme')
    if (t === 'dark') return true
    if (t === 'light') return false
    return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches
  }

  const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches

  class Office {
    constructor(canvas, overlay) {
      this.canvas = canvas
      this.ctx = canvas.getContext('2d')
      this.overlay = overlay
      this.st = {}
      for (const id of ['claude', 'mavis', 'codex']) {
        this.st[id] = { status: id === 'mavis' ? 'idle' : 'offline', available: id === 'mavis', since: 0, doneAt: -99, paper: false }
      }
      this.tasks = []
      this.particles = []
      this.walkQueue = []
      this.walk = null
      this.flying = null
      this.bubbles = {}
      for (const id of ['claude', 'mavis', 'codex']) {
        const el = document.createElement('div')
        el.className = 'speech hide'
        el.dataset.id = id
        overlay.appendChild(el)
        this.bubbles[id] = { el, text: '', until: 0, kind: '' }
      }
      this.lastSpawn = {}
      this.t0 = performance.now()
      const loop = () => {
        if (!document.hidden) this.draw((performance.now() - this.t0) / 1000)
        requestAnimationFrame(loop)
      }
      requestAnimationFrame(loop)
    }

    // ---- public API ------------------------------------------------------

    setAgent(id, info) {
      const s = this.st[id]
      if (!s) return
      const t = this.now()
      const prev = s.status
      if (info.available !== undefined) s.available = !!info.available
      if (info.status && info.status !== prev) {
        s.status = info.status
        s.since = t
        if (info.status === 'done') {
          s.doneAt = t
          s.paper = false
        }
        if (info.status === 'error' || info.status === 'idle') s.paper = false
      }
      if (id === 'mavis' && info.status === 'walking') return
      if (s.status === 'thinking') this.say(id, '···', { kind: 'think', ttl: Infinity })
      else if (s.status === 'working') this.say(id, info.text || '开工', { ttl: Infinity })
      else if (s.status === 'done') this.say(id, info.text || '搞定！', { kind: 'ok', ttl: 3500 })
      else if (s.status === 'error') this.say(id, info.text || '出错了', { kind: 'warn', ttl: 6000 })
      else if (s.status === 'offline') this.say(id, info.text || '不在岗', { kind: 'warn', ttl: Infinity })
      else if (prev === 'thinking' || prev === 'working' || prev === 'offline') this.say(id, '', { ttl: 0 })
    }

    activity(id, text) {
      if (this.st[id] && this.st[id].status === 'working') this.say(id, text, { ttl: Infinity })
    }

    say(id, text, { kind = '', ttl = 6000 } = {}) {
      const b = this.bubbles[id]
      if (!b) return
      b.text = text || ''
      b.kind = kind
      b.until = text ? this.now() + ttl / 1000 : 0
      b.el.textContent = b.text
      b.el.className = 'speech' + (kind ? ' ' + kind : '') + (text ? '' : ' hide')
    }

    dispatch(to) {
      if (!SEATS[to]) return
      this.walkQueue.push(to)
      if (!this.walk) this.nextWalk()
    }

    setTasks(tasks) {
      this.tasks = tasks.map((t) => ({ agent: t.agent, status: t.status, kind: t.kind }))
    }

    now() {
      return (performance.now() - this.t0) / 1000
    }

    /** A 16×16 head-and-shoulders portrait as a data: URL, for chat avatars and the crew roster. */
    portrait(id) {
      const c = document.createElement('canvas')
      c.width = 16
      c.height = 16
      const saved = this.ctx
      this.ctx = c.getContext('2d')
      this.torsoAt(id, 8, 14, 16)
      this.headAt(id, 8, 3, { status: 'idle', doneAt: -99 }, 0.5)
      this.ctx = saved
      return c.toDataURL()
    }

    // ---- walking hand-off -------------------------------------------------

    nextWalk() {
      const to = this.walkQueue.shift()
      if (!to) {
        this.walk = null
        return
      }
      const target = SEATS[to] + (to === 'claude' ? 16 : -16)
      this.walk = { to, x: SEATS.mavis, target, phase: 'go', t: this.now() }
      this.say('mavis', '', { ttl: 0 })
    }

    stepWalk(t, dt) {
      const w = this.walk
      if (!w) return
      const speed = reduceMotion() ? 1000 : 78
      if (w.phase === 'go' || w.phase === 'back') {
        const goal = w.phase === 'go' ? w.target : SEATS.mavis
        const d = goal - w.x
        const step = Math.sign(d) * Math.min(Math.abs(d), speed * dt)
        w.x += step
        w.facing = Math.sign(d) || w.facing || 1
        if (Math.abs(goal - w.x) < 0.5) {
          w.x = goal
          if (w.phase === 'go') {
            w.phase = 'give'
            w.t = t
            this.flying = { from: [w.x + w.facing * 6, FEET - 15], to: [SEATS[w.to] + 6, DESK_TOP - 1], t, id: w.to }
          } else {
            this.nextWalk()
          }
        }
      } else if (w.phase === 'give' && !w.said) {
        w.said = true
        this.say('mavis', `${w.to === 'claude' ? 'Claude' : 'Codex'}，交给你了`, { ttl: 1400 })
      } else if (w.phase === 'give' && t - w.t > 0.6) {
        w.phase = 'back'
        w.t = t
      }
      if (this.flying && t - this.flying.t > 0.45) {
        this.st[this.flying.id].paper = true
        this.flying = null
      }
    }

    // ---- drawing ------------------------------------------------------------

    draw(t) {
      const ctx = this.ctx
      const dt = Math.min(0.1, t - (this.lastT || t))
      this.lastT = t
      const P = isDark() ? PAL.night : PAL.day
      this.P = P
      this.t = t
      ctx.imageSmoothingEnabled = false
      this.stepWalk(t, dt)

      this.drawRoom(P, t)
      for (const id of ['claude', 'codex', 'mavis']) this.drawStation(id, P, t)
      if (this.walk) this.drawWalker(this.walk, t)
      if (this.flying) this.drawFlyingPaper(t)
      this.drawParticles(t, dt)
      if (P.glow) this.drawNightTint()
      this.placeBubbles(t)
    }

    R(x, y, w, h, c) {
      this.ctx.fillStyle = c
      this.ctx.fillRect(x | 0, y | 0, w | 0, h | 0)
    }

    text(str, x, y, color, scale = 1) {
      const ctx = this.ctx
      ctx.fillStyle = color
      let cx = x
      for (const ch of String(str).toUpperCase()) {
        const g = GLYPHS[ch] || GLYPHS[' ']
        for (let i = 0; i < 15; i++) if (g[i] === '1') ctx.fillRect(cx + (i % 3) * scale, y + ((i / 3) | 0) * scale, scale, scale)
        cx += 4 * scale
      }
    }

    drawRoom(P, t) {
      const R = this.R.bind(this)
      R(0, 0, W, FLOOR_Y, P.wall)
      R(0, 94, W, FLOOR_Y - 94, P.wainscot)
      R(0, 93, W, 1, P.trim)
      for (let x = 20; x < W; x += 40) R(x, 95, 1, FLOOR_Y - 97, P.trim)
      R(0, FLOOR_Y - 2, W, 2, P.trim)

      // floor planks
      R(0, FLOOR_Y, W, H - FLOOR_Y, P.floor)
      for (let y = FLOOR_Y + 7, row = 0; y < H; y += 7, row++) {
        R(0, y, W, 1, P.floorLine)
        for (let x = (row * 37) % 64; x < W; x += 64) R(x, y - 6, 1, 6, P.seam)
      }
      // rug in front of Mavis
      R(118, 163, 84, 13, P.rugEdge)
      R(120, 164, 80, 11, P.rug)
      for (let x = 120; x < 200; x += 3) {
        R(x, 162, 1, 1, P.rugEdge)
        R(x, 176, 1, 1, P.rugEdge)
      }

      this.drawWindow(P, t, 14, 12, 72, 50)
      this.drawClock(P, 113, 35)
      this.drawSign(P, t)
      this.drawShelf(P)
      this.drawBoard(P, t, 219, 10, 90, 58)
      this.drawPlant(P, 6, t)
      this.drawCooler(P, 300)
    }

    drawWindow(P, t, x, y, w, h) {
      const R = this.R.bind(this)
      const ctx = this.ctx
      R(x - 3, y - 3, w + 6, h + 6, P.frame)
      R(x - 3, y + h + 2, w + 6, 1, P.frameShade)
      const band = Math.round(h * 0.42)
      R(x, y, w, band, P.sky[0])
      R(x, y + band, w, Math.round(h * 0.3), P.sky[1])
      R(x, y + band + Math.round(h * 0.3), w, h - band - Math.round(h * 0.3), P.sky[2])
      ctx.save()
      ctx.beginPath()
      ctx.rect(x, y, w, h)
      ctx.clip()
      if (P.glow) {
        // moon + stars
        R(x + w - 18, y + 6, 7, 7, '#f4f1d0')
        R(x + w - 19, y + 7, 9, 5, '#f4f1d0')
        R(x + w - 15, y + 5, 7, 7, P.sky[0])
        for (let i = 0; i < 18; i++) {
          const hx = hash(i * 7 + 3)
          const sx = x + (hx % w)
          const sy = y + ((hx >> 8) % (h - 20))
          if (Math.sin(t * 1.7 + i * 2.3) > -0.4) R(sx, sy, 1, 1, i % 5 ? '#c9cff5' : '#ffffff')
        }
      } else {
        R(x + 8, y + 7, 7, 7, '#fff4c4')
        R(x + 7, y + 8, 9, 5, '#fff4c4')
        for (let i = 0; i < 3; i++) {
          const span = w + 34
          const cx = x - 17 + ((t * (2 + i) + i * 31) % span)
          const cy = y + 8 + i * 9
          R(cx, cy, 14, 3, P.cloud)
          R(cx + 3, cy - 2, 7, 2, P.cloud)
        }
      }
      // skyline
      const blds = [[0, 10, 16], [11, 8, 25], [20, 12, 13], [33, 9, 30], [43, 14, 19], [58, 7, 23], [66, 7, 15]]
      for (const [bx, bw, bh] of blds) {
        R(x + bx, y + h - bh, bw, bh, P.city)
        for (let wy = y + h - bh + 3; wy < y + h - 2; wy += 4) {
          for (let wx = x + bx + 2; wx < x + bx + bw - 2; wx += 3) {
            const on = hash(wx * 31 + wy * 17 + ((t / 7) | 0) * (wx % 3 === 0 ? 1 : 0)) % 3 === 0
            if (on) R(wx, wy, 1, 2, P.cityWin)
          }
        }
      }
      ctx.restore()
      R(x + w / 2 - 1, y, 2, h, P.frame)
      R(x, y + band, w, 1, P.frame)
    }

    drawClock(P, cx, cy) {
      const r = 9
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const d = dx * dx + dy * dy
          if (d <= r * r) this.R(cx + dx, cy + dy, 1, 1, d >= (r - 1.3) * (r - 1.3) ? P.clockRim : P.clock)
        }
      }
      for (let i = 0; i < 12; i += 3) {
        const a = (i / 12) * Math.PI * 2
        this.R(cx + Math.round(Math.sin(a) * 6), cy - Math.round(Math.cos(a) * 6), 1, 1, P.clockRim)
      }
      const now = new Date()
      const hand = (angle, len, color) => {
        for (let s = 0; s <= len; s += 0.5) this.R(cx + Math.round(Math.sin(angle) * s), cy - Math.round(Math.cos(angle) * s), 1, 1, color)
      }
      hand(((now.getHours() % 12) + now.getMinutes() / 60) * (Math.PI / 6), 4, '#1b1a2c')
      hand((now.getMinutes() + now.getSeconds() / 60) * (Math.PI / 30), 6, '#1b1a2c')
      hand(now.getSeconds() * (Math.PI / 30), 7, '#d2693f')
    }

    drawSign(P, t) {
      const x = 139
      const y = 11
      this.R(x - 2, y - 2, 46, 17, P.trim)
      this.R(x - 1, y - 1, 44, 15, P.signPlate)
      const busy = ['claude', 'codex'].some((id) => this.st[id].status === 'working')
      const flicker = P.glow && hash((t * 8) | 0) % 23 === 0
      const color = flicker ? '#4a4690' : P.sign
      if (P.glow && !flicker) {
        this.ctx.globalAlpha = 0.35
        this.text('MAVIS', x + 2, y + 2, color, 2)
        this.text('MAVIS', x + 4, y + 4, color, 2)
        this.ctx.globalAlpha = 1
      }
      this.text('MAVIS', x + 3, y + 3, color, 2)
      // "on air" light when anyone is working
      this.R(x + 42, y - 1, 3, 3, busy && Math.sin(t * 6) > 0 ? '#ff5a5a' : '#5a2a35')
    }

    drawShelf(P) {
      const x = 190
      const y = 48
      this.R(x, y, 24, 2, P.deskEdge)
      const books = [[0, 9, LOOKS.claude.shirt], [3, 11, LOOKS.mavis.accent], [6, 8, LOOKS.codex.shirt], [9, 10, '#e8b84a'], [12, 7, '#8a92b0']]
      for (const [bx, bh, c] of books) this.R(x + 1 + bx, y - bh, 3, bh, c)
      this.R(x + 17, y - 4, 5, 4, P.pot)
      this.R(x + 18, y - 9, 3, 5, P.plant[0])
      this.R(x + 17, y - 7, 1, 2, P.plant[2])
      this.R(x + 21, y - 8, 1, 2, P.plant[2])
    }

    drawBoard(P, t, x, y, w, h) {
      const R = this.R.bind(this)
      R(x - 2, y - 2, w + 4, h + 4, P.boardFrame)
      R(x, y, w, h, P.board)
      R(x + 10, y + h + 2, 22, 2, P.boardFrame)
      const cols = [['TODO', ['pending']], ['DOING', ['running']], ['DONE', ['done', 'failed', 'skipped', 'cancelled']]]
      const cw = w / 3
      cols.forEach(([label, states], ci) => {
        const cx = x + ci * cw
        this.text(label, cx + Math.round((cw - (label.length * 4 - 1)) / 2), y + 3, P.boardInk)
        if (ci) R(cx, y + 10, 1, h - 13, P.boardLine)
        const notes = this.tasks.filter((tk) => states.includes(tk.status)).slice(0, 15)
        notes.forEach((tk, i) => {
          const look = LOOKS[tk.agent] || LOOKS.claude
          const nx = cx + 3 + (i % 3) * 9
          const wiggle = tk.status === 'running' && Math.sin(t * 5 + i) > 0.6 ? -1 : 0
          const ny = y + 12 + Math.floor(i / 3) * 9 + wiggle
          R(nx, ny, 7, 7, look.note)
          R(nx, ny, 7, 1, look.noteTape)
          if (tk.kind === 'review') R(nx + 2, ny + 3, 3, 1, look.noteTape)
          else R(nx + 1, ny + 3, 5, 1, 'rgba(0,0,0,0.18)')
          if (tk.status === 'failed') R(nx + 5, ny + 5, 2, 2, '#e5484d')
        })
      })
      if (!this.tasks.length) this.text('READY', x + w / 2 - 9, y + h / 2 + 2, P.boardLine)
    }

    drawPlant(P, x) {
      const R = this.R.bind(this)
      R(x, 150, 14, 12, P.pot)
      R(x - 1, 148, 16, 3, P.potRim)
      const [a, b, c] = P.plant
      R(x + 6, 124, 2, 24, b)
      R(x + 1, 128, 6, 3, a)
      R(x + 8, 132, 7, 3, a)
      R(x, 136, 7, 3, c)
      R(x + 8, 124, 5, 3, c)
      R(x + 3, 120, 4, 3, a)
      R(x + 9, 140, 6, 3, b)
    }

    drawCooler(P, x) {
      const R = this.R.bind(this)
      R(x + 3, 108, 10, 13, P.water)
      R(x + 5, 106, 6, 2, P.water)
      R(x + 4, 110, 2, 8, 'rgba(255,255,255,0.35)')
      R(x, 121, 16, 40, P.cooler)
      R(x + 14, 121, 2, 40, P.coolerShade)
      R(x + 5, 128, 6, 3, '#4a88c9')
      R(x + 5, 132, 2, 2, '#e5484d')
    }

    drawStation(id, P, t) {
      const s = this.st[id]
      const cx = SEATS[id]
      const mavis = id === 'mavis'
      const half = mavis ? 38 : 31
      const present = s.available && !(mavis && this.walk)
      const R = this.R.bind(this)

      // chair back
      R(cx - 9, DESK_TOP - 27, 18, 27, P.chair)
      R(cx - 8, DESK_TOP - 28, 16, 1, P.chair)
      R(cx - 8, DESK_TOP - 27, 16, 1, P.chairHi)
      if (present) this.drawSitter(id, cx, s, t)

      // desk
      const top = mavis ? P.mDeskTop : P.deskTop
      const body = mavis ? P.mDesk : P.desk
      const edge = mavis ? P.mDeskEdge : P.deskEdge
      this.ctx.fillStyle = P.shade
      this.ctx.fillRect(cx - half, DESK_TOP + 29, half * 2, 3)
      R(cx - half, DESK_TOP, half * 2, 4, top)
      R(cx - half, DESK_TOP + 3, half * 2, 1, edge)
      R(cx - half + 1, DESK_TOP + 4, half * 2 - 2, 25, body)
      R(cx - half + 1, DESK_TOP + 4, 2, 25, edge)
      R(cx + half - 3, DESK_TOP + 4, 2, 25, edge)
      R(cx - half + 1, DESK_TOP + 28, half * 2 - 2, 1, edge)
      if (mavis) R(cx - half + 4, DESK_TOP + 6, half * 2 - 8, 1, LOOKS.mavis.accentDark)

      // nameplate
      const name = id.toUpperCase()
      const tw = name.length * 4 - 1
      R(cx - tw / 2 - 3, DESK_TOP + 11, tw + 6, 9, mavis ? P.mPlate : P.plate)
      this.text(name, Math.round(cx - tw / 2), DESK_TOP + 13, P.plateInk)

      // status LED
      const led = STATUS_LED[s.available ? s.status : 'offline'] || STATUS_LED.idle
      const blink = (s.status === 'working' || s.status === 'thinking') && Math.sin(t * 8) < 0
      R(cx + half - 8, DESK_TOP + 8, 3, 2, blink ? '#23402e' : led)

      // monitors
      const mons = mavis ? [cx - 25, cx + 25] : id === 'claude' ? [cx - 19] : [cx + 19]
      mons.forEach((mx, i) => this.drawMonitor(id, mx, s, t, i))

      // keyboard, mug, paper
      R(cx - 7, DESK_TOP, 14, 2, P.kbd)
      R(cx - 6, DESK_TOP, 12, 1, P.kbdHi)
      const mugX = mavis ? cx + 9 : id === 'claude' ? cx + 15 : cx - 19
      this.drawMug(id, mugX, t, s)
      if (s.paper) {
        R(cx + (id === 'codex' ? -14 : 9), DESK_TOP, 6, 3, '#fbfbf6')
        R(cx + (id === 'codex' ? -13 : 10), DESK_TOP + 1, 4, 1, '#b9bccb')
      }
      if (present) this.drawHands(id, cx, s, t)
      if (!s.available) {
        R(mons[0] - 5, DESK_TOP - 16, 11, 8, '#f7e27a')
        this.text('OFF', mons[0] - 4, DESK_TOP - 14, '#6b5a12')
      }
      if (present && s.status === 'working') this.spawnCode(id, mons[0], t)
    }

    drawMug(id, x, t, s) {
      const R = this.R.bind(this)
      if (id === 'mavis') {
        R(x, DESK_TOP - 1, 7, 1, '#e6e7f0')
        R(x + 1, DESK_TOP - 4, 5, 3, '#f5f5fb')
        R(x + 6, DESK_TOP - 3, 1, 1, '#f5f5fb')
        R(x + 1, DESK_TOP - 4, 5, 1, LOOKS.mavis.gold)
      } else {
        const c = id === 'claude' ? '#f5efe6' : '#2e3346'
        R(x, DESK_TOP - 5, 4, 5, c)
        R(x + 4, DESK_TOP - 4, 1, 2, c)
        R(x, DESK_TOP - 5, 4, 1, id === 'claude' ? '#6b3b21' : '#8ff0e2')
      }
      if (s.status === 'idle' && !reduceMotion()) {
        const k = (t * 5) % 6
        this.ctx.globalAlpha = 0.5 * (1 - k / 6)
        R(x + 1 + (Math.sin(t * 3) > 0 ? 1 : 0), DESK_TOP - 7 - k, 1, 2, '#ffffff')
        this.ctx.globalAlpha = 1
      }
    }

    drawMonitor(id, mx, s, t, idx) {
      const R = this.R.bind(this)
      const sw = 20
      const sh = 14
      const sx = mx - sw / 2
      const sy = DESK_TOP - 20
      const on = s.available
      const status = s.status
      const celebrating = status === 'done' && t - s.doneAt < 3
      let bg = '#161b2d'
      if (!on) bg = '#0d101b'
      else if (celebrating) bg = '#123a26'
      else if (status === 'error') bg = '#3a1216'

      if (this.P.glow && on) {
        this.ctx.globalAlpha = 0.14
        R(sx - 7, sy - 5, sw + 14, sh + 12, status === 'error' ? '#ff5a5a' : celebrating ? '#5ce08a' : '#8fb7ff')
        this.ctx.globalAlpha = 1
      }
      R(sx - 1, sy - 1, sw + 2, sh + 2, '#262b40')
      R(sx, sy, sw, sh, bg)
      R(mx - 1, sy + sh + 1, 2, 4, '#262b40')
      R(mx - 4, DESK_TOP - 1, 8, 1, '#262b40')
      if (!on) return

      const look = LOOKS[id]
      const ink = ['#e6e6f0', look.accent, '#8bd5ff', '#f7c873', '#c3a6ff']
      if (celebrating) {
        const c = '#5ce08a'
        R(mx - 5, sy + 7, 2, 2, c)
        R(mx - 3, sy + 9, 2, 2, c)
        R(mx - 1, sy + 7, 2, 2, c)
        R(mx + 1, sy + 5, 2, 2, c)
        R(mx + 3, sy + 3, 2, 2, c)
      } else if (status === 'error') {
        for (let i = 0; i < 7; i++) {
          R(mx - 4 + i, sy + 3 + i, 2, 1, '#ff6b6b')
          R(mx + 2 - i, sy + 3 + i, 2, 1, '#ff6b6b')
        }
      } else if (status === 'working' || (id === 'mavis' && this.anyWorking())) {
        const scroll = Math.floor(t * (id === 'mavis' ? 3 : 7))
        for (let i = 0; i < 6; i++) {
          const hv = hash((i + scroll) * 131 + mx * 7 + idx)
          const indent = (hv % 3) * 2
          const len = 3 + ((hv >> 3) % 12)
          R(sx + 2 + indent, sy + 2 + i * 2, Math.min(len, sw - 4 - indent), 1, ink[(hv >> 7) % ink.length])
        }
        if (Math.sin(t * 9) > 0) R(sx + 2, sy + 12, 2, 1, '#ffffff')
      } else if (status === 'thinking') {
        for (let i = 0; i < 3; i++) {
          const up = Math.floor(t * 4) % 3 === i ? -1 : 0
          R(mx - 5 + i * 4, sy + 7 + up, 2, 2, look.accent || '#ffffff')
        }
      } else {
        // screensaver: a bouncing pixel in the owner's colour
        const tri = (v, n) => {
          const m = v % (2 * n)
          return m < n ? m : 2 * n - m
        }
        const px = sx + 1 + tri(Math.floor(t * 6 + idx * 5), sw - 4)
        const py = sy + 1 + tri(Math.floor(t * 4 + idx * 3), sh - 4)
        R(px, py, 2, 2, id === 'mavis' ? look.accent : look.shirt)
      }
    }

    anyWorking() {
      return this.st.claude.status === 'working' || this.st.codex.status === 'working'
    }

    headAt(id, cx, headTop, s, t, opts = {}) {
      const L = LOOKS[id]
      const R = this.R.bind(this)
      // face
      R(cx - 4, headTop, 8, 1, L.skin)
      R(cx - 5, headTop + 1, 10, 8, L.skin)
      R(cx - 4, headTop + 9, 8, 1, L.skin)
      R(cx - 6, headTop + 4, 1, 2, L.skinShade)
      R(cx + 5, headTop + 4, 1, 2, L.skinShade)

      // eyes
      const status = s.status
      let look = 0
      if (status === 'working') look = id === 'claude' ? -1 : id === 'codex' ? 1 : 0
      if (id === 'mavis' && status === 'idle') look = Math.sin(t * 0.7) > 0.5 ? 1 : Math.sin(t * 0.7) < -0.5 ? -1 : 0
      if (opts.facing) look = opts.facing
      const blink = (t + (id === 'codex' ? 1.3 : id === 'mavis' ? 2.1 : 0)) % 3.7 < 0.13
      const eye = '#1e1a2a'
      const ey = headTop + 5
      if (status === 'done' && t - s.doneAt < 3) {
        // happy ^ ^ eyes
        R(cx - 4 + look, ey, 1, 1, eye)
        R(cx - 3 + look, ey - 1, 1, 1, eye)
        R(cx - 2 + look, ey, 1, 1, eye)
        R(cx + 1 + look, ey, 1, 1, eye)
        R(cx + 2 + look, ey - 1, 1, 1, eye)
        R(cx + 3 + look, ey, 1, 1, eye)
      } else if (blink) {
        R(cx - 3 + look, ey + 1, 2, 1, eye)
        R(cx + 1 + look, ey + 1, 2, 1, eye)
      } else {
        R(cx - 3 + look, ey, 1, 2, eye)
        R(cx + 2 + look, ey, 1, 2, eye)
      }
      // blush + mouth
      this.ctx.globalAlpha = 0.45
      R(cx - 4, headTop + 7, 1, 1, '#f08a8a')
      R(cx + 3, headTop + 7, 1, 1, '#f08a8a')
      this.ctx.globalAlpha = 1
      const my = headTop + 8
      const mouth = '#8e3f33'
      if (status === 'done' && t - s.doneAt < 3) R(cx - 1, my - 1, 3, 2, '#7a2e2e')
      else if (status === 'error') {
        R(cx - 2, my, 1, 1, mouth)
        R(cx - 1, my - 1, 2, 1, mouth)
        R(cx + 1, my, 1, 1, mouth)
      } else if (status === 'working' && Math.sin(t * 2.3) > 0.85) R(cx, my, 1, 1, mouth)
      else {
        R(cx - 1, my, 3, 1, mouth)
        if (status === 'idle') R(cx - 2, my - 1, 1, 1, mouth)
      }

      // hair & accessories
      if (id === 'claude') {
        R(cx - 5, headTop - 1, 10, 3, L.hair)
        R(cx - 4, headTop - 2, 8, 1, L.hair)
        R(cx - 6, headTop, 2, 6, L.hair)
        R(cx + 4, headTop + 1, 2, 4, L.hair)
        R(cx - 4, headTop + 2, 5, 1, L.hair)
        R(cx - 3, headTop + 3, 2, 1, L.hair)
        R(cx - 1, headTop - 2, 3, 1, L.hairHi)
      } else if (id === 'codex') {
        R(cx - 5, headTop - 1, 10, 3, L.hair)
        R(cx - 4, headTop - 2, 2, 1, L.hair)
        R(cx - 1, headTop - 3, 2, 2, L.hair)
        R(cx + 2, headTop - 2, 2, 1, L.hair)
        R(cx - 5, headTop + 2, 1, 2, L.hair)
        R(cx + 4, headTop + 2, 1, 2, L.hair)
        R(cx - 2, headTop + 2, 3, 1, L.hair)
        // headphones
        R(cx - 6, headTop - 3, 12, 1, L.phones)
        R(cx - 7, headTop - 2, 1, 4, L.phones)
        R(cx + 6, headTop - 2, 1, 4, L.phones)
        R(cx - 8, headTop + 2, 3, 5, L.phones)
        R(cx + 5, headTop + 2, 3, 5, L.phones)
        R(cx - 7, headTop + 4, 1, 1, status === 'working' && Math.sin(t * 7) > 0 ? L.accent : '#4a5068')
        R(cx + 6, headTop + 4, 1, 1, status === 'working' && Math.sin(t * 7) > 0 ? L.accent : '#4a5068')
      } else {
        R(cx - 5, headTop - 1, 10, 3, L.hair)
        R(cx - 4, headTop - 2, 8, 1, L.hair)
        R(cx - 6, headTop, 2, 9, L.hair)
        R(cx + 4, headTop, 2, 9, L.hair)
        R(cx - 4, headTop + 2, 8, 1, L.hair)
        R(cx - 3, headTop - 1, 4, 1, L.hairHi)
        // monocle with a glint
        const mx = cx + 1 + look
        const my2 = headTop + 4
        R(mx, my2, 4, 1, L.gold)
        R(mx, my2 + 3, 4, 1, L.gold)
        R(mx, my2, 1, 4, L.gold)
        R(mx + 3, my2, 1, 4, L.gold)
        R(mx + 3, my2 + 4, 1, 3, L.gold)
        if (t % 5 < 0.25) R(mx + 3, my2 - 1, 1, 1, '#ffffff')
        // headset mic
        R(cx - 7, headTop + 3, 1, 3, '#33364d')
        R(cx - 6, headTop + 6, 1, 2, '#33364d')
        R(cx - 5, headTop + 8, 2, 1, '#33364d')
        R(cx - 3, headTop + 8, 1, 1, L.accent)
      }
    }

    torsoAt(id, cx, y, bottom) {
      const L = LOOKS[id]
      const R = this.R.bind(this)
      R(cx - 1, y - 1, 2, 1, L.skinShade)
      R(cx - 6, y, 12, 1, L.shirt)
      R(cx - 7, y + 1, 14, bottom - y - 1, L.shirt)
      R(cx - 7, y + 1, 1, bottom - y - 1, L.shirtShade)
      R(cx + 6, y + 1, 1, bottom - y - 1, L.shirtShade)
      if (id === 'claude') {
        R(cx - 3, y, 6, 1, L.shirtShade)
        R(cx + 3, y + 3, 1, 3, L.accent)
        R(cx + 2, y + 4, 3, 1, L.accent)
      } else if (id === 'codex') {
        R(cx - 5, y - 1, 10, 2, L.shirtShade)
        R(cx - 2, y + 1, 1, 4, L.accent)
        R(cx + 1, y + 1, 1, 4, L.accent)
        R(cx - 3, bottom - 5, 6, 3, L.shirtShade)
      } else {
        R(cx - 3, y, 6, 4, L.collar)
        R(cx - 3, y, 2, 2, L.accent)
        R(cx + 1, y, 2, 2, L.accent)
        R(cx - 1, y, 2, 2, L.accentDark)
        R(cx - 3, y + 2, 1, bottom - y - 2, L.shirtShade)
        R(cx + 2, y + 2, 1, bottom - y - 2, L.shirtShade)
        R(cx + 4, y + 3, 2, 1, L.gold)
      }
    }

    drawSitter(id, cx, s, t) {
      const L = LOOKS[id]
      const R = this.R.bind(this)
      const still = reduceMotion()
      let bob = 0
      if (!still) {
        if (s.status === 'working') bob = Math.floor(t * 5 + (id === 'codex' ? 1 : 0)) % 4 === 0 ? 1 : 0
        else if (s.status === 'done' && t - s.doneAt < 3) bob = Math.floor(t * 6) % 2 ? -2 : 0
        else bob = Math.sin(t * 2 + cx) > 0.7 ? 1 : 0
      }
      const headTop = DESK_TOP - 29 + bob
      this.torsoAt(id, cx, headTop + 11, DESK_TOP)
      const cheering = s.status === 'done' && t - s.doneAt < 3
      if (cheering) {
        R(cx - 10, headTop - 4, 3, 16, L.shirt)
        R(cx + 7, headTop - 4, 3, 16, L.shirt)
        R(cx - 10, headTop - 7, 3, 3, L.skin)
        R(cx + 7, headTop - 7, 3, 3, L.skin)
        this.sparkles(cx, headTop, t)
      } else {
        R(cx - 8, headTop + 12, 2, DESK_TOP - headTop - 12, L.shirtShade)
        if (s.status === 'thinking') {
          R(cx + 5, headTop + 12, 2, 5, L.shirtShade)
          R(cx + 2, headTop + 10, 3, 2, L.skin)
        } else R(cx + 6, headTop + 12, 2, DESK_TOP - headTop - 12, L.shirtShade)
      }
      this.headAt(id, cx, headTop, s, t)
      if (s.status === 'thinking' && id === 'mavis') this.halo(cx, headTop, t)
      if (s.status === 'error' && Math.sin(t * 5) > -0.3) {
        this.text('!', cx - 1, headTop - 9, '#ff4d4d', 1)
        R(cx + 6, headTop + 1, 1, 2, '#8fd3ff')
      }
      this.sitterTop = headTop
    }

    drawHands(id, cx, s, t) {
      const L = LOOKS[id]
      const R = this.R.bind(this)
      if (s.status === 'done' && t - s.doneAt < 3) return
      let lUp = 0
      let rUp = 0
      if (s.status === 'working' && !reduceMotion()) {
        const k = Math.floor(t * 10 + (id === 'codex' ? 2 : 0))
        lUp = k % 2 ? -1 : 0
        rUp = hash(k) % 2 ? -1 : 0
      }
      R(cx - 7, DESK_TOP - 1 + lUp, 3, 2, L.skin)
      if (s.status !== 'thinking') R(cx + 4, DESK_TOP - 1 + rUp, 3, 2, L.skin)
    }

    halo(cx, headTop, t) {
      const n = 10
      for (let i = 0; i < n; i++) {
        const a = t * 2.4 + (i / n) * Math.PI * 2
        const x = cx + Math.round(Math.cos(a) * 11)
        const y = headTop + 2 + Math.round(Math.sin(a) * 3)
        this.ctx.globalAlpha = Math.sin(a) > 0 ? 0.95 : 0.4
        this.R(x, y, 1, 1, '#a9a4ff')
      }
      this.ctx.globalAlpha = 1
    }

    sparkles(cx, headTop, t) {
      const spots = [[-14, -2], [13, 0], [-11, -10], [10, -9]]
      spots.forEach(([dx, dy], i) => {
        if (Math.sin(t * 9 + i * 1.7) < 0) return
        const x = cx + dx
        const y = headTop + dy
        const c = i % 2 ? '#ffe27a' : '#ffffff'
        this.R(x, y - 1, 1, 3, c)
        this.R(x - 1, y, 3, 1, c)
      })
    }

    drawWalker(w, t) {
      const R = this.R.bind(this)
      const L = LOOKS.mavis
      const x = Math.round(w.x)
      const moving = w.phase === 'go' || w.phase === 'back'
      const step = moving && !reduceMotion() ? Math.floor(t * 9) % 2 : 0
      const bob = moving ? step : 0
      // shadow
      this.ctx.fillStyle = this.P.shade
      this.ctx.fillRect(x - 6, FEET - 1, 12, 2)
      // legs
      R(x - 4, FEET - 8 - bob, 3, 7 + (step ? 0 : 0), L.shirtShade)
      R(x + 1, FEET - 8 - bob, 3, 7 - (step ? 1 : 0), L.shirtShade)
      R(x - 4, FEET - 2 + (step ? 0 : 0), 3, 1, '#161626')
      R(x + 1, FEET - 2 - (step ? 1 : 0), 3, 1, '#161626')
      const top = FEET - 19 - bob
      this.torsoAt('mavis', x, top, FEET - 8 - bob)
      const swing = moving ? (step ? 1 : -1) : 0
      R(x - 8, top + 1 + swing, 2, 7, L.shirtShade)
      R(x + 6, top + 1 - swing, 2, 7, L.shirtShade)
      const f = w.facing || 1
      if (w.phase === 'go') {
        R(x + f * 7 - 2, top + 3, 5, 6, '#fbfbf6')
        R(x + f * 7 - 1, top + 5, 3, 1, '#b9bccb')
      }
      if (w.phase === 'give') {
        R(x + f * 6, top + 1, 3, 2, L.skin)
      }
      const fake = { status: w.phase === 'give' ? 'done' : 'idle', doneAt: w.phase === 'give' ? t : -99 }
      this.headAt('mavis', x, top - 11, fake, t, { facing: f })
      this.walkerTop = top - 11
    }

    drawFlyingPaper(t) {
      const f = this.flying
      const k = Math.min(1, (t - f.t) / 0.45)
      const x = f.from[0] + (f.to[0] - f.from[0]) * k
      const y = f.from[1] + (f.to[1] - f.from[1]) * k - Math.sin(k * Math.PI) * 14
      this.R(x - 2, y - 2, 5, 4, '#fbfbf6')
      this.R(x - 1, y - 1, 3, 1, '#b9bccb')
    }

    spawnCode(id, mx, t) {
      if (reduceMotion()) return
      const last = this.lastSpawn[id] || 0
      if (t - last < 0.55) return
      this.lastSpawn[id] = t
      this.particles.push({
        x: mx - 6 + (hash((t * 100) | 0) % 12),
        y: DESK_TOP - 24,
        born: t,
        ch: CODE_GLYPHS[hash((t * 1000) | 0) % CODE_GLYPHS.length],
        color: LOOKS[id].accent,
      })
    }

    drawParticles(t) {
      this.particles = this.particles.filter((p) => t - p.born < 1.6)
      for (const p of this.particles) {
        const age = t - p.born
        this.ctx.globalAlpha = Math.max(0, 1 - age / 1.6)
        this.text(p.ch, Math.round(p.x + Math.sin(age * 4) * 1.5), Math.round(p.y - age * 12), p.color)
      }
      this.ctx.globalAlpha = 1
    }

    drawNightTint() {
      const g = this.ctx.createLinearGradient(0, 0, 0, H)
      g.addColorStop(0, 'rgba(10,10,40,0.25)')
      g.addColorStop(0.6, 'rgba(10,10,40,0)')
      this.ctx.fillStyle = g
      this.ctx.fillRect(0, 0, W, H)
    }

    placeBubbles(t) {
      for (const id of ['claude', 'mavis', 'codex']) {
        const b = this.bubbles[id]
        if (b.text && t > b.until) this.say(id, '', { ttl: 0 })
        let x = SEATS[id]
        let y = DESK_TOP - 34
        if (id === 'mavis' && this.walk) {
          x = this.walk.x
          y = FEET - 34
        }
        if (id === 'claude') x = Math.max(x, 44)
        if (id === 'codex') x = Math.min(x, 276)
        b.el.style.left = (x / W) * 100 + '%'
        b.el.style.top = (y / H) * 100 + '%'
      }
    }
  }

  window.MavisOffice = Office
})()
