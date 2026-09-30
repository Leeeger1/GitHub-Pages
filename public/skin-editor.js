/* 「做皮肤」编辑器：右边抽屉，改一个颜色，后面的办公室马上跟着变。
   一键配色（选一个主色配出一整套）、随机来一套、换窗外风景和飘落效果、放自己的图片；
   保存到 ~/.niuma/skins（网页演示里存在浏览器），也能导出成文件发给别人、导入别人的皮肤。 */
;(function () {
  'use strict'

  const F = window.NiumaSkinFormat
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

  const UI = [
    ['bg', '页面背景'],
    ['panel', '面板'],
    ['panel2', '浅色块'],
    ['ink', '文字'],
    ['muted', '次要文字'],
    ['accent', '强调色'],
    ['onAccent', '强调色上的字'],
    ['line', '分隔线'],
    ['edge', '面板边框'],
  ]
  const ROOM_MAIN = [
    ['wall.0', '墙（上）'],
    ['wall.1', '墙（下）'],
    ['wainscot', '墙裙'],
    ['trim', '墙裙线'],
    ['floor.0', '地板（远）'],
    ['floor.1', '地板（近）'],
    ['sky.0', '天空（上）'],
    ['sky.1', '天空（中）'],
    ['sky.2', '天空（下）'],
    ['boss', '傻妞的桌子'],
  ]
  const ROOM_MORE = [
    ['floorLine', '地板缝'],
    ['desk', '工位桌子'],
    ['deskTop', '桌面'],
    ['deskEdge', '桌子描边'],
    ['monitor', '显示器'],
    ['monitorEdge', '显示器边框'],
    ['table', '会议桌'],
    ['tableEdge', '会议桌描边'],
    ['rug', '地毯'],
    ['frame', '窗框'],
    ['frameEdge', '窗框描边'],
    ['bossEdge', '傻妞桌子描边'],
    ['plant.0', '植物（亮）'],
    ['plant.1', '植物（暗）'],
    ['pot', '花盆'],
    ['ink', '钟和字'],
  ]
  const WINDOWS = [['sakura', '樱花'], ['city', '城市夜景'], ['cyber', '赛博城市'], ['garden', '花园'], ['sea', '大海'], ['sky', '只有天空'], ['image', '用我的图片']]
  const PARTICLES = [['petals', '花瓣'], ['snow', '雪花'], ['stars', '星光'], ['bubbles', '泡泡'], ['none', '不要']]
  const PATTERNS = [['none', '没有'], ['paws', '猫爪'], ['dots', '圆点'], ['stripes', '竖条'], ['grid', '霓虹格子']]
  const FLAGS = [['catEars', '大家戴猫耳'], ['cat', '办公室养猫'], ['lamps', '工位台灯'], ['neon', '霓虹灯']]
  const BASE_NAMES = { sakura: '樱花', night: '夜班', neon: '赛博霓虹', neko: '猫耳咖啡', pixel: '像素复古' }
  const MAX_IMAGE = 4 * 1024 * 1024

  let host = null
  let dlg = null
  let draft = null
  let editing = null // 正在改的自制皮肤 id；null = 新皮肤
  let dirty = false
  let timer = 0

  // ---- 颜色小工具 ----------------------------------------------------------------------

  const ctx = document.createElement('canvas').getContext('2d')
  /** 任何 CSS 颜色 → #rrggbb（给 <input type=color> 用，透明度丢掉） */
  function toHex(c) {
    if (!c) return '#000000'
    ctx.fillStyle = '#000000'
    ctx.fillStyle = String(c)
    const v = ctx.fillStyle
    if (/^#[0-9a-f]{6}$/i.test(v)) return v
    const m = v.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/)
    return m ? '#' + m.slice(1, 4).map((x) => (+x).toString(16).padStart(2, '0')).join('') : '#000000'
  }

  const getPath = (obj, key) => {
    const [k, i] = key.split('.')
    return i == null ? obj[k] : obj[k]?.[+i]
  }
  const setPath = (obj, key, v) => {
    const [k, i] = key.split('.')
    if (i == null) obj[k] = v
    else {
      obj[k] = [...(obj[k] || [])]
      obj[k][+i] = v
    }
  }

  // ---- 草稿 ----------------------------------------------------------------------------

  /** 一份完整的草稿：没写的颜色从 base 那套内置皮肤补上，这样每个色块都有值 */
  function fullDraft(skin) {
    const base = skin.base || 'sakura'
    const room = host.baseRoom(base) || {}
    const darkDefault = base === 'pixel' ? !!window.matchMedia?.('(prefers-color-scheme: dark)').matches : !!room.dark
    return {
      id: skin.id,
      name: skin.name || '',
      base,
      dark: typeof skin.dark === 'boolean' ? skin.dark : darkDefault,
      author: skin.author || '',
      font: skin.font || '',
      colors: { ...host.baseColors(base), ...(skin.colors || {}) },
      room: {
        window: 'sakura',
        particles: 'none',
        wallPattern: 'none',
        catEars: false,
        cat: false,
        lamps: false,
        neon: false,
        ...pickRoom(room),
        ...(skin.room || {}),
      },
      images: { ...(skin.images || {}) },
    }
  }

  function pickRoom(r) {
    const out = {}
    for (const k of Object.keys(F.ROOM_COLORS)) if (r[k] != null) out[k] = Array.isArray(r[k]) ? [...r[k]] : r[k]
    for (const k of Object.keys(F.ROOM_CHOICES)) if (r[k] != null) out[k] = r[k]
    for (const k of F.ROOM_FLAGS) if (r[k] != null) out[k] = !!r[k]
    return out
  }

  function skinFromDraft() {
    const raw = {
      id: editing || F.toId(draft.name) || 'my-skin',
      name: draft.name.trim() || '我的皮肤',
      base: draft.base,
      dark: draft.dark,
      author: draft.author,
      font: draft.font,
      colors: { ...draft.colors },
      room: draft.base === 'pixel' ? {} : { ...draft.room },
      images: { ...draft.images },
    }
    // 空的颜色（读不到的）不要写进去
    for (const [k, v] of Object.entries(raw.colors)) if (!v) delete raw.colors[k]
    if (raw.room.window === 'image' && !raw.images.window) raw.room.window = 'sky'
    return raw
  }

  function preview() {
    clearTimeout(timer)
    timer = setTimeout(() => {
      try {
        const s = F.normalize(skinFromDraft())
        host.preview({ ...s, id: editing || '__preview' })
      } catch (e) {
        note(e.message, 'bad')
      }
    }, 90)
  }

  // ---- 界面 ----------------------------------------------------------------------------

  function ensure() {
    if (dlg) return
    dlg = document.createElement('dialog')
    dlg.className = 'skin-editor'
    dlg.setAttribute('aria-label', '做皮肤')
    document.body.appendChild(dlg)
    dlg.addEventListener('input', onInput)
    dlg.addEventListener('change', onChange)
    dlg.addEventListener('click', onClick)
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault()
      close()
    })
  }

  function swatch(key, label, value) {
    return `<label class="sw"><input type="color" data-k="${key}" value="${toHex(value)}"><span>${label}</span></label>`
  }

  const select = (key, list, value) => `<select data-k="${key}">${list.map(([v, n]) => `<option value="${v}"${v === value ? ' selected' : ''}>${n}</option>`).join('')}</select>`

  function imageRow(key, label, hint) {
    const has = !!draft.images[key]
    return `<div class="img-row"><span class="img-label">${label}</span>
      ${has ? `<span class="thumb" style="background-image:url('${draft.images[key]}')"></span>` : `<span class="muted">${hint}</span>`}
      <label class="btn">选图片<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" data-img="${key}" hidden></label>
      ${has ? `<button type="button" data-act="clear-img" data-img="${key}">去掉</button>` : ''}</div>`
  }

  function render() {
    const info = host.info()
    const pixel = draft.base === 'pixel'
    const accent = toHex(draft.colors.accent)
    dlg.innerHTML = `
      <div class="se-head"><h2>${editing ? '改皮肤' : '做皮肤'}</h2><button type="button" class="ghost" data-act="close">关闭</button></div>
      <div class="se-body">
        <section>
          <label class="field"><span>名字</span><input data-k="name" value="${esc(draft.name)}" placeholder="比如 海边度假" maxlength="24"></label>
          <label class="field"><span>从哪套改起</span>${select('base', Object.entries(BASE_NAMES), draft.base)}</label>
          <label class="check"><input type="checkbox" data-k="dark" ${draft.dark ? 'checked' : ''}> 深色皮肤</label>
        </section>
        <section class="quick">
          <h3>一键配色 <small>选一个喜欢的颜色，其余的自动配好</small></h3>
          <div class="row"><input type="color" id="se-main" value="${accent}" aria-label="主色">
            <button type="button" class="primary" data-act="palette">用这个颜色配一整套</button>
            <button type="button" data-act="random">🎲 随机一套</button></div>
        </section>
        <section>
          <h3>界面颜色</h3>
          <div class="grid">${UI.map(([k, n]) => swatch(`colors.${k}`, n, draft.colors[k])).join('')}</div>
        </section>
        ${
          pixel
            ? '<section><p class="muted">像素复古的办公室画面是固定的像素画，这里只改界面颜色。想改办公室，「从哪套改起」换成二次元的几套。</p></section>'
            : `<section>
          <h3>办公室</h3>
          <div class="opts">
            <label class="field"><span>窗外</span>${select('room.window', WINDOWS, draft.room.window)}</label>
            <label class="field"><span>飘落</span>${select('room.particles', PARTICLES, draft.room.particles)}</label>
            <label class="field"><span>墙上花纹</span>${select('room.wallPattern', PATTERNS, draft.room.wallPattern)}</label>
          </div>
          <div class="flags">${FLAGS.map(([k, n]) => `<label class="check"><input type="checkbox" data-k="room.${k}" ${draft.room[k] ? 'checked' : ''}> ${n}</label>`).join('')}</div>
          <div class="grid">${ROOM_MAIN.map(([k, n]) => swatch(`room.${k}`, n, getPath(draft.room, k))).join('')}</div>
          <details><summary>更多颜色（桌子、显示器、窗框、植物…）</summary>
            <div class="grid">${ROOM_MORE.map(([k, n]) => swatch(`room.${k}`, n, getPath(draft.room, k))).join('')}</div>
          </details>
        </section>
        <section>
          <h3>图片 <small>png / jpg / gif / webp，不超过 4MB</small></h3>
          ${imageRow('wall', '墙纸', '没有，用上面的墙色')}
          ${imageRow('window', '窗外', '没有，用上面选的风景')}
        </section>`
        }
        <section>
          <details><summary>作者和字体</summary>
            <label class="field"><span>作者</span><input data-k="author" value="${esc(draft.author)}" maxlength="40" placeholder="分享时显示"></label>
            <label class="field"><span>标题字体</span><input data-k="font" value="${esc(draft.font)}" maxlength="40" placeholder="电脑上装了的字体名，可以不填"></label>
          </details>
        </section>
      </div>
      <div class="se-foot">
        <p class="note" data-note aria-live="polite"></p>
        <div class="row">
          <button type="button" class="primary" data-act="save">${editing ? '保存修改' : '保存'}</button>
          ${editing ? '<button type="button" data-act="save-new">另存为新皮肤</button>' : ''}
          <button type="button" data-act="export">导出文件</button>
          <label class="btn">导入文件<input type="file" accept=".json,application/json" data-act="import" hidden></label>
          ${editing ? '<button type="button" class="danger" data-act="delete">删除</button>' : ''}
        </div>
        <p class="where">${
          info.server
            ? `保存到 <code>${esc(info.dir || '~/.niuma/skins')}</code> <button type="button" class="link" data-act="folder">打开文件夹</button> · 也可以直接改里面的文件，回到窗口就生效`
            : '网页演示里皮肤存在这个浏览器里；「导出文件」可以存到电脑上或发给别人。'
        } · <a href="https://github.com/Leeeger1/niuma-studio/blob/main/docs/skin-guide.md" target="_blank" rel="noopener">皮肤说明</a></p>
        ${info.errors?.length ? `<details class="errors"><summary>有 ${info.errors.length} 个皮肤文件读的时候出了问题</summary><ul>${info.errors.map((e) => `<li><code>${esc(e.file)}</code>：${esc(e.message)}</li>`).join('')}</ul></details>` : ''}
      </div>`
  }

  function note(text, kind = '') {
    const el = dlg?.querySelector('[data-note]')
    if (el) {
      el.textContent = text
      el.className = `note ${kind}`
    }
  }

  // ---- 事件 ----------------------------------------------------------------------------

  function onInput(e) {
    const k = e.target.dataset.k
    if (!k || e.target.type === 'checkbox' || e.target.tagName === 'SELECT') return
    if (k === 'name' || k === 'author' || k === 'font') draft[k] = e.target.value
    else {
      const [scope, ...rest] = k.split('.')
      setPath(draft[scope], rest.join('.'), e.target.value)
      if (k === 'colors.accent' && !draft.dark) draft.colors.drop = hexToDrop(e.target.value)
    }
    dirty = true
    if (k !== 'name' && k !== 'author') preview()
  }

  const hexToDrop = (hex) => {
    const n = parseInt(toHex(hex).slice(1), 16)
    return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, 0.16)`
  }

  async function onChange(e) {
    const t = e.target
    const k = t.dataset.k
    if (t.dataset.img && t.files?.[0]) return loadImage(t.dataset.img, t.files[0])
    if (t.dataset.act === 'import' && t.files?.[0]) return importFile(t.files[0])
    if (!k) return
    dirty = true
    if (k === 'base') {
      // 换底子：颜色和摆设都换成那一套的，名字和图片留着
      const keep = { name: draft.name, author: draft.author, font: draft.font, images: draft.images }
      draft = { ...fullDraft({ base: t.value }), ...keep }
      render()
      return preview()
    }
    if (k === 'dark') draft.dark = t.checked
    else if (t.type === 'checkbox') draft.room[k.split('.')[1]] = t.checked
    else if (t.tagName === 'SELECT') {
      draft.room[k.split('.')[1]] = t.value
      if (k === 'room.window' && t.value === 'image' && !draft.images.window) note('再在下面「图片 → 窗外」选一张图片', 'muted')
    }
    preview()
  }

  function loadImage(key, file) {
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) return note('只支持 png、jpg、gif、webp 图片', 'bad')
    if (file.size > MAX_IMAGE) return note('图片太大了，换一张 4MB 以内的', 'bad')
    const r = new FileReader()
    r.onload = () => {
      draft.images[key] = String(r.result)
      if (key === 'window') draft.room.window = 'image'
      dirty = true
      render()
      preview()
    }
    r.readAsDataURL(file)
  }

  function importFile(file) {
    const r = new FileReader()
    r.onload = () => {
      try {
        const skin = F.normalize(F.parse(String(r.result)), { id: file.name.replace(/\.json$/i, '') })
        editing = null
        draft = fullDraft(skin)
        dirty = true
        render()
        preview()
        note(skin.warnings.length ? `导入了「${skin.name}」，有几项用不了：${skin.warnings.join('；')}` : `导入了「${skin.name}」，看着满意就点「保存」。`, skin.warnings.length ? 'bad' : 'ok')
      } catch (err) {
        note(err.message, 'bad')
      }
    }
    r.readAsText(file)
  }

  async function onClick(e) {
    const b = e.target.closest('button[data-act]')
    if (!b) return
    const act = b.dataset.act
    if (act === 'close') return close()
    if (act === 'palette' || act === 'random') {
      const main = act === 'random' ? F.hsl(Math.random() * 360, 65 + Math.random() * 20, 55) : dlg.querySelector('#se-main').value
      const p = F.paletteFrom(main, draft.dark)
      draft.colors = { ...draft.colors, ...p.colors }
      if (draft.base !== 'pixel') draft.room = { ...draft.room, ...p.room }
      dirty = true
      render()
      preview()
      return note(act === 'random' ? '随机配了一套，不喜欢就再点一次🎲' : '配好了，还可以单独调每个颜色。', 'ok')
    }
    if (act === 'clear-img') {
      delete draft.images[b.dataset.img]
      if (b.dataset.img === 'window' && draft.room.window === 'image') draft.room.window = 'sky'
      dirty = true
      render()
      return preview()
    }
    if (act === 'save' || act === 'save-new') {
      const replace = act === 'save' && !!editing
      const raw = skinFromDraft()
      // 名字和别的皮肤重了就加个编号，免得皮肤栏里两个一样的
      const names = new Set(host.list().filter((s) => !(replace && s.id === editing)).map((s) => s.name))
      if (names.has(raw.name)) {
        let n = 2
        while (names.has(`${raw.name} ${n}`)) n++
        raw.name = `${raw.name} ${n}`
      }
      if (!replace) raw.id = F.toId(raw.name) || 'my-skin'
      note('正在保存…', 'busy')
      try {
        const r = await host.save(raw, { replace })
        if (!r.ok) return note(r.error || '没存上', 'bad')
        editing = r.skin.id
        draft = fullDraft(r.skin)
        dirty = false
        render()
        return note(`存好了！皮肤栏里点「${r.skin.name}」就能换上。存在：${r.where || ''}`, 'ok')
      } catch (err) {
        return note(err.message, 'bad')
      }
    }
    if (act === 'export') {
      const skin = F.normalize(skinFromDraft())
      const blob = new Blob([F.toFile(skin)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${skin.name}.json`
      document.body.appendChild(a)
      a.click()
      setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 1000)
      return note('导出好了。别人在「做皮肤」里点「导入文件」，或者放进 ~/.niuma/skins 文件夹就能用。', 'ok')
    }
    if (act === 'delete') {
      if (!confirm(`删掉皮肤「${draft.name}」？删了找不回来。`)) return
      const r = await host.remove(editing)
      if (!r.ok) return note(r.error || '没删掉', 'bad')
      dirty = false
      editing = null
      return close(true)
    }
    if (act === 'folder') {
      const r = await host.openFolder()
      if (!r?.ok) note(r?.error || '打不开文件夹', 'bad')
    }
  }

  // ---- 打开 / 关闭 ---------------------------------------------------------------------

  function open() {
    host = window.NiumaSkin
    if (!host) return
    ensure()
    const cur = host.current()
    editing = cur.builtin ? null : cur.id
    draft = fullDraft(cur.builtin ? { base: cur.base } : cur)
    if (cur.builtin) draft.name = ''
    dirty = false
    render()
    if (!dlg.open) dlg.show()
    document.documentElement.classList.add('editing-skin')
    dlg.querySelector(cur.builtin ? '[data-k="name"]' : '.se-head .ghost')?.focus()
  }

  function close(force) {
    if (!dlg?.open) return
    if (!force && dirty && !confirm('改的还没保存，不要了吗？')) return
    clearTimeout(timer)
    dlg.close()
    document.documentElement.classList.remove('editing-skin')
    dirty = false
    host.restore()
  }

  /** 皮肤列表刷新了（比如文件夹里多了一个）：编辑器开着就更新底部的提示 */
  function refresh() {
    if (dlg?.open && !dirty) render()
  }

  window.NiumaSkinEditor = { open, close, refresh, isOpen: () => !!dlg?.open }
})()
