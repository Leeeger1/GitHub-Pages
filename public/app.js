/* Wires the page to the 傻妞 server (Server-Sent Events) or, when there is no server, to the demo. */
;(function () {
  'use strict'

  const $ = (s) => document.querySelector(s)
  const AGENT_STATUS = { idle: '待命', thinking: '思考中', working: '干活中', meeting: '开会中', walking: '派活中', done: '刚完成', error: '出错了', offline: '不在岗' }
  const TASK_STATUS = { pending: '排队', running: '进行中', done: '完成', failed: '失败', skipped: '跳过', cancelled: '取消' }
  const KIND = { code: '开发', review: '审查', research: '调研', fix: '返工', verify: '验收' }
  const DIFF = { hard: '难', medium: '中', easy: '易' }
  const TOOL_ZH = { browser: '浏览器', desktop: '电脑操作' }
  const SUGGEST = {
    live: ['帮我做一个记账小网站', '把这个项目整理得专业一点', '找找有没有 bug 并修掉', '/工具', '/团队', '/招人 数据库专家'],
    demo: ['帮我做一个待办清单 App', '/招人 数据库专家', '/工具', '/团队'],
  }

  const state = { mode: 'live', roster: { groups: [], employees: [] }, agents: {}, tasks: [], messages: [], busy: false, round: 0, iteration: 0, workdir: '', meeting: null, lastCommit: null }
  const openTasks = new Set()
  const faces = new Map()
  let transport = null

  // ---- skins -------------------------------------------------------------------
  // 二次元皮肤用 anime.js（SVG），像素复古用 office.js（canvas）；两者接口一样，可以随时切换。
  const SKINS = [
    ['sakura', '樱花'],
    ['night', '夜班'],
    ['neon', '赛博霓虹'],
    ['neko', '猫耳咖啡'],
    ['pixel', '像素复古'],
  ]
  const store = {
    get(k) {
      try {
        return localStorage.getItem(k)
      } catch {
        return null
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, v)
      } catch {}
    },
  }
  const known = (s) => SKINS.some(([id]) => id === s)
  const prefersDark = () => window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches
  let skin = [new URLSearchParams(location.search).get('skin'), store.get('niuma.skin')].find(known) || (prefersDark() ? 'night' : 'sakura')

  function makeOffice(id) {
    document.documentElement.dataset.skin = id
    if (id === 'pixel' || !window.AnimeOffice) return new window.ShaniuOffice($('#office'), $('#overlay'), $('#scene'))
    return new window.AnimeOffice($('#scene'), $('#overlay'), id)
  }
  let office = makeOffice(skin)

  function setSkin(id) {
    if (!known(id) || id === skin) return
    skin = id
    store.set('niuma.skin', id)
    office.destroy?.()
    office = makeOffice(id)
    faces.clear()
    office.setRoster(state.roster)
    for (const [aid, a] of Object.entries(state.agents)) office.setAgent(aid, a)
    office.setTasks(state.tasks)
    if (state.meeting?.status === 'open') office.meeting(state.meeting)
    renderSkins()
    renderTeam()
    renderMessages()
  }

  function renderSkins() {
    const box = $('#skins')
    if (!box) return
    box.innerHTML = '<span class="skins-label">皮肤</span>' + SKINS.map(([id, name]) => `<button type="button" data-skin="${id}" aria-pressed="${id === skin}">${name}</button>`).join('')
  }

  // ---- helpers ---------------------------------------------------------------

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  const inline = (s) =>
    esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')

  // Tiny, safe Markdown: headings, paragraphs, bullet lists, fenced code, inline code and bold.
  function md(text) {
    const out = []
    String(text ?? '')
      .split(/```[\w-]*\n?/)
      .forEach((part, i) => {
        if (i % 2) return out.push(`<pre><code>${esc(part.replace(/\n$/, ''))}</code></pre>`)
        // Line by line: headings, runs of list items, and paragraphs (blank lines split paragraphs).
        let list = []
        let para = []
        const flush = () => {
          if (list.length) out.push('<ul>' + list.map((l) => `<li>${inline(l)}</li>`).join('') + '</ul>')
          if (para.length) out.push('<p>' + para.map(inline).join('<br>') + '</p>')
          list = []
          para = []
        }
        for (const line of part.split('\n')) {
          const item = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/)
          if (!line.trim()) flush()
          else if (/^#{1,4}\s/.test(line)) {
            flush()
            out.push(`<h3>${inline(line.replace(/^#+\s*/, ''))}</h3>`)
          } else if (item) {
            if (para.length) flush()
            list.push(item[1])
          } else {
            if (list.length) flush()
            para.push(line)
          }
        }
        flush()
      })
    return out.join('')
  }

  const clock = (ts) => new Date(ts).toLocaleTimeString('zh-CN', { hour12: false })
  const mmss = (ms) => {
    const s = Math.max(0, Math.round(ms / 1000))
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
  }
  const emp = (id) => state.roster.employees.find((e) => e.id === id)
  const colorOf = (id) => (id === 'shaniu' ? 'var(--accent)' : emp(id)?.color || 'var(--muted)')

  function face(id) {
    const e = id === 'shaniu' ? { id: 'shaniu' } : emp(id)
    if (!e) return ''
    const key = `${e.id}|${e.color}|${e.look}`
    if (!faces.has(key)) faces.set(key, office.portrait(e))
    return faces.get(key)
  }

  // ---- rendering ------------------------------------------------------------

  function setConn(kind) {
    const map = { live: ['pill-live', '已连接'], fake: ['pill-fake', '彩排模式'], demo: ['pill-demo', '演示'], off: ['pill-off', '连接断开，重连中…'], wait: ['pill-wait', '连接中…'] }
    const [cls, label] = map[kind] || map.wait
    $('#conn').className = `pill ${cls}`
    $('#conn').textContent = label
  }

  function renderTeam() {
    const box = $('#team')
    box.innerHTML = ''
    for (const g of state.roster.groups) {
      const card = document.createElement('div')
      card.className = 'group-card'
      card.style.setProperty('--c', g.color)
      const models = ['hard', 'medium', 'easy'].map((d) => `${DIFF[d]} ${g.models?.[d] || '默认'}`)
      const uniq = new Set(Object.values(g.models || {}).map((m) => m || ''))
      const staff = state.roster.employees.filter((e) => e.group === g.id)
      card.innerHTML = `
        <div class="group-head"><b>${esc(g.name)}</b><span class="gtype">${esc(g.typeLabel || g.type)}</span><span class="gstate ${g.available ? '' : 'off'}">${g.available ? '在岗' : '未到岗'}</span></div>
        <div class="gmodels">${g.available ? esc(uniq.size > 1 ? models.join(' · ') : `模型 ${g.models?.medium || '默认'}`) : esc(g.note || '')}</div>
        ${g.available && g.tools?.length ? `<div class="gtools" title="要用到时傻妞会自动配好"><em>工具</em>${g.tools.map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
        <ul class="staff">${staff.map((e) => empRow(e)).join('')}</ul>`
      box.appendChild(card)
    }
    tickTimers()
  }

  function empRow(e) {
    const a = state.agents[e.id] || {}
    const status = e.available === false ? 'offline' : a.status || 'idle'
    const task = a.taskId && state.tasks.find((t) => t.id === a.taskId)
    const doing =
      status === 'offline'
        ? a.text || '不在岗'
        : ['working', 'meeting', 'thinking', 'error'].includes(status)
          ? a.text || AGENT_STATUS[status]
          : e.stats && e.stats.done + e.stats.failed
            ? `完成 ${e.stats.done} · 失败 ${e.stats.failed}`
            : e.description
    const badge = task && status === 'working' ? `<span class="timer" data-since="${task.startedAt || ''}"></span>` : esc(AGENT_STATUS[status] || status)
    return `<li class="emp" data-s="${esc(status)}" title="${esc(e.description)}">
      <span class="face" style="background-image:url(${face(e.id)})"></span>
      <span class="ename">${esc(e.name)}</span>
      <span class="estate">${badge}</span>
      <span class="edoing">${esc(doing)}</span></li>`
  }

  function tickTimers() {
    for (const el of document.querySelectorAll('.timer[data-since]')) {
      const since = Number(el.dataset.since)
      if (since) el.textContent = mmss(Date.now() - since)
    }
  }
  setInterval(tickTimers, 1000)

  function renderMessage(m) {
    const box = $('#messages')
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80
    const el = document.createElement('div')
    el.className = `msg msg-${m.role}`
    if (m.role === 'shaniu') el.innerHTML = `<div class="avatar" style="background-image:url(${face('shaniu')})" aria-hidden="true"></div><div class="body">${md(m.text)}</div>`
    else if (m.role === 'speech') {
      el.style.setProperty('--c', colorOf(m.id))
      el.innerHTML = `<div class="avatar" style="background-image:url(${face(m.id)})" aria-hidden="true"></div><div class="body"><div class="who">${esc(m.who)} · 会上发言</div>${md(m.text)}</div>`
    } else if (m.role === 'user') el.innerHTML = `<div class="body">${md(m.text)}</div>`
    else el.innerHTML = `<div class="body">${esc(m.text)}</div>`
    box.insertBefore(el, $('#typing') || null)
    if (nearBottom || m.role === 'user') box.scrollTop = box.scrollHeight
  }

  function renderMessages() {
    $('#messages').innerHTML = ''
    state.messages.forEach(renderMessage)
    renderTyping()
  }

  function renderTyping() {
    const box = $('#messages')
    let el = $('#typing')
    const thinking = state.agents.shaniu?.status === 'thinking'
    if (thinking && !el) {
      el = document.createElement('div')
      el.id = 'typing'
      el.className = 'msg msg-shaniu typing'
      el.innerHTML = `<div class="avatar" style="background-image:url(${face('shaniu')})" aria-hidden="true"></div><div class="body">${esc(state.agents.shaniu.text || '. . .')}</div>`
      box.appendChild(el)
      box.scrollTop = box.scrollHeight
    } else if (!thinking && el) el.remove()
  }

  function renderMeeting() {
    const box = $('#meeting')
    const m = state.meeting
    if (!m) {
      box.hidden = true
      return
    }
    const names = m.attendees.map((id) => emp(id)?.name || id).join('、')
    const open = box.querySelector('details')?.open
    box.hidden = false
    box.innerHTML = `<details ${open ? 'open' : ''}>
      <summary><span class="mt">项目会议 · ${m.status === 'open' ? '进行中…' : '已拍板'}</span>
      <span class="mm">议题：${esc(m.topics.join('、'))} · 参会：${esc(names)}${m.file ? ` · 纪要：${esc(m.file)}` : ''}</span></summary>
      <div class="mbody">${m.minutes ? `<pre>${esc(m.minutes)}</pre>` : '<span class="mm">大家正在发言…</span>'}</div>
    </details>`
  }

  function renderTasks() {
    const list = $('#tasks')
    list.innerHTML = ''
    $('#tasks-empty').hidden = state.tasks.length > 0 || !!state.meeting
    const work = state.tasks.filter((t) => t.kind !== 'verify')
    const done = work.filter((t) => t.status === 'done').length
    $('#round').textContent = state.round ? `第 ${state.round} 个需求${state.iteration > 1 ? ` · 第 ${state.iteration} 轮` : ''} · ${done}/${work.length} 完成` : ''
    let iter = 1
    for (const t of state.tasks) {
      if ((t.iter || 1) !== iter) {
        iter = t.iter || 1
        const sep = document.createElement('li')
        sep.className = 'iter'
        sep.textContent = `第 ${iter} 轮：验收没通过，继续补`
        list.appendChild(sep)
      }
      const li = document.createElement('li')
      li.className = 'task'
      li.dataset.s = t.status
      li.style.setProperty('--c', colorOf(t.agent))
      const verdict =
        t.verdict === 'approve' ? ' · <span class="verdict-ok">通过</span>' : t.verdict === 'changes' ? ' · <span class="verdict-bad">没通过</span>' : ''
      const time = t.startedAt ? ` · ${t.endedAt ? mmss(t.endedAt - t.startedAt) : `<span class="timer" data-since="${t.startedAt}"></span>`}` : ''
      const cost = t.cost ? ` · $${Number(t.cost).toFixed(2)}` : t.usage && t.usage.in ? ` · ${Math.round((t.usage.in + t.usage.out) / 1000)}k tokens` : ''
      const last = t.activity?.length ? t.activity[t.activity.length - 1].text : ''
      const deps = t.deps?.length ? ` · 等 ${t.deps.join('、')}` : ''
      const log = (t.activity || []).map((a) => `<li class="k-${esc(a.kind)}"><time>${clock(a.ts)}</time><span>${esc(a.text)}</span></li>`).join('')
      const attempts = (t.attempts || []).map((a) => `<li>${esc(a.who)}：${esc(a.error)}</li>`).join('')
      li.innerHTML = `
        <details ${openTasks.has(t.id) ? 'open' : ''}>
          <summary>
            <span class="stripe"></span>
            <span class="tstate">${esc(TASK_STATUS[t.status] || t.status)}</span>
            <span class="main">
              <div class="title">${esc(t.title)}</div>
              <div class="meta"><span class="diff diff-${esc(t.difficulty)}">${DIFF[t.difficulty] || '中'}</span> ${esc(KIND[t.kind] || t.kind)}${t.model ? ` · ${esc(t.model)}` : ''}${esc(deps)}${time}${cost}${verdict}${t.status === 'running' && last ? ` · ${esc(last)}` : ''}${t.error ? ` · ${esc(t.error)}` : ''}</div>
            </span>
            <span class="who">${esc(t.who || emp(t.agent)?.name || t.agent)}</span>
          </summary>
          <div class="detail">
            ${t.why ? `<div><h3>为什么派给 ${esc(t.who)}</h3><p>${esc(t.why)}</p></div>` : ''}
            ${t.tools?.length ? `<div><h3>配的工具</h3><p>${esc(t.tools.map((x) => TOOL_ZH[x] || x).join('、'))}</p></div>` : ''}
            ${attempts ? `<div><h3>换过人</h3><ul class="log">${attempts}</ul></div>` : ''}
            <div><h3>傻妞的交代</h3><pre>${esc(t.kind === 'verify' ? '对照主人的需求整体验收（只看不改）' : t.prompt)}</pre></div>
            ${log ? `<div><h3>过程</h3><ul class="log">${log}</ul></div>` : ''}
            ${t.result ? `<div><h3>汇报</h3><pre>${esc(t.result)}</pre></div>` : ''}
          </div>
        </details>`
      li.querySelector('details').addEventListener('toggle', (e) => {
        if (e.target.open) openTasks.add(t.id)
        else openTasks.delete(t.id)
      })
      list.appendChild(li)
    }
    office.setTasks(state.tasks)
    tickTimers()
  }

  function renderBusy() {
    $('#stop').hidden = !state.busy
    $('#undo').hidden = !state.lastCommit || state.busy
  }

  function renderSuggest() {
    const box = $('#suggest')
    box.innerHTML = ''
    for (const s of SUGGEST[state.mode === 'live' ? 'live' : 'demo']) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'chip'
      b.textContent = s
      b.addEventListener('click', () => {
        $('#input').value = s
        $('#input').focus()
      })
      box.appendChild(b)
    }
  }

  function renderBanner() {
    const el = $('#banner')
    if (state.mode === 'demo') {
      el.innerHTML =
        '这是演示：员工都是演员，不会真的改代码。项目开源在 <a href="https://github.com/Leeeger1/niuma-studio" target="_blank" rel="noopener">GitHub</a>，下载后运行 <code>node bin/niuma.js 你的项目目录</code>，他们就会真的开工。'
      el.hidden = false
    } else if (state.mode === 'fake') {
      el.innerHTML = /Electron/.test(navigator.userAgent)
        ? '彩排模式：员工都是替身，不花钱、不改文件。在菜单「项目」里取消勾选「彩排模式」就是真干活。'
        : '彩排模式：员工都是替身，不花钱、不改文件。去掉 <code>--fake</code> 就是真干活。'
      el.hidden = false
    } else el.hidden = true
  }

  // ---- events ----------------------------------------------------------------

  function upsertTask(task) {
    const i = state.tasks.findIndex((t) => t.id === task.id)
    if (i === -1) state.tasks.push(task)
    else state.tasks[i] = task
  }

  function handle(ev) {
    switch (ev.type) {
      case 'snapshot':
        Object.assign(state, ev.state)
        setConn(state.mode === 'live' ? 'live' : state.mode)
        $('#workdir').textContent = state.workdir || ''
        $('#workdir').title = state.workdir || ''
        office.setRoster(state.roster)
        for (const [id, a] of Object.entries(state.agents)) office.setAgent(id, a)
        if (state.meeting?.status === 'open') office.meeting(state.meeting)
        renderMessages()
        renderMeeting()
        renderTasks()
        renderTeam()
        renderBusy()
        renderSuggest()
        renderBanner()
        break
      case 'roster':
        state.roster = ev.roster
        Object.assign(state.agents, ev.agents || {})
        office.setRoster(state.roster)
        for (const [id, a] of Object.entries(state.agents)) office.setAgent(id, a)
        renderTeam()
        break
      case 'agent': {
        const { type, id, ...rest } = ev
        state.agents[id] = { ...(state.agents[id] || {}), ...rest }
        office.setAgent(id, state.agents[id])
        renderTeam()
        if (id === 'shaniu') renderTyping()
        break
      }
      case 'activity': {
        const t = state.tasks.find((x) => x.id === ev.taskId)
        if (t) {
          t.activity = [...(t.activity || []), { kind: ev.kind, text: ev.text, ts: ev.ts }].slice(-200)
          renderTasks()
        }
        if (state.agents[ev.id]) state.agents[ev.id].text = ev.text
        office.activity(ev.id, ev.text)
        renderTeam()
        break
      }
      case 'message':
        state.messages.push(ev.message)
        renderMessage(ev.message)
        if (ev.message.role === 'shaniu') office.say('shaniu', ev.message.text.replace(/[`*#]/g, '').split('\n')[0].slice(0, 60), { ttl: 6000 })
        if (ev.message.role === 'speech') office.say(ev.message.id, ev.message.text.replace(/[`*#]/g, '').split('\n')[0].slice(0, 50), { ttl: 9000 })
        break
      case 'round':
        state.round = ev.round
        state.iteration = ev.iteration || 1
        state.tasks = []
        state.meeting = null
        openTasks.clear()
        renderMeeting()
        renderTasks()
        break
      case 'iteration':
        state.iteration = ev.iteration
        renderTasks()
        break
      case 'task':
        upsertTask(ev.task)
        renderTasks()
        renderTeam()
        break
      case 'meeting':
        state.meeting = ev.meeting
        office.meeting(ev.meeting)
        renderMeeting()
        renderTasks()
        break
      case 'dispatch':
        office.dispatch(ev.to)
        break
      case 'commit':
        state.lastCommit = ev.commit
        renderBusy()
        break
      case 'busy':
        state.busy = ev.busy
        renderBusy()
        break
    }
  }

  // ---- transports ------------------------------------------------------------

  function connectLive(token) {
    const q = token ? `?token=${encodeURIComponent(token)}` : ''
    const es = new EventSource('/events' + q)
    es.onmessage = (e) => handle(JSON.parse(e.data))
    es.onopen = () => setConn(state.mode === 'fake' ? 'fake' : 'live')
    es.onerror = () => setConn('off')
    const post = async (url, body) => {
      const r = await fetch(url + q, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Niuma-Token': token }, body: JSON.stringify(body) })
      if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
    }
    return { send: (text) => post('/api/message', { text }), stop: () => post('/api/stop', {}) }
  }

  async function detectServer(token) {
    if (location.hash === '#demo' || !/^https?:$/.test(location.protocol)) return false
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 2500)
    try {
      const r = await fetch('/api/state' + (token ? `?token=${encodeURIComponent(token)}` : ''), { signal: ctl.signal, cache: 'no-store' })
      return r.ok && (r.headers.get('content-type') || '').includes('application/json')
    } catch {
      return false
    } finally {
      clearTimeout(timer)
    }
  }

  // ---- composer --------------------------------------------------------------

  async function send(text) {
    text = text.trim()
    if (!text || !transport) return
    try {
      await transport.send(text)
    } catch (e) {
      handle({ type: 'message', message: { role: 'system', text: `没发出去：${e.message}`, ts: Date.now() } })
    }
  }

  $('#composer').addEventListener('submit', (e) => {
    e.preventDefault()
    const text = $('#input').value
    $('#input').value = ''
    send(text)
  })
  $('#input').addEventListener('keydown', (e) => {
    // Enter sends; Shift+Enter or an IME composition (Chinese input) keeps typing.
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault()
      $('#composer').requestSubmit()
    }
  })
  $('#stop').addEventListener('click', () => transport && transport.stop().catch(() => {}))
  $('#skins')?.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-skin]')
    if (b) setSkin(b.dataset.skin)
  })
  renderSkins()
  $('#undo').addEventListener('click', () => send('/撤销'))

  // ---- boot ------------------------------------------------------------------

  ;(async () => {
    let token = ''
    try {
      token = new URLSearchParams(location.search).get('token') || sessionStorage.getItem('niuma-token') || ''
      if (token) sessionStorage.setItem('niuma-token', token)
    } catch {}
    renderSuggest()
    if (await detectServer(token)) transport = connectLive(token)
    else transport = window.ShaniuDemo(handle)
  })()
})()
