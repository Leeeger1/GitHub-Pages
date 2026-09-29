/* Wires the page to the Mavis server (Server-Sent Events) or, when there is no server, to the demo. */
;(function () {
  'use strict'

  const $ = (s) => document.querySelector(s)
  const NAMES = { claude: 'Claude', codex: 'Codex', mavis: 'Mavis' }
  const ROLES = { mavis: '总管', claude: '工程师', codex: '工程师' }
  const AGENT_STATUS = { idle: '待命', thinking: '思考中', working: '干活中', walking: '派活中', done: '刚完成', error: '出错了', offline: '不在岗' }
  const TASK_STATUS = { pending: '排队', running: '进行中', done: '完成', failed: '失败', skipped: '跳过', cancelled: '取消' }
  const KIND = { code: '开发', review: '审查', research: '调研', fix: '返工' }
  const COLORS = { claude: 'var(--claude)', codex: 'var(--codex)', mavis: 'var(--mavis)' }
  const SUGGEST = {
    live: ['这个项目是做什么的？', '找找有没有明显的 bug 并修掉', '给项目写一份 README', '@codex 跑一下测试，看看哪里挂了'],
    demo: ['给登录页加上图形验证码', '严格审查：重构一下购物车模块', '你好呀'],
  }

  const office = new window.MavisOffice($('#office'), $('#overlay'))
  const PORTRAITS = {}
  for (const id of ['mavis', 'claude', 'codex']) PORTRAITS[id] = office.portrait(id)
  document.documentElement.style.setProperty('--mavis-face', `url(${PORTRAITS.mavis})`)
  const state = { mode: 'live', agents: {}, tasks: [], messages: [], busy: false, round: 0, workdir: '' }
  const openTasks = new Set()
  let transport = null

  // ---- helpers ---------------------------------------------------------

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

  function inline(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  }

  // Tiny, safe Markdown: paragraphs, bullet lists, fenced code, inline code and bold.
  function md(text) {
    const out = []
    const parts = String(text ?? '').split(/```[\w-]*\n?/)
    parts.forEach((part, i) => {
      if (i % 2) {
        out.push(`<pre><code>${esc(part.replace(/\n$/, ''))}</code></pre>`)
        return
      }
      for (const block of part.split(/\n{2,}/)) {
        const lines = block.split('\n').filter((l) => l.trim())
        if (!lines.length) continue
        if (lines.every((l) => /^\s*([-*]|\d+\.)\s+/.test(l))) {
          out.push('<ul>' + lines.map((l) => `<li>${inline(l.replace(/^\s*([-*]|\d+\.)\s+/, ''))}</li>`).join('') + '</ul>')
        } else {
          out.push('<p>' + lines.map((l) => inline(l.replace(/^#+\s*/, ''))).join('<br>') + '</p>')
        }
      }
    })
    return out.join('')
  }

  const clock = (ts) => new Date(ts).toLocaleTimeString('zh-CN', { hour12: false })
  const mmss = (ms) => {
    const s = Math.max(0, Math.round(ms / 1000))
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
  }

  // ---- rendering -------------------------------------------------------

  function setConn(kind) {
    const el = $('#conn')
    const map = {
      live: ['pill-live', '已连接'],
      fake: ['pill-fake', '彩排模式'],
      demo: ['pill-demo', '演示'],
      off: ['pill-off', '连接断开，重连中…'],
      wait: ['pill-wait', '连接中…'],
    }
    const [cls, label] = map[kind] || map.wait
    el.className = `pill ${cls}`
    el.textContent = label
  }

  function renderRoster() {
    const box = $('#roster')
    box.innerHTML = ''
    for (const id of ['mavis', 'claude', 'codex']) {
      const a = state.agents[id] || { status: 'offline' }
      const status = a.available === false && id !== 'mavis' ? 'offline' : a.status
      const task = a.taskId && state.tasks.find((t) => t.id === a.taskId)
      const doing =
        status === 'offline'
          ? a.text || '不在岗'
          : status === 'working'
            ? a.text || (task && task.title) || '干活中'
            : status === 'thinking'
              ? a.text || '思考中'
              : status === 'error'
                ? a.text || '出错了'
                : id === 'mavis'
                  ? '随时听候吩咐'
                  : a.version
                    ? `${ROLES[id]} · ${a.version}`
                    : ROLES[id]
      const el = document.createElement('div')
      el.className = 'crew'
      el.style.setProperty('--c', COLORS[id])
      el.innerHTML = `
        <span class="face" style="background-image:url(${PORTRAITS[id]})"></span>
        <span class="who">${NAMES[id]}</span>
        <span class="state" data-s="${esc(status)}">${task && status === 'working' ? `<span class="timer" data-since="${task.startedAt || ''}"></span>` : esc(AGENT_STATUS[status] || status)}</span>
        <span class="doing" title="${esc(doing)}">${esc(doing)}</span>`
      box.appendChild(el)
    }
    tickTimers()
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
    if (m.role === 'mavis') el.innerHTML = `<div class="avatar" aria-hidden="true"></div><div class="body">${md(m.text)}</div>`
    else if (m.role === 'user') el.innerHTML = `<div class="body">${md(m.text)}</div>`
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
    const thinking = state.agents.mavis && state.agents.mavis.status === 'thinking'
    if (thinking && !el) {
      el = document.createElement('div')
      el.id = 'typing'
      el.className = 'msg msg-mavis typing'
      el.innerHTML = '<div class="avatar" aria-hidden="true"></div><div class="body">. . .</div>'
      box.appendChild(el)
      box.scrollTop = box.scrollHeight
    } else if (!thinking && el) el.remove()
  }

  function renderTasks() {
    const list = $('#tasks')
    list.innerHTML = ''
    $('#tasks-empty').hidden = state.tasks.length > 0
    const done = state.tasks.filter((t) => t.status === 'done').length
    $('#round').textContent = state.round ? `第 ${state.round} 轮 · ${done}/${state.tasks.length} 完成` : ''
    for (const t of state.tasks) {
      const li = document.createElement('li')
      li.className = 'task'
      li.dataset.s = t.status
      li.style.setProperty('--c', COLORS[t.agent])
      const deps = t.deps && t.deps.length ? ` · 等 ${t.deps.join('、')}` : ''
      const verdict =
        t.verdict === 'approve' ? ' · <span class="verdict-ok">审查通过</span>' : t.verdict === 'changes' ? ' · <span class="verdict-bad">要求返工</span>' : ''
      const time = t.startedAt ? ` · ${t.endedAt ? mmss(t.endedAt - t.startedAt) : `<span class="timer" data-since="${t.startedAt}"></span>`}` : ''
      const cost = t.cost ? ` · $${Number(t.cost).toFixed(2)}` : ''
      const last = t.activity && t.activity.length ? t.activity[t.activity.length - 1].text : ''
      const log = (t.activity || [])
        .map((a) => `<li class="k-${esc(a.kind)}"><time>${clock(a.ts)}</time><span>${esc(a.text)}</span></li>`)
        .join('')
      li.innerHTML = `
        <details ${openTasks.has(t.id) ? 'open' : ''}>
          <summary>
            <span class="stripe"></span>
            <span class="tstate">${esc(TASK_STATUS[t.status] || t.status)}</span>
            <span class="main">
              <div class="title">${esc(t.title)}</div>
              <div class="meta">${esc(t.id)} · ${esc(KIND[t.kind] || t.kind)}${esc(deps)}${time}${cost}${verdict}${t.status === 'running' && last ? ` · ${esc(last)}` : ''}${t.error ? ` · ${esc(t.error)}` : ''}</div>
            </span>
            <span class="who">${NAMES[t.agent]}</span>
          </summary>
          <div class="detail">
            <div><h3>Mavis 的交代</h3><pre>${esc(t.prompt)}</pre></div>
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
        const input = $('#input')
        input.value = s
        input.focus()
      })
      box.appendChild(b)
    }
  }

  function renderBanner() {
    const el = $('#banner')
    if (state.mode === 'demo') {
      el.innerHTML =
        '这是演示：Claude 和 Codex 是演员，不会真的改代码。在电脑上运行 <code>node bin/mavis.js 你的项目目录</code>，它们就会真的开工。'
      el.hidden = false
    } else if (state.mode === 'fake') {
      el.innerHTML = '彩排模式：用的是假的 Claude 和 Codex，不花钱、不改文件。去掉 <code>--fake</code> 就是真干活。'
      el.hidden = false
    } else el.hidden = true
  }

  // ---- events ------------------------------------------------------------

  function upsertTask(task) {
    const i = state.tasks.findIndex((t) => t.id === task.id)
    if (i === -1) state.tasks.push(task)
    else state.tasks[i] = task
  }

  function handle(ev) {
    switch (ev.type) {
      case 'snapshot': {
        Object.assign(state, ev.state)
        setConn(state.mode === 'live' ? 'live' : state.mode)
        $('#workdir').textContent = state.workdir || ''
        $('#workdir').title = state.workdir || ''
        for (const [id, a] of Object.entries(state.agents)) office.setAgent(id, a)
        renderMessages()
        renderTasks()
        renderRoster()
        renderBusy()
        renderSuggest()
        renderBanner()
        break
      }
      case 'agent': {
        const { type, id, ...rest } = ev
        state.agents[id] = { ...(state.agents[id] || {}), ...rest }
        office.setAgent(id, state.agents[id])
        renderRoster()
        if (id === 'mavis') renderTyping()
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
        renderRoster()
        break
      }
      case 'message':
        state.messages.push(ev.message)
        renderMessage(ev.message)
        if (ev.message.role === 'mavis') office.say('mavis', ev.message.text.replace(/[`*#]/g, '').split('\n')[0].slice(0, 60), { ttl: 6000 })
        break
      case 'round':
        state.round = ev.round
        state.tasks = []
        openTasks.clear()
        renderTasks()
        break
      case 'task':
        upsertTask(ev.task)
        renderTasks()
        renderRoster()
        break
      case 'dispatch':
        office.dispatch(ev.to)
        break
      case 'busy':
        state.busy = ev.busy
        renderBusy()
        break
    }
  }

  // ---- transports ------------------------------------------------------

  function connectLive(token) {
    const q = token ? `?token=${encodeURIComponent(token)}` : ''
    const es = new EventSource('/events' + q)
    es.onmessage = (e) => handle(JSON.parse(e.data))
    es.onopen = () => setConn(state.mode === 'fake' ? 'fake' : 'live')
    es.onerror = () => setConn('off')
    const post = async (url, body) => {
      const r = await fetch(url + q, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Mavis-Token': token },
        body: JSON.stringify(body),
      })
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

  // ---- composer --------------------------------------------------------

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
    const input = $('#input')
    const text = input.value
    input.value = ''
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

  // ---- boot ----------------------------------------------------------------

  ;(async () => {
    let token = ''
    try {
      token = new URLSearchParams(location.search).get('token') || sessionStorage.getItem('mavis-token') || ''
      if (token) sessionStorage.setItem('mavis-token', token)
    } catch {}
    renderRoster()
    renderSuggest()
    if (await detectServer(token)) transport = connectLive(token)
    else transport = window.MavisDemo(handle)
  })()
})()
