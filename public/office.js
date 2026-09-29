/* Pixel office: 傻妞 runs a studio whose project groups (one per model) sit in team pods.
   Everything is procedural fillRect art on a small canvas; names and speech are HTML overlays. */
;(function () {
  'use strict'

  const H = 216
  const FLOOR_Y = 96
  const BACK = 124 // desk-top line of the back row
  const FRONT = 184 // desk-top line of the front row
  const AISLE = 160 // feet line of the walkway between the rows
  const COLW = 70
  const CENTERW = 104
  const MARGIN = 12
  const PODGAP = 10

  // 3×5 pixel font for the kanban board, notes and floating code glyphs.
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
    '=': '000111000111000', '(': '010100100100010', ')': '010001001001010', ' ': '000000000000000',
  }
  const CODE_GLYPHS = ['{', '}', '<', '>', '/', ';', '=', '(', ')', '*', '0', '1']

  const PAL = {
    day: {
      wall: '#cfd5e6', wainscot: '#b9c1d8', trim: '#8790b0', floor: '#c49b6c', floorLine: '#aa8155', seam: '#b58c5f',
      sky: ['#86bff0', '#a9d4f6', '#d4ebfb'], cloud: '#ffffff', city: '#8a9ec0', cityWin: '#dbe6f4',
      frame: '#f3f5fa', frameShade: '#c3c9dc', deskTop: '#c7976a', desk: '#a4774e', deskEdge: '#85603c',
      sDeskTop: '#f6eef4', sDesk: '#e6d6e2', sDeskEdge: '#c4aabd', chair: '#394060', chairHi: '#4d5579',
      board: '#fbfcfe', boardFrame: '#99a2ba', boardInk: '#79809a', boardLine: '#e1e5ef',
      kbd: '#565d78', kbdHi: '#737a96', shade: 'rgba(20,20,40,0.18)', rugAlpha: 0.2,
      clock: '#fdfdfd', clockRim: '#5a6180', plant: ['#3f9c5c', '#2f7d48', '#5bbd77'], pot: '#bc6a4b', potRim: '#d27d5d',
      table: '#e9e3d8', tableEdge: '#b9ad99', glow: 0,
    },
    night: {
      wall: '#2a2c4a', wainscot: '#23253f', trim: '#1a1c31', floor: '#4a3a30', floorLine: '#3d3028', seam: '#44352c',
      sky: ['#0d1230', '#141a40', '#1f2656'], cloud: '#262c58', city: '#161b36', cityWin: '#f6d88a',
      frame: '#3a3d5f', frameShade: '#292b46', deskTop: '#7c5d3e', desk: '#654a33', deskEdge: '#4d3826',
      sDeskTop: '#5a4658', sDesk: '#4a3848', sDeskEdge: '#382a37', chair: '#20233a', chairHi: '#2d314d',
      board: '#d6d9e6', boardFrame: '#565d78', boardInk: '#5e6480', boardLine: '#c3c7d6',
      kbd: '#3a3f55', kbdHi: '#4f556e', shade: 'rgba(0,0,0,0.3)', rugAlpha: 0.16,
      clock: '#d9dbe6', clockRim: '#2c3049', plant: ['#2c6d43', '#215535', '#3f8a58'], pot: '#8a4d37', potRim: '#9d5a42',
      table: '#6b6070', tableEdge: '#4a414f', glow: 1,
    },
  }

  const SHANIU = {
    skin: '#f6d5c0', skinShade: '#e2b49b', hair: '#23202e', hairHi: '#4a4262', style: 'long',
    shirt: '#e0559a', shirtShade: '#b93f7c', accent: '#ff8cc6', acc: 'sensors',
  }
  const SKINS = ['#f1c7a1', '#e3b68c', '#f6d6bd', '#c99270']
  const HAIRS = ['#2a2230', '#7b3f24', '#4a3524', '#c9a06a', '#1c202e', '#6b6f80']
  const STYLES = ['short', 'side', 'spiky', 'long', 'short', 'side']
  const STATUS_LED = { idle: '#8b93ad', thinking: '#e8b84a', working: '#5ce08a', meeting: '#c9a6ff', walking: '#5ce08a', done: '#6fb6ff', error: '#ff5a5a', offline: '#40445a' }

  function hash(n) {
    n = (n ^ 61) ^ (n >>> 16)
    n = n + (n << 3)
    n = n ^ (n >>> 4)
    n = Math.imul(n, 0x27d4eb2d)
    return (n ^ (n >>> 15)) >>> 0
  }
  const strHash = (s) => [...String(s)].reduce((h, c) => hash(h + c.charCodeAt(0)), 7)

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16)
    const f = (v) => Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)))
    return '#' + [f(n >> 16), f((n >> 8) & 255), f(n & 255)].map((v) => v.toString(16).padStart(2, '0')).join('')
  }

  function isDark() {
    const t = document.documentElement.getAttribute('data-theme')
    if (t === 'dark') return true
    if (t === 'light') return false
    return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches
  }
  const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches

  function lookFor(emp) {
    if (!emp || emp.id === 'shaniu') return SHANIU
    const h = strHash(emp.id)
    const shirt = emp.color || '#6b7280'
    return {
      skin: SKINS[h % SKINS.length],
      skinShade: shade(SKINS[h % SKINS.length], -0.12),
      hair: HAIRS[(h >>> 3) % HAIRS.length],
      hairHi: shade(HAIRS[(h >>> 3) % HAIRS.length], 0.25),
      style: STYLES[(h >>> 6) % STYLES.length],
      shirt,
      shirtShade: shade(shirt, -0.22),
      accent: shade(shirt, 0.6),
      acc: emp.look || 'none',
    }
  }

  class Office {
    constructor(canvas, overlay, scene) {
      this.canvas = canvas
      this.ctx = canvas.getContext('2d')
      this.overlay = overlay
      this.scene = scene
      this.roster = { groups: [], employees: [] }
      this.st = { shaniu: { status: 'idle', available: true, doneAt: -99 } }
      this.tasks = []
      this.particles = []
      this.actors = new Map()
      this.flying = []
      this.bubbles = {}
      this.lastSpawn = {}
      this.meetingOpen = false
      this.t0 = performance.now()
      this.setRoster(this.roster)
      const loop = () => {
        if (!document.hidden) this.draw((performance.now() - this.t0) / 1000)
        requestAnimationFrame(loop)
      }
      requestAnimationFrame(loop)
    }

    now() {
      return (performance.now() - this.t0) / 1000
    }

    // ---- layout -----------------------------------------------------------------------

    setRoster(roster) {
      this.roster = roster || { groups: [], employees: [] }
      const byGroup = new Map(this.roster.groups.map((g) => [g.id, []]))
      for (const e of this.roster.employees) (byGroup.get(e.group) || []).push(e)
      const pods = this.roster.groups.map((g) => {
        const emps = byGroup.get(g.id) || []
        return { g, emps, cols: Math.max(1, Math.ceil(emps.length / 2)) }
      })
      const total = pods.reduce((n, p) => n + p.cols, 0)
      const left = []
      const right = []
      let lc = 0
      for (const p of pods) {
        if (!left.length || lc + p.cols <= total / 2) {
          left.push(p)
          lc += p.cols
        } else right.push(p)
      }
      const width = (list) => list.reduce((n, p) => n + p.cols * COLW, 0) + Math.max(0, list.length - 1) * PODGAP
      const side = Math.max(width(left), width(right), (320 - CENTERW - 2 * MARGIN) / 2)
      this.W = Math.round(2 * MARGIN + 2 * side + CENTERW)
      this.cx = Math.round(this.W / 2)
      let x = MARGIN + side - width(left)
      const place = (p) => {
        p.x = x
        p.w = p.cols * COLW
        x += p.w + PODGAP
      }
      left.forEach(place)
      x = this.cx + CENTERW / 2
      right.forEach(place)

      this.pods = pods
      this.seats = {}
      this.vacant = []
      for (const p of pods) {
        for (let i = 0; i < p.cols * 2; i++) {
          const seat = { x: Math.round(p.x + (i % p.cols) * COLW + COLW / 2), top: i < p.cols ? BACK : FRONT, pod: p }
          const emp = p.emps[i]
          if (emp) this.seats[emp.id] = { ...seat, emp, look: lookFor(emp) }
          else this.vacant.push(seat)
        }
      }
      this.seats.shaniu = { x: this.cx, top: FRONT, emp: { id: 'shaniu', name: '傻妞' }, look: SHANIU, boss: true }
      this.table = { x: this.cx, y: BACK + 6 }
      for (const e of this.roster.employees) {
        this.st[e.id] ||= { status: e.available ? 'idle' : 'offline', available: e.available, doneAt: -99 }
        this.st[e.id].available = e.available
      }

      this.canvas.width = this.W
      this.canvas.height = H
      this.ctx.imageSmoothingEnabled = false
      this.scene.style.setProperty('--scene-ratio', `${this.W} / ${H}`)
      this.scene.style.setProperty('--scene-w', this.W)
      this.buildOverlay()
    }

    pct(x, y) {
      return { left: (x / this.W) * 100 + '%', top: (y / H) * 100 + '%' }
    }

    buildOverlay() {
      const keep = this.bubbles
      this.overlay.innerHTML = ''
      const add = (cls, text, x, y, color) => {
        const el = document.createElement('div')
        el.className = cls
        el.textContent = text
        Object.assign(el.style, this.pct(x, y))
        if (color) el.style.setProperty('--c', color)
        this.overlay.appendChild(el)
        return el
      }
      add('sign', '牛马工作室', this.cx, 20)
      for (const p of this.pods) add('pod-sign', p.g.name + (p.g.available ? '' : ' · 未到岗'), p.x + p.w / 2, 70, p.g.color)
      for (const [id, s] of Object.entries(this.seats)) add('tag' + (s.boss ? ' tag-boss' : ''), s.emp.name, s.x, s.top + 16, s.boss ? '' : s.pod.g.color)
      for (const v of this.vacant) add('tag tag-vacant', '招人中', v.x, v.top + 16)
      this.bubbles = {}
      for (const id of Object.keys(this.seats)) {
        const el = document.createElement('div')
        el.className = 'speech hide'
        el.dataset.id = id
        this.overlay.appendChild(el)
        const prev = keep[id]
        this.bubbles[id] = { el, text: '', until: 0, kind: '' }
        if (prev && prev.text) this.say(id, prev.text, { kind: prev.kind, ttl: Math.max(0, (prev.until - this.now()) * 1000) })
      }
    }

    // ---- public API -------------------------------------------------------------------

    setAgent(id, info) {
      const s = (this.st[id] ||= { status: 'idle', available: true, doneAt: -99 })
      const t = this.now()
      const prev = s.status
      if (info.available !== undefined) s.available = !!info.available
      if (info.status && info.status !== prev) {
        s.status = info.status
        if (info.status === 'done') {
          s.doneAt = t
          s.paper = false
        }
        if (info.status === 'error' || info.status === 'idle') s.paper = false
      }
      if (info.status === 'walking') return
      if (s.status === 'thinking') this.say(id, '···', { kind: 'think', ttl: Infinity })
      else if (s.status === 'working') this.say(id, info.text || '开工', { ttl: Infinity })
      else if (s.status === 'meeting') {
        if (info.text) this.say(id, info.text, { kind: info.text.endsWith('…') ? 'think' : '', ttl: 9000 })
      } else if (s.status === 'done') this.say(id, info.text || '搞定！', { kind: 'ok', ttl: 3500 })
      else if (s.status === 'error') this.say(id, info.text || '出错了', { kind: 'warn', ttl: 6000 })
      else if (s.status === 'offline') this.say(id, '', { ttl: 0 })
      else if (['thinking', 'working', 'meeting'].includes(prev)) this.say(id, '', { ttl: 0 })
    }

    activity(id, text) {
      if (this.st[id]?.status === 'working') this.say(id, text, { ttl: Infinity })
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

    setTasks(tasks) {
      this.tasks = tasks.map((t) => ({ agent: t.agent, status: t.status, kind: t.kind }))
    }

    /** 傻妞 walks over and hands the task sheet to someone. */
    dispatch(to) {
      const seat = this.seats[to]
      if (!seat) return
      const a = this.actor('shaniu')
      const stand = seat.x + (seat.x < this.cx ? 14 : -14)
      a.queue.push(
        { to: [[stand, AISLE]], carrying: true },
        {
          hold: 0.55,
          arrive: () => {
            a.facing = seat.x < a.x ? -1 : 1
            this.say('shaniu', `${seat.emp.name}，交给你啦`, { ttl: 1300 })
            this.flying.push({ from: [a.x + a.facing * 6, AISLE - 15], to: [seat.x + 8, seat.top - 1], t: this.now(), id: to })
          },
        },
        { to: [[this.cx, AISLE]] },
      )
    }

    /** Attendees (and 傻妞) walk to the meeting table and stay until the meeting closes. */
    meeting(m) {
      if (!m) {
        this.meetingOpen = false
        return
      }
      if (m.status === 'open' && !this.meetingOpen) {
        this.meetingOpen = true
        const spots = [
          [this.table.x - 36, BACK + 30],
          [this.table.x + 36, BACK + 30],
          [this.table.x - 13, BACK + 3],
          [this.table.x + 13, BACK + 3],
          [this.table.x - 36, BACK + 12],
          [this.table.x + 36, BACK + 12],
        ]
        const people = m.attendees.filter((id) => this.seats[id])
        people.forEach((id, i) => {
          const seat = this.seats[id]
          const [sx, sy] = spots[i % spots.length]
          const a = this.actor(id, [seat.x, AISLE])
          a.queue.push({ to: [[sx, AISLE], [sx, sy]], wait: () => !this.meetingOpen, face: sx < this.table.x ? 1 : -1 }, { to: [[sx, AISLE], [seat.x, AISLE]] })
        })
        const boss = this.actor('shaniu')
        boss.queue.push({ to: [[this.table.x, AISLE]], wait: () => !this.meetingOpen, face: 0 }, { to: [[this.cx, AISLE]] })
      } else if (m.status === 'closed') this.meetingOpen = false
    }

    actor(id, from) {
      let a = this.actors.get(id)
      if (!a) {
        const seat = this.seats[id]
        const [x, y] = from || [seat.x, AISLE]
        a = { id, x, y, home: [x, y], queue: [], cur: null, facing: 1 }
        this.actors.set(id, a)
      }
      return a
    }

    stepActors(t, dt) {
      const speed = reduceMotion() ? 2000 : 80
      for (const a of this.actors.values()) {
        if (!a.cur) {
          a.cur = a.queue.shift() || null
          if (!a.cur) {
            this.actors.delete(a.id)
            continue
          }
          a.cur.i = 0
          a.cur.arrived = false
        }
        const c = a.cur
        const pts = c.to || []
        if (c.i < pts.length) {
          const [tx, ty] = pts[c.i]
          const dx = tx - a.x
          const dy = ty - a.y
          const dist = Math.hypot(dx, dy)
          const step = speed * dt
          if (dist <= step) {
            a.x = tx
            a.y = ty
            c.i++
          } else {
            a.x += (dx / dist) * step
            a.y += (dy / dist) * step
            if (Math.abs(dx) > 0.5) a.facing = Math.sign(dx)
          }
          a.moving = true
          a.carrying = !!c.carrying
          continue
        }
        a.moving = false
        a.carrying = false
        if (!c.arrived) {
          c.arrived = true
          c.since = t
          if (c.face !== undefined) a.facing = c.face
          c.arrive?.()
        }
        const holding = (c.hold && t - c.since < c.hold) || (c.wait && !c.wait())
        if (!holding) a.cur = null
      }
      this.flying = this.flying.filter((f) => {
        if (t - f.t < 0.45) return true
        if (this.st[f.id]) this.st[f.id].paper = true
        return false
      })
    }

    /** A 16×16 head-and-shoulders portrait (data: URL) for chat avatars and the team panel. */
    portrait(emp) {
      const c = document.createElement('canvas')
      c.width = 16
      c.height = 16
      const saved = this.ctx
      this.ctx = c.getContext('2d')
      const look = lookFor(emp)
      this.torso(look, 8, 14, 16)
      this.head(look, 8, 4, { status: 'idle', doneAt: -99 }, 0.5, {})
      this.ctx = saved
      return c.toDataURL()
    }

    // ---- drawing -------------------------------------------------------------------------

    draw(t) {
      const dt = Math.min(0.1, t - (this.lastT || t))
      this.lastT = t
      this.P = isDark() ? PAL.night : PAL.day
      this.ctx.imageSmoothingEnabled = false
      this.stepActors(t, dt)
      this.room(t)
      const stations = Object.entries(this.seats)
      for (const v of this.vacant.filter((v) => v.top === BACK)) this.vacantDesk(v)
      for (const [id, s] of stations) if (s.top === BACK) this.station(id, s, t)
      // standing people and the meeting table, back to front
      const actors = [...this.actors.values()].sort((a, b) => a.y - b.y)
      const tableY = this.table.y + 10
      for (const a of actors) if (a.y <= tableY) this.standing(a, t)
      this.meetingTable()
      for (const a of actors) if (a.y > tableY && a.y <= AISLE + 1) this.standing(a, t)
      for (const v of this.vacant.filter((v) => v.top === FRONT)) this.vacantDesk(v)
      for (const [id, s] of stations) if (s.top === FRONT) this.station(id, s, t)
      for (const a of actors) if (a.y > AISLE + 1) this.standing(a, t)
      for (const f of this.flying) this.paper(f, t)
      this.drawParticles(t)
      if (this.P.glow) this.nightTint()
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

    room(t) {
      const P = this.P
      const R = this.R.bind(this)
      const W = this.W
      R(0, 0, W, FLOOR_Y, P.wall)
      R(0, 76, W, FLOOR_Y - 76, P.wainscot)
      R(0, 75, W, 1, P.trim)
      for (let x = 20; x < W; x += 40) R(x, 77, 1, FLOOR_Y - 79, P.trim)
      R(0, FLOOR_Y - 2, W, 2, P.trim)
      R(0, FLOOR_Y, W, H - FLOOR_Y, P.floor)
      for (let y = FLOOR_Y + 7, row = 0; y < H; y += 7, row++) {
        R(0, y, W, 1, P.floorLine)
        for (let x = (row * 37) % 64; x < W; x += 64) R(x, y - 6, 1, 6, P.seam)
      }
      // team rugs
      for (const p of this.pods) {
        this.ctx.globalAlpha = P.rugAlpha
        R(p.x + 2, FLOOR_Y + 6, p.w - 4, H - FLOOR_Y - 8, p.g.color)
        this.ctx.globalAlpha = 1
        R(p.x + 2, FLOOR_Y + 6, p.w - 4, 1, p.g.color)
      }
      // wall
      this.window(t, 12, 10, 64, 44)
      this.clock(this.cx - 58, 30)
      this.signPlate(t)
      this.board(t, W - 100, 8, 88, 50)
      this.plant(this.cx - CENTERW / 2 + 2)
      this.plant(this.cx + CENTERW / 2 - 16)
      // hanging pod signs
      for (const p of this.pods) {
        const sx = p.x + p.w / 2
        R(sx - 16, 62, 1, 4, P.trim)
        R(sx + 15, 62, 1, 4, P.trim)
      }
    }

    window(t, x, y, w, h) {
      const P = this.P
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
        R(x + w - 16, y + 5, 7, 7, '#f4f1d0')
        R(x + w - 17, y + 6, 9, 5, '#f4f1d0')
        R(x + w - 13, y + 4, 7, 7, P.sky[0])
        for (let i = 0; i < 16; i++) {
          const hx = hash(i * 7 + 3)
          if (Math.sin(t * 1.7 + i * 2.3) > -0.4) R(x + (hx % w), y + ((hx >>> 8) % (h - 18)), 1, 1, i % 5 ? '#c9cff5' : '#ffffff')
        }
      } else {
        R(x + 7, y + 6, 7, 7, '#fff4c4')
        R(x + 6, y + 7, 9, 5, '#fff4c4')
        for (let i = 0; i < 3; i++) {
          const cx = x - 17 + ((t * (2 + i) + i * 31) % (w + 34))
          R(cx, y + 7 + i * 8, 14, 3, P.cloud)
          R(cx + 3, y + 5 + i * 8, 7, 2, P.cloud)
        }
      }
      const blds = [[0, 9, 14], [10, 7, 22], [18, 11, 12], [30, 8, 26], [39, 12, 17], [52, 6, 20], [59, 6, 13]]
      for (const [bx, bw, bh] of blds) {
        R(x + bx, y + h - bh, bw, bh, P.city)
        for (let wy = y + h - bh + 3; wy < y + h - 2; wy += 4) {
          for (let wx = x + bx + 2; wx < x + bx + bw - 2; wx += 3) if (hash(wx * 31 + wy * 17) % 3 === 0) R(wx, wy, 1, 2, P.cityWin)
        }
      }
      ctx.restore()
      R(x + w / 2 - 1, y, 2, h, P.frame)
      R(x, y + band, w, 1, P.frame)
    }

    clock(cx, cy) {
      const P = this.P
      const r = 9
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const d = dx * dx + dy * dy
          if (d <= r * r) this.R(cx + dx, cy + dy, 1, 1, d >= (r - 1.3) * (r - 1.3) ? P.clockRim : P.clock)
        }
      }
      const now = new Date()
      const hand = (angle, len, color) => {
        for (let s = 0; s <= len; s += 0.5) this.R(cx + Math.round(Math.sin(angle) * s), cy - Math.round(Math.cos(angle) * s), 1, 1, color)
      }
      hand(((now.getHours() % 12) + now.getMinutes() / 60) * (Math.PI / 6), 4, '#1b1a2c')
      hand((now.getMinutes() + now.getSeconds() / 60) * (Math.PI / 30), 6, '#1b1a2c')
      hand(now.getSeconds() * (Math.PI / 30), 7, '#e0559a')
    }

    signPlate(t) {
      const x = this.cx - 30
      this.R(x - 2, 9, 64, 24, this.P.trim)
      this.R(x - 1, 10, 62, 22, '#1d1428')
      const busy = Object.values(this.st).some((s) => s.status === 'working')
      this.R(x + 57, 11, 3, 3, busy && Math.sin(t * 6) > 0 ? '#ff5a8a' : '#4a2a3a')
    }

    board(t, x, y, w, h) {
      const P = this.P
      const R = this.R.bind(this)
      R(x - 2, y - 2, w + 4, h + 4, P.boardFrame)
      R(x, y, w, h, P.board)
      const cols = [['TODO', ['pending']], ['DOING', ['running']], ['DONE', ['done', 'failed', 'skipped', 'cancelled']]]
      const cw = w / 3
      const color = (id) => this.seats[id]?.pod?.g.color || '#e0559a'
      cols.forEach(([label, states], ci) => {
        const cx = x + ci * cw
        this.text(label, cx + Math.round((cw - (label.length * 4 - 1)) / 2), y + 3, P.boardInk)
        if (ci) R(cx, y + 10, 1, h - 13, P.boardLine)
        const notes = this.tasks.filter((tk) => states.includes(tk.status)).slice(0, 12)
        notes.forEach((tk, i) => {
          const c = color(tk.agent)
          const nx = cx + 3 + (i % 3) * 9
          const wiggle = tk.status === 'running' && Math.sin(t * 5 + i) > 0.6 ? -1 : 0
          const ny = y + 12 + Math.floor(i / 3) * 9 + wiggle
          R(nx, ny, 7, 7, shade(c, 0.45))
          R(nx, ny, 7, 1, c)
          if (tk.kind === 'review' || tk.kind === 'verify') R(nx + 2, ny + 3, 3, 1, c)
          else R(nx + 1, ny + 3, 5, 1, 'rgba(0,0,0,0.18)')
          if (tk.status === 'failed') R(nx + 5, ny + 5, 2, 2, '#e5484d')
        })
      })
    }

    plant(x) {
      const P = this.P
      const R = this.R.bind(this)
      const y = FLOOR_Y + 14
      R(x, y, 14, 12, P.pot)
      R(x - 1, y - 2, 16, 3, P.potRim)
      const [a, b, c] = P.plant
      R(x + 6, y - 24, 2, 24, b)
      R(x + 1, y - 20, 6, 3, a)
      R(x + 8, y - 16, 7, 3, a)
      R(x, y - 12, 7, 3, c)
      R(x + 8, y - 24, 5, 3, c)
      R(x + 3, y - 28, 4, 3, a)
    }

    meetingTable() {
      const P = this.P
      const { x, y } = this.table
      for (let dy = -6; dy <= 6; dy++) {
        const half = Math.round(24 * Math.sqrt(1 - (dy / 6.5) ** 2))
        this.R(x - half, y + dy, half * 2, 1, dy > 3 ? P.tableEdge : P.table)
      }
      this.R(x - 2, y + 6, 4, 8, P.tableEdge)
      this.R(x - 8, y + 14, 16, 2, P.tableEdge)
      if (this.meetingOpen) {
        this.R(x - 6, y - 3, 5, 3, '#fbfbf6')
        this.R(x + 2, y - 2, 5, 3, '#fbfbf6')
        this.R(x - 1, y - 5, 2, 2, '#e0559a')
      }
    }

    desk(x, top, boss) {
      const P = this.P
      const R = this.R.bind(this)
      const half = boss ? 36 : 28
      const t = boss ? P.sDeskTop : P.deskTop
      const b = boss ? P.sDesk : P.desk
      const e = boss ? P.sDeskEdge : P.deskEdge
      this.ctx.fillStyle = P.shade
      this.ctx.fillRect(x - half, top + 27, half * 2, 3)
      R(x - half, top, half * 2, 4, t)
      R(x - half, top + 3, half * 2, 1, e)
      R(x - half + 1, top + 4, half * 2 - 2, 23, b)
      R(x - half + 1, top + 4, 2, 23, e)
      R(x + half - 3, top + 4, 2, 23, e)
      if (boss) R(x - half + 4, top + 6, half * 2 - 8, 1, '#e0559a')
      return half
    }

    chair(x, top) {
      this.R(x - 9, top - 27, 18, 27, this.P.chair)
      this.R(x - 8, top - 27, 16, 1, this.P.chairHi)
    }

    vacantDesk(v) {
      this.chair(v.x, v.top)
      this.desk(v.x, v.top, false)
      this.monitor(v.x - 16, v.top, null, 0, 0)
      this.R(v.x - 25, v.top - 17, 18, 8, '#f7e27a')
      this.text('HIRE', v.x - 24, v.top - 15, '#6b5a12')
    }

    station(id, seat, t) {
      const s = this.st[id] || { status: 'idle', available: true }
      const boss = !!seat.boss
      const away = this.actors.has(id)
      const present = s.available !== false && !away
      this.chair(seat.x, seat.top)
      if (present) this.sitter(seat.look, seat.x, seat.top, s, t, id)
      const half = this.desk(seat.x, seat.top, boss)
      const led = STATUS_LED[s.available === false ? 'offline' : s.status] || STATUS_LED.idle
      const blink = ['working', 'thinking', 'meeting'].includes(s.status) && Math.sin(t * 8) < 0
      this.R(seat.x + half - 7, seat.top + 7, 3, 2, blink ? '#23402e' : led)
      const mons = boss ? [seat.x - 24, seat.x + 24] : [seat.x - 16]
      mons.forEach((mx, i) => this.monitor(mx, seat.top, s.available === false ? null : s, t, i, seat.look))
      this.R(seat.x - 6, seat.top, 12, 2, this.P.kbd)
      this.R(seat.x - 5, seat.top, 10, 1, this.P.kbdHi)
      this.mug(boss ? seat.x + 9 : seat.x + 14, seat.top, s, t, boss)
      if (s.paper) {
        this.R(seat.x + 7, seat.top, 6, 3, '#fbfbf6')
        this.R(seat.x + 8, seat.top + 1, 4, 1, '#b9bccb')
      }
      if (present) this.hands(seat.look, seat.x, seat.top, s, t)
      if (s.available === false) {
        this.R(mons[0] - 7, seat.top - 17, 14, 8, '#f7e27a')
        this.text('OFF', mons[0] - 5, seat.top - 15, '#6b5a12')
      }
      if (present && s.status === 'working') this.spawnCode(id, mons[0], seat.top, t, seat.look)
    }

    mug(x, top, s, t, boss) {
      const R = this.R.bind(this)
      if (boss) {
        R(x, top - 1, 7, 1, '#e6e7f0')
        R(x + 1, top - 4, 5, 3, '#fff0f7')
        R(x + 1, top - 4, 5, 1, '#e0559a')
      } else {
        R(x, top - 5, 4, 5, '#f5efe6')
        R(x + 4, top - 4, 1, 2, '#f5efe6')
      }
      if (s.status === 'idle' && !reduceMotion()) {
        const k = (t * 5) % 6
        this.ctx.globalAlpha = 0.5 * (1 - k / 6)
        R(x + 1 + (Math.sin(t * 3) > 0 ? 1 : 0), top - 7 - k, 1, 2, '#ffffff')
        this.ctx.globalAlpha = 1
      }
    }

    monitor(mx, top, s, t, idx, look) {
      const R = this.R.bind(this)
      const sw = 18
      const sh = 12
      const sx = mx - sw / 2
      const sy = top - 18
      const status = s?.status
      const celebrating = status === 'done' && t - s.doneAt < 3
      let bg = '#161b2d'
      if (!s) bg = '#0d101b'
      else if (celebrating) bg = '#123a26'
      else if (status === 'error') bg = '#3a1216'
      if (this.P.glow && s) {
        this.ctx.globalAlpha = 0.13
        R(sx - 6, sy - 4, sw + 12, sh + 10, status === 'error' ? '#ff5a5a' : celebrating ? '#5ce08a' : '#8fb7ff')
        this.ctx.globalAlpha = 1
      }
      R(sx - 1, sy - 1, sw + 2, sh + 2, '#262b40')
      R(sx, sy, sw, sh, bg)
      R(mx - 1, sy + sh + 1, 2, 4, '#262b40')
      R(mx - 4, top - 1, 8, 1, '#262b40')
      if (!s) return
      const accent = look?.accent || '#ffffff'
      if (celebrating) {
        const c = '#5ce08a'
        R(mx - 5, sy + 6, 2, 2, c)
        R(mx - 3, sy + 8, 2, 2, c)
        R(mx - 1, sy + 6, 2, 2, c)
        R(mx + 1, sy + 4, 2, 2, c)
        R(mx + 3, sy + 2, 2, 2, c)
      } else if (status === 'error') {
        for (let i = 0; i < 6; i++) {
          R(mx - 4 + i, sy + 3 + i, 2, 1, '#ff6b6b')
          R(mx + 1 - i, sy + 3 + i, 2, 1, '#ff6b6b')
        }
      } else if (status === 'working' || (look === SHANIU && this.anyWorking())) {
        const ink = ['#e6e6f0', accent, '#8bd5ff', '#f7c873', '#c3a6ff']
        const scroll = Math.floor(t * (look === SHANIU ? 3 : 7))
        for (let i = 0; i < 5; i++) {
          const hv = hash((i + scroll) * 131 + mx * 7 + idx)
          const indent = (hv % 3) * 2
          const len = 3 + ((hv >>> 3) % 11)
          R(sx + 2 + indent, sy + 2 + i * 2, Math.min(len, sw - 4 - indent), 1, ink[(hv >>> 7) % ink.length])
        }
      } else if (status === 'thinking' || status === 'meeting') {
        for (let i = 0; i < 3; i++) R(mx - 5 + i * 4, sy + 5 + (Math.floor(t * 4) % 3 === i ? -1 : 0), 2, 2, accent)
      } else {
        const tri = (v, n) => {
          const m = v % (2 * n)
          return m < n ? m : 2 * n - m
        }
        R(sx + 1 + tri(Math.floor(t * 6 + idx * 5 + mx), sw - 4), sy + 1 + tri(Math.floor(t * 4 + idx * 3), sh - 4), 2, 2, look?.shirt || '#ffffff')
      }
    }

    anyWorking() {
      return Object.values(this.st).some((s) => s.status === 'working')
    }

    head(L, cx, top, s, t, opts) {
      const R = this.R.bind(this)
      R(cx - 4, top, 8, 1, L.skin)
      R(cx - 5, top + 1, 10, 8, L.skin)
      R(cx - 4, top + 9, 8, 1, L.skin)
      R(cx - 6, top + 4, 1, 2, L.skinShade)
      R(cx + 5, top + 4, 1, 2, L.skinShade)
      const status = s.status
      let look = opts.facing || 0
      if (!opts.facing && status === 'working') look = -1
      const blink = (t + (strHash(opts.id || '') % 30) / 10) % 3.7 < 0.13
      const eye = '#1e1a2a'
      const ey = top + 5
      const happy = status === 'done' && t - s.doneAt < 3
      if (happy) {
        for (const ox of [-4, 1]) {
          R(cx + ox + look, ey, 1, 1, eye)
          R(cx + ox + 1 + look, ey - 1, 1, 1, eye)
          R(cx + ox + 2 + look, ey, 1, 1, eye)
        }
      } else if (blink) {
        R(cx - 3 + look, ey + 1, 2, 1, eye)
        R(cx + 1 + look, ey + 1, 2, 1, eye)
      } else {
        R(cx - 3 + look, ey, 1, 2, eye)
        R(cx + 2 + look, ey, 1, 2, eye)
        if (L === SHANIU) {
          R(cx - 3 + look, ey, 1, 1, '#6a5a8a')
          R(cx + 2 + look, ey, 1, 1, '#6a5a8a')
        }
      }
      this.ctx.globalAlpha = 0.45
      R(cx - 4, top + 7, 1, 1, '#f08a8a')
      R(cx + 3, top + 7, 1, 1, '#f08a8a')
      this.ctx.globalAlpha = 1
      const my = top + 8
      const mouth = '#8e3f33'
      if (happy) R(cx - 1, my - 1, 3, 2, '#7a2e2e')
      else if (status === 'error') {
        R(cx - 2, my, 1, 1, mouth)
        R(cx - 1, my - 1, 2, 1, mouth)
        R(cx + 1, my, 1, 1, mouth)
      } else if ((status === 'meeting' || status === 'working') && Math.sin(t * (status === 'meeting' ? 9 : 2.3)) > 0.6) R(cx - 1, my - 1, 2, 2, '#7a2e2e')
      else R(cx - 1, my, 3, 1, mouth)
      this.hair(L, cx, top, t, status)
    }

    hair(L, cx, top, t, status) {
      const R = this.R.bind(this)
      const h = L.hair
      if (L.style === 'long') {
        R(cx - 5, top - 1, 10, 3, h)
        R(cx - 4, top - 2, 8, 1, h)
        R(cx - 6, top, 2, 13, h)
        R(cx + 4, top, 2, 13, h)
        R(cx - 4, top + 2, 8, 1, h)
        R(cx - 2, top - 1, 3, 1, L.hairHi)
      } else if (L.style === 'side') {
        R(cx - 5, top - 1, 10, 3, h)
        R(cx - 4, top - 2, 8, 1, h)
        R(cx - 6, top, 2, 6, h)
        R(cx + 4, top + 1, 2, 4, h)
        R(cx - 4, top + 2, 5, 1, h)
        R(cx - 1, top - 2, 3, 1, L.hairHi)
      } else if (L.style === 'spiky') {
        R(cx - 5, top - 1, 10, 3, h)
        R(cx - 4, top - 2, 2, 1, h)
        R(cx - 1, top - 3, 2, 2, h)
        R(cx + 2, top - 2, 2, 1, h)
        R(cx - 5, top + 2, 1, 2, h)
        R(cx + 4, top + 2, 1, 2, h)
      } else {
        R(cx - 5, top - 1, 10, 3, h)
        R(cx - 4, top - 2, 8, 1, h)
        R(cx - 5, top + 2, 1, 3, h)
        R(cx + 4, top + 2, 1, 3, h)
      }
      const acc = L.acc
      if (acc === 'sensors') {
        // 傻妞's headband with two glowing sensor ears
        R(cx - 5, top + 1, 10, 1, '#ff6faf')
        const glow = status === 'thinking' || status === 'meeting' ? (Math.sin(t * 8) > 0 ? '#fff0f8' : '#ff8cc6') : '#ff8cc6'
        R(cx - 6, top - 3, 2, 3, '#f4f4fa')
        R(cx + 4, top - 3, 2, 3, '#f4f4fa')
        R(cx - 6, top - 4, 2, 1, glow)
        R(cx + 4, top - 4, 2, 1, glow)
      } else if (acc === 'helmet') {
        R(cx - 6, top - 3, 12, 4, '#f2c230')
        R(cx - 7, top, 14, 1, '#d9a51c')
        R(cx - 3, top - 3, 3, 1, '#fbe08a')
      } else if (acc === 'beret') {
        R(cx - 6, top - 3, 11, 3, '#b8323f')
        R(cx + 2, top - 4, 1, 1, '#8e2330')
      } else if (acc === 'headphones') {
        R(cx - 6, top - 3, 12, 1, '#2a2e3e')
        R(cx - 7, top - 2, 1, 4, '#2a2e3e')
        R(cx + 6, top - 2, 1, 4, '#2a2e3e')
        R(cx - 8, top + 2, 3, 5, '#2a2e3e')
        R(cx + 5, top + 2, 3, 5, '#2a2e3e')
        const on = status === 'working' && Math.sin(t * 7) > 0
        R(cx - 7, top + 4, 1, 1, on ? L.accent : '#4a5068')
        R(cx + 6, top + 4, 1, 1, on ? L.accent : '#4a5068')
      } else if (acc === 'cap') {
        R(cx - 5, top - 2, 10, 3, '#2f5fb3')
        R(cx + 1, top + 1, 6, 1, '#244a8c')
        R(cx - 1, top - 2, 2, 1, '#6d97e0')
      } else if (acc === 'glasses') {
        const g = '#2a2436'
        R(cx - 4, top + 4, 3, 1, g)
        R(cx + 1, top + 4, 3, 1, g)
        R(cx - 4, top + 7, 3, 1, g)
        R(cx + 1, top + 7, 3, 1, g)
        R(cx - 1, top + 5, 2, 1, g)
      } else if (acc === 'bandana') {
        R(cx - 5, top + 1, 10, 2, '#d23c3c')
        R(cx + 5, top + 2, 2, 1, '#d23c3c')
        R(cx + 6, top + 3, 1, 2, '#b02a2a')
      } else if (acc === 'bun') {
        R(cx - 2, top - 5, 4, 3, h)
        R(cx + 2, top - 6, 1, 3, '#f2c230')
      }
    }

    torso(L, cx, y, bottom) {
      const R = this.R.bind(this)
      R(cx - 1, y - 1, 2, 1, L.skinShade)
      R(cx - 6, y, 12, 1, L.shirt)
      R(cx - 7, y + 1, 14, bottom - y - 1, L.shirt)
      R(cx - 7, y + 1, 1, bottom - y - 1, L.shirtShade)
      R(cx + 6, y + 1, 1, bottom - y - 1, L.shirtShade)
      R(cx - 3, y, 6, 1, L.shirtShade)
      if (L === SHANIU) {
        R(cx - 3, y, 6, 2, '#fff5fa')
        const beat = Math.sin(this.lastT * 3 || 0) > 0.3
        R(cx - 1, y + 4, 1, 1, beat ? '#ffffff' : '#ffd1e6')
        R(cx + 1, y + 4, 1, 1, beat ? '#ffffff' : '#ffd1e6')
        R(cx - 1, y + 5, 3, 1, beat ? '#ffffff' : '#ffd1e6')
        R(cx, y + 6, 1, 1, beat ? '#ffffff' : '#ffd1e6')
      } else R(cx + 3, y + 3, 1, 2, L.accent)
    }

    sitter(L, cx, top, s, t, id) {
      const R = this.R.bind(this)
      let bob = 0
      if (!reduceMotion()) {
        if (s.status === 'working') bob = Math.floor(t * 5 + (strHash(id) % 4)) % 4 === 0 ? 1 : 0
        else if (s.status === 'done' && t - s.doneAt < 3) bob = Math.floor(t * 6) % 2 ? -2 : 0
        else bob = Math.sin(t * 2 + cx) > 0.7 ? 1 : 0
      }
      const headTop = top - 29 + bob
      this.torso(L, cx, headTop + 11, top)
      const cheering = s.status === 'done' && t - s.doneAt < 3
      if (cheering) {
        R(cx - 10, headTop - 4, 3, 16, L.shirt)
        R(cx + 7, headTop - 4, 3, 16, L.shirt)
        R(cx - 10, headTop - 7, 3, 3, L.skin)
        R(cx + 7, headTop - 7, 3, 3, L.skin)
        this.sparkles(cx, headTop, t)
      } else {
        R(cx - 8, headTop + 12, 2, top - headTop - 12, L.shirtShade)
        if (s.status === 'thinking') {
          R(cx + 5, headTop + 12, 2, 5, L.shirtShade)
          R(cx + 2, headTop + 10, 3, 2, L.skin)
        } else R(cx + 6, headTop + 12, 2, top - headTop - 12, L.shirtShade)
      }
      this.head(L, cx, headTop, s, t, { id })
      if (s.status === 'thinking' && L === SHANIU) this.halo(cx, headTop, t)
      if (s.status === 'error' && Math.sin(t * 5) > -0.3) {
        this.text('!', cx - 1, headTop - 9, '#ff4d4d')
        R(cx + 6, headTop + 1, 1, 2, '#8fd3ff')
      }
    }

    hands(L, cx, top, s, t) {
      if (s.status === 'done' && t - s.doneAt < 3) return
      let lUp = 0
      let rUp = 0
      if (s.status === 'working' && !reduceMotion()) {
        const k = Math.floor(t * 10 + cx)
        lUp = k % 2 ? -1 : 0
        rUp = hash(k) % 2 ? -1 : 0
      }
      this.R(cx - 7, top - 1 + lUp, 3, 2, L.skin)
      if (s.status !== 'thinking') this.R(cx + 4, top - 1 + rUp, 3, 2, L.skin)
    }

    standing(a, t) {
      const seat = this.seats[a.id]
      if (!seat) return
      const L = seat.look
      const R = this.R.bind(this)
      const x = Math.round(a.x)
      const feet = Math.round(a.y)
      const step = a.moving && !reduceMotion() ? Math.floor(t * 9) % 2 : 0
      this.ctx.fillStyle = this.P.shade
      this.ctx.fillRect(x - 6, feet - 1, 12, 2)
      R(x - 4, feet - 8 - step, 3, 7, L.shirtShade)
      R(x + 1, feet - 8 - step, 3, 7 - step, L.shirtShade)
      R(x - 4, feet - 2, 3, 1, '#161626')
      R(x + 1, feet - 2 - step, 3, 1, '#161626')
      const top = feet - 19 - step
      this.torso(L, x, top, feet - 8 - step)
      const swing = a.moving ? (step ? 1 : -1) : 0
      R(x - 8, top + 1 + swing, 2, 7, L.shirtShade)
      R(x + 6, top + 1 - swing, 2, 7, L.shirtShade)
      if (a.carrying) {
        R(x + a.facing * 7 - 2, top + 3, 5, 6, '#fbfbf6')
        R(x + a.facing * 7 - 1, top + 5, 3, 1, '#b9bccb')
      }
      const s = this.st[a.id] || { status: 'idle', doneAt: -99 }
      this.head(L, x, top - 11, s.status === 'meeting' ? s : { status: 'idle', doneAt: -99 }, t, { id: a.id, facing: a.moving ? a.facing : 0 })
      a.headTop = top - 11
    }

    paper(f, t) {
      const k = Math.min(1, (t - f.t) / 0.45)
      const x = f.from[0] + (f.to[0] - f.from[0]) * k
      const y = f.from[1] + (f.to[1] - f.from[1]) * k - Math.sin(k * Math.PI) * 14
      this.R(x - 2, y - 2, 5, 4, '#fbfbf6')
      this.R(x - 1, y - 1, 3, 1, '#b9bccb')
    }

    halo(cx, headTop, t) {
      for (let i = 0; i < 10; i++) {
        const a = t * 2.4 + (i / 10) * Math.PI * 2
        this.ctx.globalAlpha = Math.sin(a) > 0 ? 0.95 : 0.4
        this.R(cx + Math.round(Math.cos(a) * 11), headTop + 2 + Math.round(Math.sin(a) * 3), 1, 1, '#ff9ccd')
      }
      this.ctx.globalAlpha = 1
    }

    sparkles(cx, headTop, t) {
      ;[[-14, -2], [13, 0], [-11, -10], [10, -9]].forEach(([dx, dy], i) => {
        if (Math.sin(t * 9 + i * 1.7) < 0) return
        const c = i % 2 ? '#ffe27a' : '#ffffff'
        this.R(cx + dx, headTop + dy - 1, 1, 3, c)
        this.R(cx + dx - 1, headTop + dy, 3, 1, c)
      })
    }

    spawnCode(id, mx, top, t, L) {
      if (reduceMotion()) return
      if (t - (this.lastSpawn[id] || 0) < 0.6) return
      this.lastSpawn[id] = t
      this.particles.push({ x: mx - 6 + (hash((t * 100) | 0) % 12), y: top - 22, born: t, ch: CODE_GLYPHS[hash((t * 1000) | 0) % CODE_GLYPHS.length], color: L.accent })
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

    nightTint() {
      const g = this.ctx.createLinearGradient(0, 0, 0, H)
      g.addColorStop(0, 'rgba(10,10,40,0.25)')
      g.addColorStop(0.6, 'rgba(10,10,40,0)')
      this.ctx.fillStyle = g
      this.ctx.fillRect(0, 0, this.W, H)
    }

    placeBubbles(t) {
      for (const [id, b] of Object.entries(this.bubbles)) {
        if (b.text && t > b.until) this.say(id, '', { ttl: 0 })
        if (!b.text) continue
        const seat = this.seats[id]
        const a = this.actors.get(id)
        const x = a ? a.x : seat.x
        const y = a ? (a.headTop ?? a.y - 30) - 4 : seat.top - 34
        const p = this.pct(Math.min(Math.max(x, 40), this.W - 40), y)
        b.el.style.left = p.left
        b.el.style.top = p.top
      }
    }
  }

  window.ShaniuOffice = Office
  window.ShaniuOffice.lookFor = lookFor
})()
