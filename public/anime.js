/* 二次元办公室：和像素版同一套接口（setRoster / setAgent / activity / say / setTasks / dispatch / meeting / portrait），
   画面是 SVG，角色来自 chibi.js；名字、组牌和对话气泡是 HTML 叠层。每套皮肤换墙、窗外风景、家具配色和小彩蛋。 */
;(function () {
  'use strict'

  const C = window.NiumaChibi
  const NS = 'http://www.w3.org/2000/svg'
  const H = 304
  const FLOOR_Y = 132
  const BACK = 180 // 后排桌面线
  const FRONT = 270 // 前排桌面线
  const AISLE = 232 // 过道（站着的人脚底）
  const COLW = 100
  const CENTERW = 160
  const MARGIN = 18
  const PODGAP = 16
  const K = 0.22 // 角色设计坐标 → 场景坐标
  const FEET = 110 * K
  const TABLE_Y = 212

  const SKINS = {
    sakura: {
      name: '樱花', dark: false, window: 'sakura', particles: 'petals',
      wall: ['#fff6fa', '#ffe6f0'], wainscot: '#ffd9e8', trim: '#f4b8cf', floor: ['#f8e1cd', '#f0d0b5'], floorLine: '#e5bd9c',
      desk: '#f9e4d4', deskTop: '#fff6ee', deskEdge: '#dcb79c', chair: '#ffafcd', monitor: '#f6f4fc', monitorEdge: '#cdc6e0',
      table: '#fffaf5', tableEdge: '#e2c3ad', rug: '#ffd6e6', frame: '#ffffff', frameEdge: '#efbdd1', boss: '#ffd3e6', bossEdge: '#f08cb8',
      sky: ['#8ed2ff', '#c9ecff', '#fff0f6'], ink: '#6a4a5e', plant: ['#5fbf7f', '#3f9c5f'], pot: '#f5a3a3',
    },
    night: {
      name: '夜班', dark: true, window: 'city', particles: 'stars', lamps: true,
      wall: ['#20244a', '#2c3160'], wainscot: '#252a52', trim: '#434a88', floor: ['#3b3156', '#30284a'], floorLine: '#272042',
      desk: '#5b4b72', deskTop: '#71608c', deskEdge: '#3d3154', chair: '#7a68d8', monitor: '#34375c', monitorEdge: '#1f2140',
      table: '#54496e', tableEdge: '#352c4b', rug: '#3d3870', frame: '#3c416e', frameEdge: '#1e2244', boss: '#7b4a80', bossEdge: '#b86ab8',
      sky: ['#070b2a', '#18205a', '#3a3f86'], ink: '#e8e4ff', plant: ['#3f8a63', '#2c6a4a'], pot: '#8a5a7a',
    },
    neon: {
      name: '赛博霓虹', dark: true, window: 'cyber', particles: 'bits', neon: true,
      wall: ['#120a26', '#1e0f3a'], wainscot: '#180c30', trim: '#ff2fd0', floor: ['#120a28', '#0c061c'], floorLine: '#00e5ff',
      desk: '#1c1438', deskTop: '#2b1e55', deskEdge: '#ff2fd0', chair: '#00c8ff', monitor: '#161030', monitorEdge: '#00e5ff',
      table: '#1d1438', tableEdge: '#00e5ff', rug: '#2e1052', frame: '#2b1650', frameEdge: '#ff2fd0', boss: '#3a1256', bossEdge: '#ff2fd0',
      sky: ['#14042c', '#3d0a60', '#ff2f8f'], ink: '#eafcff', plant: ['#00e5a0', '#00a07a'], pot: '#ff2fd0',
    },
    neko: {
      name: '猫耳咖啡', dark: false, window: 'garden', particles: 'paws', catEars: true, cat: true,
      wall: ['#fff8ec', '#fbead3'], wainscot: '#f4dcbc', trim: '#dcae7e', floor: ['#ebcda6', '#e1c098'], floorLine: '#cda377',
      desk: '#f7e5ca', deskTop: '#fff5e4', deskEdge: '#d4ad82', chair: '#f7b267', monitor: '#fffbf4', monitorEdge: '#dcc6a8',
      table: '#fff6e8', tableEdge: '#d9b78e', rug: '#f8dcbc', frame: '#fffdf8', frameEdge: '#dcae7e', boss: '#ffdcae', bossEdge: '#f2a04a',
      sky: ['#9fe3cc', '#d9f6e8', '#fff9ec'], ink: '#6a4f36', plant: ['#6cbf7a', '#4f9c5c'], pot: '#e89a5a',
    },
  }

  const STATUS = ['idle', 'thinking', 'working', 'meeting', 'walking', 'done', 'error', 'offline']
  const GLYPHS = ['{ }', '</>', '( )', '✓', '=>', '#', ';', '[ ]', '★']
  const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches
  const rnd = (a, b) => a + Math.random() * (b - a)

  function el(tag, attrs = {}, html = '') {
    const e = document.createElementNS(NS, tag)
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
    if (html) e.innerHTML = html
    return e
  }

  class AnimeOffice {
    constructor(scene, overlay, skin = 'sakura') {
      this.scene = scene
      this.overlay = overlay
      this.skinId = SKINS[skin] ? skin : 'sakura'
      this.S = SKINS[this.skinId]
      this.canvas = scene.querySelector('canvas')
      if (this.canvas) this.canvas.style.display = 'none'
      this.svg = el('svg', { class: `anime-svg skin-${this.skinId}`, preserveAspectRatio: 'xMidYMid meet' })
      scene.insertBefore(this.svg, overlay)
      scene.dataset.look = 'anime'
      scene.dataset.skin = this.skinId
      this.roster = { groups: [], employees: [] }
      this.st = { shaniu: { status: 'idle', available: true } }
      this.tasks = []
      this.actors = new Map()
      this.bubbles = {}
      this.seatEls = {}
      this.lastGlyph = {}
      this.meetingOpen = false
      this.t0 = performance.now()
      this.alive = true
      this.setRoster(this.roster)
      const loop = () => {
        if (!this.alive) return
        if (!document.hidden) this.frame(this.now())
        requestAnimationFrame(loop)
      }
      requestAnimationFrame(loop)
    }

    destroy() {
      this.alive = false
      this.svg.remove()
      this.overlay.innerHTML = ''
      if (this.canvas) this.canvas.style.display = ''
      delete this.scene.dataset.look
      delete this.scene.dataset.skin
    }

    now() {
      return (performance.now() - this.t0) / 1000
    }

    look(emp) {
      return C.lookFor(emp, { catEars: !!this.S.catEars })
    }

    portrait(emp) {
      return C.portrait(this.look(emp), this.S.dark ? '#2a2d55' : '#fff4f9')
    }

    // ---- 布局 --------------------------------------------------------------------------------------

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
      const side = Math.max(width(left), width(right), 200)
      this.W = Math.round(2 * MARGIN + 2 * side + CENTERW)
      this.cx = Math.round(this.W / 2)
      let x = MARGIN + side - width(left)
      const place = (p, dir) => {
        p.x = x
        p.w = p.cols * COLW
        p.dir = dir
        x += p.w + PODGAP
      }
      left.forEach((p) => place(p, -1))
      x = this.cx + CENTERW / 2
      right.forEach((p) => place(p, 1))
      this.pods = pods
      this.seats = {}
      this.vacant = []
      for (const p of pods) {
        for (let i = 0; i < p.cols * 2; i++) {
          const col = i % p.cols
          const seat = { x: Math.round(p.x + col * COLW + COLW / 2), top: i < p.cols ? BACK : FRONT, pod: p, side: col < p.cols / 2 ? -1 : 1 }
          const emp = p.emps[i]
          if (emp) this.seats[emp.id] = { ...seat, emp }
          else this.vacant.push(seat)
        }
      }
      this.seats.shaniu = { x: this.cx, top: FRONT, emp: { id: 'shaniu', name: '傻妞' }, boss: true, side: 1 }
      for (const e of this.roster.employees) {
        this.st[e.id] ||= { status: e.available ? 'idle' : 'offline', available: e.available }
        this.st[e.id].available = e.available
      }
      this.scene.style.setProperty('--scene-ratio', `${this.W} / ${H}`)
      this.scene.style.setProperty('--scene-w', this.W)
      this.build()
    }

    pct(x, y) {
      return { left: (x / this.W) * 100 + '%', top: (y / H) * 100 + '%' }
    }

    // ---- 画场景 ------------------------------------------------------------------------------------

    build() {
      const S = this.S
      const W = this.W
      this.svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
      this.svg.innerHTML = `
        <defs>
          <linearGradient id="an-wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${S.wall[0]}"/><stop offset="1" stop-color="${S.wall[1]}"/></linearGradient>
          <linearGradient id="an-floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${S.floor[0]}"/><stop offset="1" stop-color="${S.floor[1]}"/></linearGradient>
          <linearGradient id="an-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${S.sky[0]}"/><stop offset=".6" stop-color="${S.sky[1]}"/><stop offset="1" stop-color="${S.sky[2]}"/></linearGradient>
          <radialGradient id="an-lamp" cx=".5" cy="0" r="1"><stop offset="0" stop-color="#ffd98a" stop-opacity=".55"/><stop offset="1" stop-color="#ffd98a" stop-opacity="0"/></radialGradient>
          <filter id="an-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          <filter id="an-gray"><feColorMatrix type="saturate" values="0.15"/></filter>
          <clipPath id="an-clip"><rect width="${W}" height="${H}"/></clipPath>
        </defs>
        <g clip-path="url(#an-clip)">
          <g class="room">${this.room()}</g>
          <g class="row-back"></g>
          <g class="actors-back"></g>
          <g class="table">${this.tableSvg()}</g>
          <g class="actors-mid"></g>
          <g class="row-front"></g>
          <g class="actors-front"></g>
          <g class="fx"></g>
          <g class="weather">${this.weather()}</g>
        </g>`
      this.layers = {
        back: this.svg.querySelector('.row-back'),
        front: this.svg.querySelector('.row-front'),
        actorsBack: this.svg.querySelector('.actors-back'),
        actorsMid: this.svg.querySelector('.actors-mid'),
        actorsFront: this.svg.querySelector('.actors-front'),
        fx: this.svg.querySelector('.fx'),
      }
      this.seatEls = {}
      for (const v of this.vacant) (v.top === BACK ? this.layers.back : this.layers.front).appendChild(this.vacantSeat(v))
      for (const [id, s] of Object.entries(this.seats)) {
        const g = this.seatSvg(id, s)
        this.seatEls[id] = g
        ;(s.top === BACK ? this.layers.back : this.layers.front).appendChild(g)
        this.applyStatus(id)
      }
      for (const a of this.actors.values()) a.el = null
      this.clockEl = this.svg.querySelector('.clock')
      this.boardEl = this.svg.querySelector('.board-notes')
      this.setTasks(this.rawTasks || [])
      this.buildOverlay()
    }

    room() {
      const S = this.S
      const W = this.W
      let s = `<rect width="${W}" height="${FLOOR_Y}" fill="url(#an-wall)"/>`
      s += `<rect y="${FLOOR_Y - 34}" width="${W}" height="34" fill="${S.wainscot}"/><rect y="${FLOOR_Y - 35}" width="${W}" height="2" fill="${S.trim}" opacity=".8"/>`
      if (S.neon) {
        for (let x = 0; x < W; x += 24) s += `<rect x="${x}" y="0" width="1" height="${FLOOR_Y - 35}" fill="#ff2fd0" opacity=".08"/>`
        s += `<rect y="${FLOOR_Y - 36}" width="${W}" height="2" fill="#ff2fd0" filter="url(#an-glow)" class="neon-strip"/>`
      }
      if (S.particles === 'paws') {
        for (let x = 20; x < W; x += 46) for (let y = 16; y < FLOOR_Y - 40; y += 34) s += this.paw(x + ((y / 34) % 2) * 23, y, '#f1d7b5')
      }
      s += `<rect y="${FLOOR_Y}" width="${W}" height="${H - FLOOR_Y}" fill="url(#an-floor)"/>`
      if (S.neon) {
        for (let y = FLOOR_Y + 10; y < H; y += 14) s += `<rect y="${y}" width="${W}" height="1" fill="${S.floorLine}" opacity=".18"/>`
        for (let i = -20; i <= 20; i++) s += `<path d="M${this.cx + i * 24},${FLOOR_Y} L${this.cx + i * 70},${H}" stroke="${S.floorLine}" stroke-opacity=".14"/>`
      } else {
        for (let y = FLOOR_Y + 12, r = 0; y < H; y += 12, r++) {
          s += `<rect y="${y}" width="${W}" height="1" fill="${S.floorLine}" opacity=".55"/>`
          for (let x = (r % 2) * 40; x < W; x += 80) s += `<rect x="${x}" y="${y - 11}" width="1" height="11" fill="${S.floorLine}" opacity=".35"/>`
        }
      }
      s += `<rect y="${FLOOR_Y}" width="${W}" height="3" fill="#000" opacity=".06"/>`
      // 窗户：左右各一扇
      const winW = Math.min(190, (W - CENTERW) / 2 - 70)
      for (const wx of [MARGIN + 30, W - MARGIN - 30 - winW]) s += this.windowSvg(wx, 20, winW, 70)
      // 钟、白板
      s += `<g class="clock" transform="translate(${this.cx - 58},46)"><circle r="15" fill="${S.frame}" stroke="${S.frameEdge}" stroke-width="3"/><circle r="1.8" fill="${S.ink}"/><path class="hh" d="M0,0 L0,-8" stroke="${S.ink}" stroke-width="2.4" stroke-linecap="round"/><path class="mh" d="M0,0 L0,-12" stroke="${S.ink}" stroke-width="1.6" stroke-linecap="round"/></g>`
      s += `<g transform="translate(${this.cx + 26},22)"><rect width="70" height="54" rx="5" fill="${S.dark ? '#e9e8f6' : '#ffffff'}" stroke="${S.frameEdge}" stroke-width="3"/>
        <text x="11" y="10" font-size="6" fill="#8a8aa6" font-weight="700">待办</text><text x="30" y="10" font-size="6" fill="#8a8aa6" font-weight="700">进行</text><text x="50" y="10" font-size="6" fill="#8a8aa6" font-weight="700">完成</text>
        <path d="M24,6 V50 M46,6 V50" stroke="#dcdcea" stroke-width="1"/><g class="board-notes"></g></g>`
      // 盆栽：靠墙放在组与组之间
      const spots = [MARGIN + 8, W - MARGIN - 8]
      for (const p of this.pods || []) spots.push(p.x - PODGAP / 2)
      for (const x of spots) if (Math.abs(x - this.cx) > CENTERW / 2 + 10) s += this.plant(x, FLOOR_Y + 10)
      if (S.cat) s += this.catTower(MARGIN + 6, FLOOR_Y + 12)
      return s
    }

    windowSvg(x, y, w, h) {
      const S = this.S
      let v = `<g transform="translate(${x},${y})"><rect x="-4" y="-4" width="${w + 8}" height="${h + 8}" rx="8" fill="${S.frame}" stroke="${S.frameEdge}" stroke-width="3"/>`
      v += `<svg x="0" y="0" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="url(#an-sky)"/>`
      if (S.window === 'sakura') {
        v += `<g class="clouds"><ellipse cx="${w * 0.3}" cy="20" rx="22" ry="8" fill="#fff" opacity=".9"/><ellipse cx="${w * 0.36}" cy="16" rx="12" ry="8" fill="#fff" opacity=".9"/><ellipse cx="${w * 0.78}" cy="30" rx="18" ry="6" fill="#fff" opacity=".8"/></g>`
        v += `<path d="M0,${h} Q${w * 0.3},${h - 22} ${w * 0.6},${h - 12} T${w},${h - 16} V${h} Z" fill="#b8e3b0"/>`
        v += `<path d="M${w},0 C${w - 30},14 ${w - 50},10 ${w - 72},30" stroke="#8a5a4a" stroke-width="3" fill="none"/>`
        for (let i = 0; i < 14; i++) v += `<circle cx="${w - 8 - (i * 5.3) % 66}" cy="${6 + ((i * 7) % 26)}" r="${3 + (i % 3)}" fill="${i % 2 ? '#ffc4dc' : '#ffdbe9'}"/>`
      } else if (S.window === 'city') {
        v += `<circle cx="${w * 0.8}" cy="16" r="9" fill="#fff6c9"/><circle cx="${w * 0.8 + 4}" cy="13" r="8" fill="${S.sky[0]}"/>`
        for (let i = 0; i < 16; i++) v += `<circle class="twinkle" style="animation-delay:${(i * 0.37) % 3}s" cx="${(i * 37) % w}" cy="${4 + ((i * 13) % 30)}" r="${0.6 + (i % 3) * 0.4}" fill="#fff"/>`
        let bx = 0
        let i = 0
        while (bx < w) {
          const bw = 12 + ((i * 7) % 14)
          const bh = 18 + ((i * 11) % 26)
          v += `<rect x="${bx}" y="${h - bh}" width="${bw}" height="${bh}" fill="#141a44"/>`
          for (let yy = h - bh + 4; yy < h - 3; yy += 6) for (let xx = bx + 3; xx < bx + bw - 3; xx += 5) if ((xx * 3 + yy * 7 + i) % 4 === 0) v += `<rect x="${xx}" y="${yy}" width="2" height="3" fill="#ffd97a" opacity=".9"/>`
          bx += bw + 2
          i++
        }
      } else if (S.window === 'cyber') {
        let bx = 0
        let i = 0
        while (bx < w) {
          const bw = 10 + ((i * 7) % 16)
          const bh = 22 + ((i * 13) % 34)
          v += `<rect x="${bx}" y="${h - bh}" width="${bw}" height="${bh}" fill="#12051f" stroke="${i % 2 ? '#00e5ff' : '#ff2fd0'}" stroke-opacity=".6" stroke-width="1"/>`
          bx += bw + 3
          i++
        }
        v += `<g class="holo"><rect x="${w * 0.2}" y="10" width="46" height="16" rx="3" fill="none" stroke="#00e5ff" stroke-width="1.5" filter="url(#an-glow)"/><text x="${w * 0.2 + 23}" y="22" text-anchor="middle" font-size="10" font-weight="900" fill="#00e5ff">牛马</text></g>`
        for (let k = 0; k < 8; k++) v += `<rect class="rain" style="animation-delay:${k * 0.3}s" x="${(k * 29) % w}" y="-10" width="1" height="8" fill="#00e5ff" opacity=".7"/>`
      } else if (S.window === 'garden') {
        v += `<ellipse cx="${w * 0.25}" cy="18" rx="16" ry="6" fill="#fff" opacity=".9"/><path d="M0,${h} Q${w * 0.4},${h - 30} ${w},${h - 10} V${h}Z" fill="#8fd49a"/>`
        v += `<rect x="${w * 0.7}" y="${h - 40}" width="5" height="30" fill="#8a6040"/><circle cx="${w * 0.7 + 2}" cy="${h - 44}" r="16" fill="#6cbf7a"/>`
        v += `<path d="M${w * 0.18},${h - 6} q4,-12 8,-2 q4,-10 8,2 q2,6 -8,6 q-10,0 -8,-6Z" fill="#5b4330"/>`
      }
      v += `</svg><path d="M${w / 2},0 V${h} M0,${h / 2} H${w}" stroke="${S.frame}" stroke-width="4"/><rect x="-6" y="${h + 2}" width="${w + 12}" height="5" rx="2" fill="${S.frameEdge}"/></g>`
      return v
    }

    plant(x, y) {
      const [a, b] = this.S.plant
      return `<g transform="translate(${x},${y})"><ellipse cx="0" cy="16" rx="10" ry="3" fill="#000" opacity=".1"/>
        <path d="M-8,4 L8,4 L6,16 L-6,16Z" fill="${this.S.pot}"/><rect x="-9" y="2" width="18" height="4" rx="2" fill="${C.shade(this.S.pot, -0.15)}"/>
        <path d="M0,4 C-14,-6 -16,-18 -8,-26 C-4,-16 -2,-8 0,4Z" fill="${a}"/><path d="M0,4 C14,-8 18,-20 8,-30 C4,-18 2,-8 0,4Z" fill="${b}"/><path d="M0,4 C-2,-12 0,-24 3,-34 C6,-22 4,-10 0,4Z" fill="${a}"/></g>`
    }

    paw(x, y, c) {
      return `<g transform="translate(${x},${y})" fill="${c}"><ellipse cx="0" cy="3" rx="4" ry="3.2"/><circle cx="-4" cy="-2" r="1.6"/><circle cx="-1.4" cy="-4" r="1.6"/><circle cx="1.6" cy="-4" r="1.6"/><circle cx="4.2" cy="-2" r="1.6"/></g>`
    }

    catTower(x, y) {
      return `<g transform="translate(${x + 14},${y})"><rect x="-2" y="-30" width="5" height="44" fill="#caa27a"/><rect x="-14" y="-32" width="28" height="6" rx="3" fill="#f2c28e"/><rect x="-16" y="12" width="32" height="6" rx="3" fill="#f2c28e"/>
        <g class="cat-sit" transform="translate(0,-40)"><ellipse cx="0" cy="0" rx="9" ry="7" fill="#f3a95b"/><circle cx="0" cy="-8" r="6.5" fill="#f3a95b"/><path d="M-6,-12 L-5,-19 L-1,-13Z M6,-12 L5,-19 L1,-13Z" fill="#f3a95b"/><path class="tail" d="M8,2 q10,-2 8,-12" stroke="#f3a95b" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M-3,-8 q1,1 2,0 M1,-8 q1,1 2,0" stroke="#5b4330" stroke-width="1" fill="none"/></g></g>`
    }

    tableSvg() {
      const S = this.S
      const cx = this.cx
      let s = `<g transform="translate(${cx},${TABLE_Y})"><ellipse cx="0" cy="10" rx="66" ry="17" fill="${S.rug}" opacity=".8"/>`
      s += `<rect x="-34" y="2" width="4" height="16" fill="${S.tableEdge}"/><rect x="30" y="2" width="4" height="16" fill="${S.tableEdge}"/>`
      s += `<path d="M-48,0 A48,11 0 0,0 48,0 L48,4 A48,11 0 0,1 -48,4Z" fill="${S.tableEdge}"/><ellipse rx="48" ry="11" fill="${S.table}" stroke="${S.tableEdge}" stroke-width="1.5"/>`
      s += `<g transform="translate(-22,-4)"><rect x="-3" y="-5" width="6" height="7" rx="1.5" fill="#fff" stroke="#c9b9c9"/><path d="M3,-3 q3,0 3,2 q0,2 -3,2" stroke="#c9b9c9" fill="none"/><path class="steam" d="M0,-8 q-2,-3 0,-6 q2,-3 0,-6" stroke="#c9c3d6" stroke-width="1" fill="none" opacity=".8"/></g>`
      s += `<g transform="translate(18,-3)"><rect x="-9" y="-2" width="18" height="3" rx="1" fill="#b9b3cc"/><rect x="-8" y="-12" width="16" height="10" rx="1.5" fill="#dcd8ec" stroke="#a9a2c2"/></g>`
      if (S.cat) {
        s += `<g class="cat-nap" transform="translate(0,-4)"><ellipse cx="0" cy="0" rx="11" ry="5.5" fill="#f3f0ea" stroke="#c9bfae"/><circle cx="-9" cy="-3" r="5" fill="#f3f0ea" stroke="#c9bfae"/><path d="M-13,-6 L-13,-11 L-9,-7Z M-6,-7 L-5,-11 L-3,-6Z" fill="#f3f0ea" stroke="#c9bfae" stroke-width=".8"/><path d="M-11,-3 q1,1 2,0 M-8,-3 q1,1 2,0" stroke="#6a4f36" stroke-width=".8" fill="none"/><path class="tail" d="M10,1 q8,2 9,-5" stroke="#f3f0ea" stroke-width="3" fill="none" stroke-linecap="round"/><text class="zz" x="-6" y="-12" font-size="6" fill="#a98f74">z</text></g>`
      }
      return s + '</g>'
    }

    weather() {
      const S = this.S
      const W = this.W
      let s = ''
      if (S.particles === 'petals' && !reduceMotion()) {
        for (let i = 0; i < 22; i++) {
          const x = (i * 97) % W
          s += `<g class="petal" style="animation-duration:${rnd(9, 15).toFixed(1)}s;animation-delay:-${rnd(0, 14).toFixed(1)}s;--dx:${rnd(40, 120).toFixed(0)}px"><ellipse cx="${x}" cy="-8" rx="3.2" ry="2" fill="${i % 3 ? '#ffc6dc' : '#ffe0ec'}"/></g>`
        }
      }
      if (S.particles === 'stars' && !reduceMotion()) {
        for (let i = 0; i < 10; i++) s += `<circle class="dust" style="animation-delay:-${rnd(0, 8).toFixed(1)}s" cx="${(i * 131) % W}" cy="${rnd(40, 280).toFixed(0)}" r="1" fill="#ffe9a8" opacity=".5"/>`
      }
      return s
    }

    // ---- 工位 --------------------------------------------------------------------------------------

    deskSvg(color, boss) {
      const S = this.S
      const top = boss ? S.boss : S.deskTop
      const edge = boss ? S.bossEdge : S.deskEdge
      let s = `<rect x="-44" y="-4" width="88" height="8" rx="3" fill="${top}" stroke="${edge}" stroke-width="1.2"/>`
      s += `<rect x="-42" y="4" width="84" height="36" rx="2" fill="${boss ? C.shade(S.boss, -0.06) : S.desk}" stroke="${edge}" stroke-width="1.2"/>`
      s += `<rect x="-42" y="4" width="84" height="3" fill="#000" opacity=".07"/>`
      if (boss) s += `<path d="M0,26 c-5,-6 -12,-2 -8,4 l8,7 l8,-7 c4,-6 -3,-10 -8,-4Z" fill="${S.bossEdge}" opacity=".85"/>`
      else s += `<rect x="-40" y="4" width="3" height="36" fill="${color}" opacity=".55"/>`
      return s
    }

    chairSvg(color) {
      const c = this.S.neon ? '#241a46' : C.shade(color, this.S.dark ? -0.35 : 0.55)
      const edge = this.S.neon ? '#00c8ff' : C.shade(color, this.S.dark ? -0.5 : 0.2)
      return `<rect x="-21" y="-58" width="42" height="46" rx="13" fill="${c}" stroke="${edge}" stroke-width="1.5"/><rect x="-15" y="-52" width="30" height="7" rx="3.5" fill="#fff" opacity=".3"/>`
    }

    monitorSvg(side, color) {
      const S = this.S
      const x = side * 31
      return `<g class="monitor" transform="translate(${x},0)">
        <ellipse class="glow" cx="${-side * 10}" cy="-20" rx="20" ry="16" fill="${color}" opacity="0"/>
        <rect x="-3" y="-9" width="6" height="7" fill="${S.monitorEdge}"/><rect x="-10" y="-4" width="20" height="3" rx="1.5" fill="${S.monitorEdge}"/>
        <rect x="-17" y="-34" width="34" height="26" rx="4" fill="${S.monitor}" stroke="${S.monitorEdge}" stroke-width="1.5"/>
        <circle cx="0" cy="-21" r="5" fill="${color}" opacity=".85"/><path d="M-3,-22 q3,-4 6,0" stroke="#fff" stroke-width="1.2" fill="none" opacity=".9"/>
      </g>`
    }

    mugSvg(side) {
      const x = -side * 30
      return `<g transform="translate(${x},-4)"><rect x="-4" y="-7" width="8" height="8" rx="2" fill="#fff" stroke="#cbbdd0"/><path d="M4,-5 q3,0 3,2.5 q0,2.5 -3,2.5" stroke="#cbbdd0" fill="none"/><path class="steam" d="M0,-10 q-2,-3 0,-6 q2,-3 0,-6" stroke="#d6cfe2" stroke-width="1" fill="none"/></g>`
    }

    lampSvg(side) {
      if (!this.S.lamps) return ''
      const x = -side * 32
      return `<g transform="translate(${x},-4)"><path d="M-22,0 L-6,-26 L6,-26 L22,0Z" fill="url(#an-lamp)"/><rect x="-1" y="-24" width="2" height="24" fill="#8a82b0"/><path d="M-7,-24 L7,-24 L4,-30 L-4,-30Z" fill="#ffd98a"/></g>`
    }

    seatSvg(id, s) {
      const emp = s.emp
      const color = s.boss ? '#ff7eb6' : emp.color || s.pod?.g.color || '#8a8aa6'
      const L = this.look(s.boss ? { id: 'shaniu' } : emp)
      const body = C.seated(L)
      const g = el('g', { class: 'seat', 'data-id': id, transform: `translate(${s.x},${s.top})` })
      g.innerHTML = `
        <ellipse cx="0" cy="40" rx="46" ry="5" fill="#000" opacity=".08"/>
        <g class="chair">${this.chairSvg(color)}</g>
        <g class="char" transform="translate(0,6) scale(${K})">${body.main}</g>
        <g class="desk">${this.deskSvg(color, s.boss)}</g>
        ${this.lampSvg(s.side)}
        ${this.monitorSvg(s.side, color)}
        <rect x="-15" y="-6" width="30" height="5" rx="2" fill="${this.S.neon ? '#2a1d55' : '#6f6a88'}" stroke="${this.S.neon ? '#00e5ff' : 'none'}" stroke-width=".8"/>
        ${s.boss ? '' : this.mugSvg(s.side)}
        <g class="hands" transform="translate(0,6) scale(${K})">${body.hands}</g>
        <g class="sweat"><path d="M24,-62 q-4,7 0,10 q4,-3 0,-10Z" fill="#8fd0ff" stroke="#5aa8e0" stroke-width=".8"/></g>
        <g class="gloom"><path d="M-18,-86 q6,-8 12,0 q6,-8 12,0 q6,-8 12,0" stroke="#7b7fa8" stroke-width="2" fill="none" opacity=".6"/></g>
        <g class="zzz"><text x="18" y="-70" font-size="10" font-weight="700" fill="#8f8bb8">Z</text><text x="27" y="-80" font-size="7" font-weight="700" fill="#8f8bb8">z</text></g>`
      return g
    }

    vacantSeat(v) {
      const g = el('g', { class: 'seat vacant', transform: `translate(${v.x},${v.top})` })
      const color = v.pod.g.color || '#8a8aa6'
      g.innerHTML = `<ellipse cx="0" cy="40" rx="46" ry="5" fill="#000" opacity=".06"/><g class="chair" opacity=".7">${this.chairSvg(color)}</g><g class="desk">${this.deskSvg(color)}</g>
        <g transform="translate(0,-4)"><rect x="-14" y="-18" width="28" height="16" rx="3" fill="#fff6c8" stroke="#e0c05a"/><text x="0" y="-7" text-anchor="middle" font-size="7" font-weight="800" fill="#9a7a10">HIRING</text></g>
        ${this.plant(-30, -26).replace('<g ', '<g opacity=".9" ')}`
      return g
    }

    buildOverlay() {
      const keep = this.bubbles
      this.overlay.innerHTML = ''
      const add = (cls, text, x, y, color) => {
        const e = document.createElement('div')
        e.className = cls
        e.textContent = text
        Object.assign(e.style, this.pct(x, y))
        if (color) e.style.setProperty('--c', color)
        this.overlay.appendChild(e)
        return e
      }
      add('sign', '牛马工作室', this.cx, 14)
      for (const p of this.pods) add('pod-sign', p.g.name + (p.g.available ? '' : ' · 未到岗'), p.x + p.w / 2, FLOOR_Y - 42, p.g.color)
      for (const [id, s] of Object.entries(this.seats)) add('tag' + (s.boss ? ' tag-boss' : ''), s.emp.name, s.x, s.top + 22, s.boss ? '' : s.pod.g.color)
      for (const v of this.vacant) add('tag tag-vacant', '招人中', v.x, v.top + 22)
      this.bubbles = {}
      for (const id of Object.keys(this.seats)) {
        const e = document.createElement('div')
        e.className = 'speech hide'
        e.dataset.id = id
        this.overlay.appendChild(e)
        const prev = keep[id]
        this.bubbles[id] = { el: e, text: '', until: 0, kind: '' }
        if (prev && prev.text) this.say(id, prev.text, { kind: prev.kind, ttl: Math.max(0, (prev.until - this.now()) * 1000) })
      }
    }

    // ---- 对外接口 ----------------------------------------------------------------------------------

    setAgent(id, info) {
      const s = (this.st[id] ||= { status: 'idle', available: true })
      const prev = s.status
      if (info.available !== undefined) s.available = !!info.available
      if (info.status && info.status !== prev) {
        s.status = info.status
        if (info.status === 'done') s.doneAt = this.now()
      }
      this.applyStatus(id)
      if (info.status === 'done' && prev !== 'done') this.sparkle(id)
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

    applyStatus(id) {
      const g = this.seatEls[id]
      if (!g) return
      const s = this.st[id] || {}
      let status = s.available === false ? 'offline' : s.status || 'idle'
      if (status === 'done' && this.now() - (s.doneAt ?? -99) > 3.5) status = 'idle'
      for (const x of STATUS) g.classList.toggle(`st-${x}`, x === status)
      g.classList.toggle('away', this.actors.has(id))
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
      this.rawTasks = tasks
      this.tasks = tasks.map((t) => ({ agent: t.agent, status: t.status, kind: t.kind }))
      if (!this.boardEl) return
      const cols = { pending: 0, running: 1, done: 2 }
      const count = [0, 0, 0]
      let s = ''
      for (const t of this.tasks) {
        const c = cols[t.status]
        if (c === undefined || count[c] >= 6) continue
        const i = count[c]++
        const color = this.roster.employees.find((e) => e.id === t.agent)?.color || '#ffd66b'
        s += `<rect x="${4 + c * 22 + (i % 2) * 9}" y="${14 + Math.floor(i / 2) * 11}" width="8" height="8" rx="1.5" fill="${c === 2 ? '#bde8c6' : C.shade(color, 0.55)}" stroke="${C.shade(color, -0.1)}" stroke-width=".6"/>`
      }
      this.boardEl.innerHTML = s
    }

    /** 傻妞起身把任务单送到工位上。 */
    dispatch(to) {
      const seat = this.seats[to]
      if (!seat) return
      const a = this.actor('shaniu')
      const stand = seat.x + (seat.x < this.cx ? 22 : -22)
      a.queue.push(
        { to: [[stand, AISLE]], carrying: true },
        {
          hold: 0.6,
          arrive: () => {
            a.facing = seat.x < a.x ? -1 : 1
            this.say('shaniu', `${seat.emp.name}，交给你啦`, { ttl: 1400 })
            this.flyPaper(a.x + a.facing * 16, AISLE - 40, seat.x, seat.top - 6)
          },
        },
        { to: [[this.cx, AISLE]] },
      )
    }

    meeting(m) {
      if (!m) {
        this.meetingOpen = false
        return
      }
      if (m.status === 'open' && !this.meetingOpen) {
        this.meetingOpen = true
        const cx = this.cx
        const spots = [
          [cx - 62, TABLE_Y + 12],
          [cx + 62, TABLE_Y + 12],
          [cx - 30, TABLE_Y - 12],
          [cx + 30, TABLE_Y - 12],
          [cx - 56, TABLE_Y - 4],
          [cx + 56, TABLE_Y - 4],
        ]
        const people = m.attendees.filter((id) => this.seats[id])
        people.forEach((id, i) => {
          const seat = this.seats[id]
          const [sx, sy] = spots[i % spots.length]
          const a = this.actor(id, [seat.x, AISLE])
          a.queue.push({ to: [[sx, AISLE], [sx, sy]], wait: () => !this.meetingOpen, face: sx < cx ? 1 : -1 }, { to: [[sx, AISLE], [seat.x, AISLE]] })
        })
        const boss = this.actor('shaniu')
        boss.queue.push({ to: [[cx, AISLE], [cx, TABLE_Y - 16]], wait: () => !this.meetingOpen, face: 1 }, { to: [[cx, AISLE]] })
      } else if (m.status === 'closed') this.meetingOpen = false
    }

    actor(id, from) {
      let a = this.actors.get(id)
      if (!a) {
        const seat = this.seats[id]
        const [x, y] = from || [seat.x, AISLE]
        a = { id, x, y, queue: [], cur: null, facing: 1, el: null }
        this.actors.set(id, a)
        this.applyStatus(id)
      }
      return a
    }

    // ---- 动画 --------------------------------------------------------------------------------------

    frame(t) {
      const dt = Math.min(0.1, t - (this.lastT || t))
      this.lastT = t
      this.stepActors(t, dt)
      this.drawActors(t)
      this.effects(t)
      if (!this.lastClock || t - this.lastClock > 1) {
        this.lastClock = t
        this.tickClock()
        for (const id of Object.keys(this.seatEls)) if (this.st[id]?.status === 'done') this.applyStatus(id)
      }
      this.placeBubbles(t)
    }

    stepActors(t, dt) {
      const speed = reduceMotion() ? 3000 : 110
      for (const a of [...this.actors.values()]) {
        if (!a.cur) {
          a.cur = a.queue.shift() || null
          if (!a.cur) {
            a.el?.remove()
            this.actors.delete(a.id)
            this.applyStatus(a.id)
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
          if (c.face !== undefined && c.face !== 0) a.facing = c.face
          c.arrive?.()
        }
        const holding = (c.hold && t - c.since < c.hold) || (c.wait && !c.wait())
        if (!holding) a.cur = null
      }
    }

    drawActors(t) {
      for (const a of this.actors.values()) {
        if (!a.el) {
          const s = this.seats[a.id]
          const L = this.look(s?.boss ? { id: 'shaniu' } : s?.emp)
          a.el = el('g', { class: 'actor' })
          a.el.innerHTML = `<ellipse class="shadow" cx="0" cy="0" rx="16" ry="4" fill="#000" opacity=".12"/><g class="fig">${C.standing(L)}</g>`
          this.applyStatus(a.id)
        }
        const layer = a.y < TABLE_Y + 2 ? this.layers.actorsBack : a.y <= AISLE + 1 ? this.layers.actorsMid : this.layers.actorsFront
        if (a.el.parentNode !== layer) layer.appendChild(a.el)
        const st = this.st[a.id]?.status
        a.el.setAttribute('class', `actor${a.moving ? ' walking' : ''}${a.carrying ? ' carrying' : ''} st-${a.moving ? 'walk' : st === 'meeting' ? 'meeting' : 'idle'}`)
        const bob = a.moving ? Math.abs(Math.sin(t * 12)) * 1.6 : 0
        a.el.setAttribute('transform', `translate(${a.x.toFixed(1)},${a.y.toFixed(1)})`)
        a.el.querySelector('.fig').setAttribute('transform', `translate(0,${(-FEET - bob).toFixed(1)}) scale(${K * a.facing},${K})`)
      }
    }

    effects(t) {
      if (reduceMotion()) return
      for (const [id, s] of Object.entries(this.seats)) {
        if (this.st[id]?.status !== 'working' || this.actors.has(id)) continue
        if (t - (this.lastGlyph[id] || 0) < 0.9) continue
        this.lastGlyph[id] = t + Math.random() * 0.4
        const x = s.x + s.side * 31 + rnd(-8, 8)
        const color = s.boss ? '#ff7eb6' : s.emp.color || '#8a8aa6'
        const g = el('text', { class: 'glyph', x: x.toFixed(1), y: s.top - 38, 'text-anchor': 'middle', 'font-size': 8, 'font-weight': 800, fill: this.S.neon ? '#00e5ff' : C.shade(color, -0.1) })
        g.textContent = GLYPHS[(Math.random() * GLYPHS.length) | 0]
        this.layers.fx.appendChild(g)
        setTimeout(() => g.remove(), 1700)
      }
    }

    sparkle(id) {
      const s = this.seats[id]
      if (!s || reduceMotion()) return
      for (let i = 0; i < 5; i++) {
        const x = s.x + rnd(-30, 30)
        const y = s.top - rnd(56, 90)
        const g = el('path', { class: 'spark', d: `M${x},${y - 5} L${x + 1.4},${y - 1.4} L${x + 5},${y} L${x + 1.4},${y + 1.4} L${x},${y + 5} L${x - 1.4},${y + 1.4} L${x - 5},${y} L${x - 1.4},${y - 1.4}Z`, fill: i % 2 ? '#ffd94a' : '#ff8fc3', style: `animation-delay:${i * 0.12}s` })
        this.layers.fx.appendChild(g)
        setTimeout(() => g.remove(), 2200)
      }
    }

    flyPaper(x1, y1, x2, y2) {
      const g = el('g', { class: 'fly' }, `<rect x="-6" y="-7" width="12" height="15" rx="1.5" fill="#fff" stroke="#b9b3c6"/><path d="M-3,-3 h6 M-3,0 h6 M-3,3 h4" stroke="#c9c3d6"/>`)
      this.layers.fx.appendChild(g)
      const t0 = performance.now()
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / 450)
        const x = x1 + (x2 - x1) * k
        const y = y1 + (y2 - y1) * k - Math.sin(k * Math.PI) * 26
        g.setAttribute('transform', `translate(${x},${y}) rotate(${k * 360})`)
        if (k < 1) requestAnimationFrame(step)
        else g.remove()
      }
      step()
    }

    tickClock() {
      if (!this.clockEl) return
      const d = new Date()
      const m = d.getMinutes() + d.getSeconds() / 60
      const h = (d.getHours() % 12) + m / 60
      this.clockEl.querySelector('.hh').setAttribute('transform', `rotate(${h * 30})`)
      this.clockEl.querySelector('.mh').setAttribute('transform', `rotate(${m * 6})`)
    }

    placeBubbles(t) {
      for (const [id, b] of Object.entries(this.bubbles)) {
        if (b.text && t > b.until) this.say(id, '', { ttl: 0 })
        if (!b.text) continue
        const seat = this.seats[id]
        const a = this.actors.get(id)
        const x = a ? a.x : seat.x
        const y = a ? a.y - FEET - 78 : seat.top - 80
        const p = this.pct(Math.min(Math.max(x, 60), this.W - 60), y)
        b.el.style.left = p.left
        b.el.style.top = p.top
      }
    }
  }

  AnimeOffice.SKINS = Object.fromEntries(Object.entries(SKINS).map(([id, s]) => [id, { name: s.name, dark: s.dark }]))
  window.AnimeOffice = AnimeOffice
})()
