/* Q 版二次元角色：纯 SVG 拼出来的小人（发型、发色、瞳色、配饰、表情、坐姿和站姿）。
   设计坐标系：原点在腰部正中，向上为负；头部中心约在 (0,-200)。放进场景时统一缩放。 */
;(function () {
  'use strict'

  let uid = 0

  function hash(n) {
    n = (n ^ 61) ^ (n >>> 16)
    n = n + (n << 3)
    n = n ^ (n >>> 4)
    n = Math.imul(n, 0x27d4eb2d)
    return (n ^ (n >>> 15)) >>> 0
  }
  const strHash = (s) => [...String(s)].reduce((h, c) => hash(h + c.charCodeAt(0)), 7)

  // 认 #rgb、#rrggbb(aa)、rgb()/rgba()；自制皮肤里别的写法（颜色名、hsl）就原样返回。
  function toRgb(c) {
    const s = String(c).trim()
    let m = s.match(/^#([0-9a-f]{3,8})$/i)
    if (m) {
      const h = m[1].length <= 4 ? m[1].slice(0, 3).split('').map((x) => x + x).join('') : m[1].slice(0, 6)
      const n = parseInt(h, 16)
      return [n >> 16, (n >> 8) & 255, n & 255]
    }
    m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i)
    return m ? [+m[1], +m[2], +m[3]] : null
  }

  function shade(color, amt) {
    const rgb = toRgb(color)
    if (!rgb) return color
    const f = (v) => Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)))
    return '#' + rgb.map((v) => f(v).toString(16).padStart(2, '0')).join('')
  }

  const SKINS = ['#ffe7d9', '#fcdcc8', '#f6d0b8', '#ecc0a0']
  const HAIRS = ['#2e2638', '#5b3a2e', '#8c5536', '#e8c27a', '#f19bbd', '#6f8fe3', '#c9cde0', '#8e6fd6', '#58b39a', '#3b4a6b']
  const EYES = ['#3f74e0', '#8a4fd6', '#2f9e7a', '#d0506f', '#9a6034', '#e0892a', '#34a3cf', '#6a5acd']
  const STYLES = ['bob', 'short', 'long', 'side', 'twintail', 'spiky', 'ponytail']
  const INK = '#2b2233'

  // 傻妞：黑长直，粉色发箍和两只小传感器耳朵，粉色水手服。
  const SHANIU = {
    id: 'shaniu', skin: '#ffe7da', hair: '#2a2235', eye: '#e0508f', style: 'long', outfit: '#ff7eb6', collar: '#ffffff',
    ribbon: '#e0306e', acc: 'sensors', sailor: true,
  }

  // 内置岗位的配饰对应一套设计好的发型发色，默认团队看起来更协调；其他人按 id 随机。
  const PRESETS = {
    helmet: { style: 'short', hair: '#5b3a2e', eye: '#9a6034' },
    beret: { style: 'twintail', hair: '#8c5536', eye: '#3f74e0' },
    glasses: { style: 'side', hair: '#2e2638', eye: '#34a3cf' },
    headphones: { style: 'bob', hair: '#f19bbd', eye: '#8a4fd6' },
    cap: { style: 'ponytail', hair: '#e8c27a', eye: '#2f9e7a' },
    bandana: { style: 'spiky', hair: '#58b39a', eye: '#e0892a' },
    bun: { style: 'bob', hair: '#6f8fe3', eye: '#d0506f' },
  }

  /** 每位员工的长相由 id 决定，衣服颜色跟所在项目组走。 */
  function lookFor(emp, opts = {}) {
    if (!emp || emp.id === 'shaniu') return { ...SHANIU, catEars: !!opts.catEars }
    const h = strHash(emp.id)
    const pick = (list, salt) => list[hash(h + salt) % list.length]
    const accent = emp.color || '#6b7a99'
    const preset = PRESETS[emp.look] && !opts.random ? PRESETS[emp.look] : {}
    return {
      id: emp.id,
      skin: pick(SKINS, 404),
      hair: preset.hair || pick(HAIRS, 202),
      eye: preset.eye || pick(EYES, 303),
      style: preset.style || pick(STYLES, 101),
      outfit: accent,
      collar: '#ffffff',
      ribbon: shade(accent, -0.35),
      acc: emp.look || 'none',
      catEars: !!opts.catEars,
    }
  }

  // ---- 头发 ------------------------------------------------------------------------------------

  const HAIR = {
    bob: {
      back: 'M-104,-200 C-110,-290 -60,-328 0,-328 C60,-328 110,-290 104,-200 C104,-160 102,-132 96,-112 Q82,-100 68,-118 L-68,-118 Q-82,-100 -96,-112 C-102,-132 -104,-160 -104,-200Z',
      front: 'M-100,-206 C-104,-284 -56,-318 0,-318 C56,-318 104,-284 100,-206 L90,-210 L80,-236 L68,-206 L54,-242 L38,-208 L20,-246 L4,-210 L-14,-248 L-30,-208 L-48,-242 L-62,-206 L-76,-236 L-88,-210Z',
      side: 'M-100,-206 C-106,-170 -100,-136 -88,-114 L-78,-138 C-82,-160 -82,-186 -80,-210Z',
    },
    long: {
      back: 'M-104,-205 C-112,-292 -60,-332 0,-332 C60,-332 112,-292 104,-205 C108,-140 118,-60 114,24 Q60,40 0,28 Q-60,40 -114,24 C-118,-60 -108,-140 -104,-205Z',
      front: 'M-100,-205 C-104,-286 -56,-322 0,-322 C56,-322 104,-286 100,-205 L92,-200 C86,-230 72,-252 50,-264 C58,-242 56,-222 46,-206 C38,-236 18,-258 -8,-268 C2,-248 -2,-228 -14,-208 C-24,-236 -46,-252 -68,-256 C-58,-236 -62,-220 -72,-204 C-80,-222 -86,-230 -92,-208Z',
      side: 'M-100,-205 C-108,-150 -104,-96 -94,-62 L-84,-92 C-86,-140 -84,-182 -82,-210Z',
    },
    short: {
      back: 'M-100,-205 C-106,-292 -58,-326 0,-326 C58,-326 106,-292 100,-205 C100,-180 96,-162 90,-152 L-90,-152 C-96,-162 -100,-180 -100,-205Z',
      front: 'M-98,-206 C-102,-286 -54,-318 0,-318 C54,-318 102,-286 98,-206 L88,-214 L80,-240 L64,-214 L54,-250 L36,-214 L24,-254 L6,-216 L-10,-252 L-24,-214 L-42,-248 L-56,-212 L-72,-240 L-86,-210Z',
      side: 'M-98,-206 C-102,-188 -100,-172 -94,-160 L-86,-176 C-88,-190 -88,-200 -86,-210Z',
    },
    side: {
      back: 'M-100,-205 C-106,-292 -58,-326 0,-326 C58,-326 106,-292 100,-205 C100,-176 96,-156 90,-146 L-90,-146 C-96,-156 -100,-176 -100,-205Z',
      front: 'M-98,-206 C-102,-286 -54,-318 0,-318 C54,-318 102,-286 98,-206 L90,-214 C74,-250 36,-272 -16,-276 C12,-260 22,-242 20,-222 C-8,-250 -48,-260 -84,-254 C-70,-240 -66,-224 -70,-208 L-86,-212Z',
      side: 'M-98,-206 C-102,-184 -100,-164 -92,-150 L-84,-170 C-86,-186 -86,-198 -84,-210Z',
    },
    spiky: {
      back: 'M-100,-205 L-116,-236 L-100,-252 C-112,-290 -92,-310 -70,-312 L-64,-340 L-30,-322 L-4,-348 L18,-322 L52,-338 L62,-306 C92,-300 110,-282 104,-252 L118,-236 L100,-205 C100,-180 96,-162 90,-152 L-90,-152 C-96,-162 -100,-180 -100,-205Z',
      front: 'M-98,-206 C-102,-286 -54,-318 0,-318 C54,-318 102,-286 98,-206 L90,-212 L86,-246 L68,-214 L60,-262 L38,-216 L26,-266 L6,-218 L-10,-264 L-26,-216 L-46,-260 L-58,-214 L-78,-248 L-88,-210Z',
      side: 'M-98,-206 C-104,-186 -102,-170 -96,-156 L-86,-178 C-88,-192 -88,-200 -86,-210Z',
    },
    twintail: {
      back: 'M-104,-200 C-110,-290 -60,-328 0,-328 C60,-328 110,-290 104,-200 C104,-168 102,-146 96,-132 L-96,-132 C-102,-146 -104,-168 -104,-200Z',
      front: 'M-100,-206 C-104,-284 -56,-318 0,-318 C56,-318 104,-284 100,-206 L88,-210 L76,-232 L64,-206 L50,-240 L34,-208 L16,-244 L0,-210 L-16,-244 L-34,-208 L-50,-240 L-64,-206 L-76,-232 L-88,-210Z',
      side: 'M-100,-206 C-106,-176 -100,-150 -90,-132 L-80,-152 C-84,-172 -82,-192 -80,-210Z',
      tails: 'M-96,-262 C-156,-272 -176,-196 -162,-120 C-152,-70 -166,-30 -144,4 C-128,-40 -118,-104 -114,-168 C-110,-212 -104,-242 -96,-262Z',
    },
    ponytail: {
      back: 'M-100,-205 C-106,-292 -58,-326 0,-326 C58,-326 106,-292 100,-205 C100,-176 98,-156 92,-140 L-92,-140 C-98,-156 -100,-176 -100,-205Z',
      front: 'M-100,-206 C-104,-284 -56,-318 0,-318 C56,-318 104,-284 100,-206 L92,-210 C80,-240 50,-256 20,-260 C34,-246 36,-228 30,-212 C12,-238 -20,-250 -52,-248 C-40,-236 -40,-220 -46,-206 C-60,-222 -78,-230 -90,-210Z',
      side: 'M-100,-206 C-106,-178 -102,-154 -92,-136 L-82,-156 C-86,-176 -84,-194 -82,-210Z',
      tail: 'M70,-300 C140,-304 164,-226 150,-150 C142,-100 150,-58 132,-26 C118,-66 108,-118 100,-170 C94,-212 84,-262 70,-300Z',
    },
  }

  const mirror = (d) => d.replace(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g, (_, x, y) => `${-Number(x)},${y}`)

  function hairBack(L) {
    const H = HAIR[L.style] || HAIR.bob
    const line = shade(L.hair, -0.5)
    let s = ''
    if (H.tails) s += `<path d="${H.tails}" fill="${L.hair}" stroke="${line}" stroke-width="4"/><path d="${mirror(H.tails)}" fill="${L.hair}" stroke="${line}" stroke-width="4"/>`
    if (H.tail) s += `<path d="${H.tail}" fill="${L.hair}" stroke="${line}" stroke-width="4"/>`
    s += `<path d="${H.back}" fill="${shade(L.hair, -0.12)}" stroke="${line}" stroke-width="4"/>`
    return s
  }

  function hairFront(L) {
    const H = HAIR[L.style] || HAIR.bob
    const line = shade(L.hair, -0.5)
    const hi = shade(L.hair, 0.45)
    let s = `<path d="${H.side}" fill="${L.hair}" stroke="${line}" stroke-width="4"/><path d="${mirror(H.side)}" fill="${L.hair}" stroke="${line}" stroke-width="4"/>`
    s += `<path d="${H.front}" fill="${L.hair}" stroke="${line}" stroke-width="4" stroke-linejoin="round"/>`
    // 天使环高光
    s += `<path d="M-62,-290 Q-30,-304 -4,-300" stroke="${hi}" stroke-width="9" fill="none" stroke-linecap="round" opacity=".75"/>`
    s += `<path d="M18,-300 Q44,-298 62,-286" stroke="${hi}" stroke-width="9" fill="none" stroke-linecap="round" opacity=".75"/>`
    if (H.tails) {
      const tie = L.ribbon || '#ff6fa8'
      s += `<circle cx="-100" cy="-262" r="13" fill="${tie}" stroke="${shade(tie, -0.4)}" stroke-width="3"/><circle cx="100" cy="-262" r="13" fill="${tie}" stroke="${shade(tie, -0.4)}" stroke-width="3"/>`
    }
    return s
  }

  // ---- 脸 ----------------------------------------------------------------------------------------

  function face(L, ids) {
    const line = shade(L.skin, -0.32)
    let s = `<ellipse cx="-86" cy="-192" rx="13" ry="19" fill="${L.skin}" stroke="${line}" stroke-width="4"/><ellipse cx="86" cy="-192" rx="13" ry="19" fill="${L.skin}" stroke="${line}" stroke-width="4"/>`
    s += `<path d="M-86,-205 C-88,-262 -48,-292 0,-292 C48,-292 88,-262 86,-205 C84,-160 54,-124 0,-118 C-54,-124 -84,-160 -86,-205Z" fill="url(#${ids.skin})" stroke="${line}" stroke-width="4"/>`
    // 腮红
    s += `<ellipse cx="-56" cy="-150" rx="17" ry="9" fill="#ff7f9e" opacity=".38"/><ellipse cx="56" cy="-150" rx="17" ry="9" fill="#ff7f9e" opacity=".38"/>`
    s += `<g class="blush-lines" stroke="#ff6a8e" stroke-width="3" opacity=".55"><path d="M-66,-152 l6,-8 M-56,-152 l6,-8 M-46,-152 l6,-8"/><path d="M46,-152 l6,-8 M56,-152 l6,-8 M66,-152 l6,-8"/></g>`
    s += `<path d="M-2,-160 q3,4 5,1" stroke="${line}" stroke-width="3" fill="none" stroke-linecap="round"/>`
    return s
  }

  function eye(cx, L, ids) {
    const o = cx < 0 ? -1 : 1 // 外眼角方向
    return `<g class="eye">
      <ellipse cx="${cx}" cy="-176" rx="23" ry="29" fill="#fff"/>
      <ellipse cx="${cx}" cy="-172" rx="20" ry="25" fill="url(#${ids.iris})"/>
      <ellipse class="pupil" cx="${cx}" cy="-170" rx="9" ry="13" fill="${shade(L.eye, -0.65)}"/>
      <circle cx="${cx - 8}" cy="-186" r="8.5" fill="#fff"/>
      <circle cx="${cx + 8}" cy="-160" r="4" fill="#fff" opacity=".9"/>
      <path d="M${cx - 27 * o},-189 Q${cx - 6 * o},-214 ${cx + 26 * o},-195" stroke="${INK}" stroke-width="8" fill="none" stroke-linecap="round"/>
      <path d="M${cx + 24 * o},-195 l${10 * o},-7" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>
      <path d="M${cx - 12},-146 q${12},4 ${22},0" stroke="${INK}" stroke-width="3" fill="none" opacity=".35" stroke-linecap="round"/>
    </g>`
  }

  function eyes(L, ids) {
    const brow = shade(L.hair, -0.35)
    return `
    <g class="eyes-open">${eye(-38, L, ids)}${eye(38, L, ids)}</g>
    <g class="eyes-happy" stroke="${INK}" stroke-width="8" fill="none" stroke-linecap="round">
      <path d="M-58,-168 Q-38,-196 -18,-168"/><path d="M18,-168 Q38,-196 58,-168"/>
    </g>
    <g class="eyes-cross" stroke="${INK}" stroke-width="8" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <path d="M-56,-192 L-26,-176 L-56,-160"/><path d="M56,-192 L26,-176 L56,-160"/>
    </g>
    <g class="eyes-sleep" stroke="${INK}" stroke-width="7" fill="none" stroke-linecap="round">
      <path d="M-58,-172 Q-38,-160 -18,-172"/><path d="M18,-172 Q38,-160 58,-172"/>
    </g>
    <g class="brows" stroke="${brow}" stroke-width="6" fill="none" stroke-linecap="round" opacity=".85">
      <path class="brow-l" d="M-56,-226 Q-40,-234 -22,-228"/><path class="brow-r" d="M22,-228 Q40,-234 56,-226"/>
    </g>`
  }

  function mouth() {
    return `
    <path class="mouth-smile" d="M-12,-140 Q0,-130 12,-140" stroke="#b8475c" stroke-width="5" fill="none" stroke-linecap="round"/>
    <g class="mouth-open"><path d="M-17,-145 Q0,-118 17,-145Z" fill="#c9465f" stroke="#9e2f46" stroke-width="3" stroke-linejoin="round"/><path d="M-8,-132 Q0,-124 8,-132Z" fill="#ff8fa6"/></g>
    <path class="mouth-o" d="M-7,-138 a7,8 0 1,0 14,0 a7,8 0 1,0 -14,0" fill="#c9465f"/>
    <path class="mouth-wave" d="M-16,-138 q4,-6 8,0 t8,0 t8,0" stroke="#8e3a52" stroke-width="4" fill="none" stroke-linecap="round"/>`
  }

  // ---- 配饰 --------------------------------------------------------------------------------------

  function catEars(L) {
    const line = shade(L.hair, -0.5)
    const one = (m) => `<path d="${m('M-80,-276 L-98,-364 L-26,-310Z')}" fill="${L.hair}" stroke="${line}" stroke-width="4" stroke-linejoin="round"/><path d="${m('M-74,-290 L-86,-340 L-44,-310Z')}" fill="#ffb3c8"/>`
    return one((d) => d) + one(mirror)
  }

  function accessory(L, color) {
    const c = color || L.outfit
    switch (L.acc) {
      case 'glasses':
        return `<g fill="rgba(255,255,255,.16)" stroke="#3a3346" stroke-width="6"><rect x="-70" y="-208" width="62" height="52" rx="18"/><rect x="8" y="-208" width="62" height="52" rx="18"/><path d="M-8,-188 Q0,-194 8,-188" fill="none"/></g>`
      case 'headphones':
        return `<path d="M-106,-196 C-112,-338 112,-338 106,-196" stroke="#3b3a4a" stroke-width="16" fill="none" stroke-linecap="round"/>
          <rect x="-126" y="-226" width="32" height="64" rx="13" fill="${c}" stroke="${shade(c, -0.45)}" stroke-width="5"/>
          <rect x="94" y="-226" width="32" height="64" rx="13" fill="${c}" stroke="${shade(c, -0.45)}" stroke-width="5"/>`
      case 'cap':
        return `<path d="M-98,-250 C-98,-336 98,-336 98,-250Z" fill="${c}" stroke="${shade(c, -0.45)}" stroke-width="5"/>
          <path d="M-46,-254 Q64,-266 146,-238 Q96,-226 -46,-240Z" fill="${shade(c, -0.22)}" stroke="${shade(c, -0.5)}" stroke-width="4"/>
          <circle cx="0" cy="-332" r="9" fill="${shade(c, -0.25)}"/>`
      case 'beret':
        return `<ellipse cx="-16" cy="-304" rx="98" ry="34" transform="rotate(-10 -16 -304)" fill="#c0445a" stroke="#8a2c3d" stroke-width="5"/><rect x="-24" y="-346" width="12" height="16" rx="5" fill="#8a2c3d"/>`
      case 'helmet':
        return `<path d="M-100,-250 C-100,-356 100,-356 100,-250Z" fill="#f7c948" stroke="#b98a16" stroke-width="5"/>
          <rect x="-118" y="-258" width="236" height="20" rx="10" fill="#f0b82a" stroke="#b98a16" stroke-width="4"/>
          <rect x="-11" y="-348" width="22" height="92" rx="9" fill="#ffe07a"/>`
      case 'bandana':
        return `<path d="M-102,-248 Q0,-274 102,-248 L102,-222 Q0,-248 -102,-222Z" fill="#e0504f" stroke="#a33434" stroke-width="4"/>
          <path d="M98,-242 l44,-22 l-6,30Z" fill="#cf4242" stroke="#a33434" stroke-width="3"/><path d="M98,-232 l38,24 l-32,6Z" fill="#cf4242" stroke="#a33434" stroke-width="3"/>`
      case 'sensors':
        return `<path d="M-102,-230 C-98,-326 98,-326 102,-230" stroke="#ff7eb6" stroke-width="15" fill="none" stroke-linecap="round"/>
          <path d="M-110,-240 L-132,-300" stroke="#e0508f" stroke-width="6" stroke-linecap="round"/><circle cx="-134" cy="-306" r="11" fill="#ff7eb6" stroke="#e0508f" stroke-width="4"/>
          <path d="M110,-240 L132,-300" stroke="#e0508f" stroke-width="6" stroke-linecap="round"/><circle cx="134" cy="-306" r="11" fill="#ff7eb6" stroke="#e0508f" stroke-width="4"/>
          <ellipse cx="-104" cy="-208" rx="22" ry="32" fill="#fff" stroke="#e0508f" stroke-width="5"/><circle cx="-104" cy="-208" r="10" fill="#ff7eb6"/>
          <ellipse cx="104" cy="-208" rx="22" ry="32" fill="#fff" stroke="#e0508f" stroke-width="5"/><circle cx="104" cy="-208" r="10" fill="#ff7eb6"/>`
      default:
        return ''
    }
  }

  function bun(L) {
    if (L.acc !== 'bun') return ''
    return `<circle cx="0" cy="-334" r="40" fill="${L.hair}" stroke="${shade(L.hair, -0.5)}" stroke-width="4"/><path d="M-30,-306 Q0,-296 30,-306" stroke="${L.ribbon || '#ff6fa8'}" stroke-width="9" fill="none" stroke-linecap="round"/>`
  }

  // ---- 身体 --------------------------------------------------------------------------------------

  function defs(L, ids) {
    return `<defs>
      <linearGradient id="${ids.iris}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(L.eye, -0.45)}"/><stop offset=".55" stop-color="${L.eye}"/><stop offset="1" stop-color="${shade(L.eye, 0.55)}"/></linearGradient>
      <radialGradient id="${ids.skin}" cx=".5" cy=".42" r=".62"><stop offset="0" stop-color="${shade(L.skin, 0.35)}"/><stop offset="1" stop-color="${L.skin}"/></radialGradient>
    </defs>`
  }

  function torso(L) {
    const line = shade(L.outfit, -0.4)
    let s = `<rect x="-16" y="-132" width="32" height="26" fill="${shade(L.skin, -0.1)}"/>`
    s += `<path d="M-50,-116 C-70,-112 -78,-96 -80,-70 L-84,12 L84,12 L80,-70 C78,-96 70,-112 50,-116Z" fill="${L.outfit}" stroke="${line}" stroke-width="4"/>`
    if (L.sailor) {
      s += `<path d="M-50,-116 L-78,-78 L0,-54 L78,-78 L50,-116 L22,-116 L0,-88 L-22,-116Z" fill="${L.collar}" stroke="${shade(L.outfit, -0.3)}" stroke-width="3" stroke-linejoin="round"/>`
      s += `<path d="M-66,-86 L0,-64 L66,-86" stroke="${L.outfit}" stroke-width="5" fill="none"/>`
      s += `<path d="M0,-80 l-22,-12 l0,24Z M0,-80 l22,-12 l0,24Z" fill="${L.ribbon}"/><circle cx="0" cy="-80" r="7" fill="${shade(L.ribbon, -0.2)}"/>`
    } else {
      s += `<path d="M-28,-118 L0,-84 L28,-118 L16,-122 L0,-102 L-16,-122Z" fill="${L.collar}" stroke="${shade(L.outfit, -0.3)}" stroke-width="3" stroke-linejoin="round"/>`
      s += `<path d="M0,-98 l-14,-8 l0,16Z M0,-98 l14,-8 l0,16Z" fill="${L.ribbon}"/>`
      s += `<path d="M0,-84 L0,8" stroke="${line}" stroke-width="3" opacity=".45"/>`
    }
    return s
  }

  const sleeve = (L, d) => `<path d="${d}" stroke="${shade(L.outfit, -0.4)}" stroke-width="32" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" stroke="${L.outfit}" stroke-width="24" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
  const hand = (L, x, y, cls = '') => `<circle class="${cls}" cx="${x}" cy="${y}" r="15" fill="${L.skin}" stroke="${shade(L.skin, -0.32)}" stroke-width="4"/>`

  function head(L, ids) {
    let s = hairBack(L) + bun(L)
    if (L.catEars) s += catEars(L)
    s += face(L, ids) + eyes(L, ids) + mouth() + hairFront(L) + accessory(L)
    return s
  }

  /** 坐在工位上：main 画在桌子后面，hands 画在桌面上（打字的手）。 */
  function seated(L) {
    const ids = { iris: `ir${++uid}`, skin: `sk${uid}` }
    const main = `${defs(L, ids)}
      <g class="arms-rest"><g class="arm-rest-l">${sleeve(L, 'M-64,-100 C-84,-70 -80,-46 -46,-30')}</g><g class="arm-rest-r">${sleeve(L, 'M64,-100 C84,-70 80,-46 46,-30')}</g></g>
      <g class="body">${torso(L)}</g>
      <g class="head">${head(L, ids)}</g>
      <g class="arm-think">${sleeve(L, 'M64,-100 C92,-70 84,-104 40,-128')}${hand(L, 36, -130)}</g>
      <g class="arms-cheer">${sleeve(L, 'M-64,-100 C-96,-120 -112,-160 -110,-196')}${hand(L, -110, -204)}${sleeve(L, 'M64,-100 C96,-120 112,-160 110,-196')}${hand(L, 110, -204)}</g>`
    const hands = `<g class="hands">${hand(L, -44, -26, 'hand-l')}${hand(L, 44, -26, 'hand-r')}</g>`
    return { main, hands }
  }

  /** 站着 / 走路的全身。 */
  function standing(L) {
    const ids = { iris: `ir${++uid}`, skin: `sk${uid}` }
    const leg = L.sailor || /long|twintail|bob|ponytail/.test(L.style) ? L.skin : '#3d4262'
    const skirt = L.sailor ? `<path d="M-84,4 L-100,58 Q0,74 100,58 L84,4Z" fill="${shade(L.outfit, -0.1)}" stroke="${shade(L.outfit, -0.45)}" stroke-width="4"/>` : ''
    const legs = `<g class="legs">
      <g class="leg-l"><rect x="-38" y="0" width="28" height="96" rx="12" fill="${leg}" stroke="${shade(leg, -0.35)}" stroke-width="4"/><ellipse cx="-26" cy="98" rx="22" ry="12" fill="#4a3a52"/></g>
      <g class="leg-r"><rect x="10" y="0" width="28" height="96" rx="12" fill="${leg}" stroke="${shade(leg, -0.35)}" stroke-width="4"/><ellipse cx="26" cy="98" rx="22" ry="12" fill="#4a3a52"/></g>
    </g>`
    const tail = L.catEars ? `<path class="cat-tail" d="M60,10 C130,0 150,-60 120,-100" stroke="${L.hair}" stroke-width="16" fill="none" stroke-linecap="round"/>` : ''
    const main = `${defs(L, ids)}${tail}${legs}${skirt}
      <g class="arm-swing-l">${sleeve(L, 'M-66,-100 C-86,-70 -90,-40 -88,-8')}${hand(L, -88, 0)}</g>
      <g class="arm-swing-r">${sleeve(L, 'M66,-100 C86,-70 90,-40 88,-8')}${hand(L, 88, 0)}</g>
      <g class="body">${torso(L)}</g>
      <g class="head">${head(L, ids)}</g>
      <g class="paper"><rect x="82" y="-40" width="44" height="56" rx="4" fill="#fff" stroke="#b9b3c6" stroke-width="3"/><path d="M92,-26 h24 M92,-14 h24 M92,-2 h16" stroke="#c9c3d6" stroke-width="4"/></g>`
    return main
  }

  /** 聊天头像和团队卡片用的大头照（data: URL）。 */
  function portrait(L, bg = '#fff4f9') {
    const ids = { iris: `ir${++uid}`, skin: `sk${uid}` }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-150 -370 300 300"><style>${EXPRESSION_DEFAULTS}</style><rect x="-150" y="-370" width="300" height="300" fill="${bg}"/>${defs(L, ids)}<g>${torso(L)}</g>${head(L, ids)}</svg>`
    // base64：页面用 CSS url(...) 引用头像，SVG 里的括号会把未加引号的 url() 截断。
    return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)))
  }

  // 默认表情：只露出睁眼和微笑，其它表情由状态样式打开。
  const EXPRESSION_DEFAULTS = '.eyes-happy,.eyes-cross,.eyes-sleep,.mouth-open,.mouth-o,.mouth-wave,.blush-lines,.arm-think,.arms-cheer,.paper{display:none}'

  window.NiumaChibi = { lookFor, seated, standing, portrait, shade, strHash, SHANIU, EXPRESSION_DEFAULTS }
})()
