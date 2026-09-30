/* 「接入员工」面板：一键安装 / 登录 / 测试 Claude Code、Codex，选一家 API 填 Key 就能接入。
   有服务器时调用 /api/setup/*；网页演示里只能看，不能真的接。 */
;(function () {
  'use strict'

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  const DESC = {
    claude: 'Anthropic 的编程助手。Claude 组的员工（架构师、前端、审查员）用它干活。',
    codex: 'OpenAI 的编程助手。Codex 组的员工（后端、测试、排错）用它干活。',
  }
  const TYPE = { 'claude-cli': 'Claude Code', 'codex-cli': 'Codex', 'openai-api': 'API' }

  // 网页演示里没有服务器：给一份看得见的样子。
  const DEMO = {
    demo: true,
    platform: 'win32',
    node: { ok: true, version: '22.12.0' },
    npm: { ok: true, version: '10.9.0' },
    cli: [
      { tool: 'claude', name: 'Claude Code', installed: true, version: '2.1.284', loggedIn: true },
      { tool: 'codex', name: 'Codex', installed: false, version: '', loggedIn: false },
    ],
    groups: [
      { id: 'claude', name: 'Claude 组', type: 'claude-cli', available: true, model: 'sonnet' },
      { id: 'deepseek', name: 'DeepSeek 组', type: 'openai-api', available: true, model: 'deepseek-v4-flash', removable: true },
    ],
    presets: [
      { id: 'deepseek', name: 'DeepSeek', note: '便宜，写代码很能打', group: 'DeepSeek 组', baseUrl: 'https://api.deepseek.com', models: { hard: 'deepseek-v4-pro', medium: 'deepseek-v4-flash', easy: 'deepseek-v4-flash' }, keyUrl: 'https://platform.deepseek.com/api_keys' },
      { id: 'qwen', name: '通义千问', note: '阿里云百炼', group: '通义组', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: { hard: 'qwen3-max', medium: 'qwen3-coder-plus', easy: 'qwen-flash' } },
      { id: 'kimi', name: 'Kimi', note: '月之暗面', group: 'Kimi 组', baseUrl: 'https://api.moonshot.cn/v1', models: { medium: 'kimi-k3' } },
      { id: 'glm', name: '智谱 GLM', note: '智谱开放平台', group: '智谱组', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', models: { medium: 'glm-4.7' } },
      { id: 'siliconflow', name: '硅基流动', note: '一个 Key 用很多开源模型', group: '硅基组', baseUrl: 'https://api.siliconflow.cn/v1', models: {} },
      { id: 'openrouter', name: 'OpenRouter', note: '海外聚合平台', group: 'OpenRouter 组', baseUrl: 'https://openrouter.ai/api/v1', models: {} },
      { id: 'relay', name: '中转站', note: '填中转站给你的地址、Key 和模型名', group: '中转站组', custom: true, models: {} },
      { id: 'ollama', name: '本地模型', note: 'Ollama / LM Studio，不用 Key', group: '本地组', baseUrl: 'http://localhost:11434/v1', noKey: true, models: { medium: 'qwen3-coder' } },
      { id: 'custom', name: '自定义', note: '任何 OpenAI 兼容接口', custom: true, models: {} },
    ],
    configFile: '~/.niuma/config.json',
  }

  let dlg = null
  let ctx = { request: null }
  let st = null
  let pick = null // 正在填的 API 预设
  const logs = { claude: [], codex: [] }
  const notes = {} // 各卡片下面的一行结果

  function ensure() {
    if (dlg) return
    dlg = document.createElement('dialog')
    dlg.className = 'setup'
    dlg.setAttribute('aria-label', '接入员工')
    document.body.appendChild(dlg)
    dlg.addEventListener('click', onClick)
    dlg.addEventListener('submit', onSubmit)
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) dlg.close()
    })
  }

  function open(c) {
    ctx = c || {}
    ensure()
    if (!dlg.open) dlg.showModal()
    refresh()
  }

  async function refresh() {
    if (!ctx.request) {
      st = DEMO
      return render()
    }
    if (!st) render(true)
    try {
      st = await ctx.request('GET', '/api/setup')
    } catch (e) {
      st = { error: `读不到状态：${e.message}` }
    }
    render()
  }

  function note(key, text, kind = '') {
    notes[key] = { text, kind }
    const el = dlg?.querySelector(`[data-note="${key}"]`)
    if (el) {
      el.textContent = text
      el.className = `note ${kind}`
    }
  }

  // ---- 渲染 ---------------------------------------------------------------------

  function chip(text, kind) {
    return `<span class="chip ${kind}">${esc(text)}</span>`
  }

  function noteHtml(key) {
    const n = notes[key]
    return `<p class="note ${n?.kind || ''}" data-note="${key}" aria-live="polite">${esc(n?.text || '')}</p>`
  }

  function cliCard(c) {
    const login = c.loggedIn === true ? chip('已登录', 'ok') : c.loggedIn === false ? chip('还没登录', 'warn') : chip('登录状态看不出来，点「测试」', 'muted')
    const state = c.installing ? chip('正在安装…', 'busy') : c.installed ? chip(`已装好 ${c.version}`, 'ok') : chip('还没安装', 'warn')
    const buttons = c.installed
      ? `<button type="button" data-act="login" data-tool="${c.tool}">登录</button><button type="button" data-act="test" data-tool="${c.tool}">测试</button>`
      : `<button type="button" class="primary" data-act="install" data-tool="${c.tool}" ${c.installing || !st.npm?.ok ? 'disabled' : ''}>一键安装</button><button type="button" data-act="install-terminal" data-tool="${c.tool}">在终端里安装</button>`
    const log = logs[c.tool].length ? `<pre class="log">${esc(logs[c.tool].slice(-12).join('\n'))}</pre>` : ''
    return `<div class="card cli">
      <div class="head"><b>${esc(c.name)}</b>${state}${c.installed ? login : ''}</div>
      <p class="desc">${DESC[c.tool]}</p>
      <div class="row">${buttons}</div>${log}${noteHtml(c.tool)}
    </div>`
  }

  function groupRow(g) {
    const state = g.available ? chip('在岗', 'ok') : chip(g.note || '未到岗', 'warn')
    return `<li><b>${esc(g.name)}</b><span class="muted">${esc(TYPE[g.type] || g.type)}${g.model ? ` · ${esc(g.model)}` : ''}</span>${state}${
      g.removable ? `<button type="button" class="ghost" data-act="remove" data-id="${esc(g.id)}">移除</button>` : ''
    }</li>`
  }

  function apiForm(p) {
    const m = p.models || {}
    const custom = !!p.custom
    const field = (name, label, value, attrs = '') => `<label><span>${label}</span><input name="${name}" value="${esc(value || '')}" ${attrs}></label>`
    return `<form class="card api-form" data-preset="${esc(p.id)}">
      <div class="head"><b>接入 ${esc(p.name)}</b><span class="muted">${esc(p.note || '')}</span><button type="button" class="ghost close-form" data-act="close-form" aria-label="收起">收起</button></div>
      ${custom ? field('baseUrl', '接口地址', p.baseUrl, 'placeholder="https://你的中转站地址/v1" required') : ''}
      ${p.noKey ? '' : `<label><span>API Key</span><input name="apiKey" type="password" autocomplete="off" placeholder="sk-…" required>${p.keyUrl ? `<a href="${esc(p.keyUrl)}" target="_blank" rel="noopener">去拿 Key ↗</a>` : ''}</label>`}
      ${custom || !m.medium ? field('medium', '模型名', m.medium, `placeholder="${custom ? '比如 deepseek-v4-flash、gpt-5' : '平台上的模型全名'}" required`) : ''}
      <details ${custom ? 'open' : ''}><summary>高级：地址、按难度分别用的模型、组名</summary>
        ${custom ? '' : field('baseUrl', '接口地址', p.baseUrl)}
        <div class="models">${field('hard', '难活用', m.hard, 'placeholder="不填就用中档"')}${custom || !m.medium ? '' : field('medium', '中档', m.medium)}${field('easy', '杂活用', m.easy, 'placeholder="不填就用中档"')}</div>
        ${field('name', '项目组名', p.group, 'placeholder="比如 中转站组"')}
      </details>
      <div class="row"><button type="button" data-act="test-api">测试连接</button><button type="submit" class="primary">测试并接入</button></div>
      ${noteHtml('api')}
    </form>`
  }

  function render(loading) {
    if (!dlg) return
    if (loading || !st) {
      dlg.innerHTML = `<div class="setup-head"><h2>接入员工</h2><button type="button" class="ghost" data-act="close">关闭</button></div><p class="loading">正在看看电脑上都装了什么…</p>`
      return
    }
    if (st.error) {
      dlg.innerHTML = `<div class="setup-head"><h2>接入员工</h2><button type="button" class="ghost" data-act="close">关闭</button></div><p class="note bad">${esc(st.error)}</p>`
      return
    }
    const banner = st.demo
      ? '<p class="banner-note">这是网页演示，按钮不会真的安装或接入。下载桌面版或者在电脑上运行 <code>niuma</code>，就能在这里一键接入。</p>'
      : st.fake
        ? '<p class="banner-note">现在是彩排模式，员工都是替身。关掉彩排模式（桌面版在菜单「项目」里）再来接入真员工。</p>'
        : st.busy
          ? '<p class="banner-note">傻妞手上还有活，接入新员工要等这一轮做完。</p>'
          : ''
    const node = st.node?.ok
      ? ''
      : `<div class="card warn-card"><b>电脑上还没有 Node.js</b><p class="desc">Claude Code 和 Codex 都要用它。装好以后把牛马工作室完全退出再打开。</p>
         <div class="row">${st.platform === 'win32' ? '<button type="button" class="primary" data-act="login" data-tool="node">一键安装 Node.js</button>' : ''}<a class="btn-link" href="https://nodejs.org/zh-cn/download" target="_blank" rel="noopener">打开 Node.js 下载页 ↗</a></div>${noteHtml('node')}</div>`
    const presets = st.presets.map((p) => `<button type="button" class="preset${pick?.id === p.id ? ' on' : ''}" data-act="pick" data-id="${esc(p.id)}"><b>${esc(p.name)}</b><span>${esc(p.note || '')}</span></button>`).join('')
    dlg.innerHTML = `
      <div class="setup-head"><h2>接入员工</h2><button type="button" class="ghost" data-act="recheck">重新检查</button><button type="button" class="ghost" data-act="close">关闭</button></div>
      ${banner}
      <section><h3>现在的项目组</h3><ul class="groups">${st.groups.map(groupRow).join('') || '<li class="muted">还没有项目组</li>'}</ul>${noteHtml('groups')}</section>
      <section><h3>命令行员工</h3>${node}<div class="cards">${st.cli.map(cliCard).join('')}</div></section>
      <section><h3>API 员工 <small>选一家，填上 Key 就能接</small></h3><div class="presets">${presets}</div>${pick ? apiForm(pick) : ''}</section>
      <p class="foot">Key 只保存在你自己的电脑上：<code>${esc(st.configFile)}</code></p>`
  }

  // ---- 操作 ---------------------------------------------------------------------

  async function call(url, body, key, pending) {
    if (!ctx.request) {
      note(key, '网页演示里不能真的操作，下载桌面版就能用。', 'muted')
      return null
    }
    note(key, pending, 'busy')
    try {
      const r = await ctx.request('POST', url, body)
      if (!r.ok) note(key, r.error || '没成功', 'bad')
      return r
    } catch (e) {
      note(key, e.message, 'bad')
      return null
    }
  }

  function formData(form) {
    const f = new FormData(form)
    const get = (k) => String(f.get(k) || '').trim()
    return {
      preset: form.dataset.preset,
      apiKey: get('apiKey'),
      baseUrl: get('baseUrl'),
      name: get('name'),
      models: { hard: get('hard'), medium: get('medium'), easy: get('easy') },
    }
  }

  async function onClick(e) {
    const b = e.target.closest('button[data-act]')
    if (!b) return
    const { act, tool, id } = b.dataset
    if (act === 'close') return dlg.close()
    if (act === 'pick') {
      pick = st.presets.find((p) => p.id === id) || null
      notes.api = null
      render()
      dlg.querySelector('.api-form input')?.focus()
      return
    }
    if (act === 'close-form') {
      pick = null
      return render()
    }
    if (act === 'recheck') {
      const r = await call('/api/setup/recheck', {}, 'groups', '傻妞正在重新点名…')
      if (r?.ok) note('groups', '点完名了。', 'ok')
      return refresh()
    }
    if (act === 'install') {
      logs[tool] = []
      const r = await call('/api/setup/install', { tool }, tool, '开始安装，大概要一两分钟…')
      if (r?.ok) refresh()
      return
    }
    if (act === 'install-terminal') {
      const r = await call('/api/setup/install-terminal', { tool }, tool, '正在打开终端…')
      if (r?.ok) note(tool, '已经打开终端窗口，装好以后回来点「重新检查」。', 'ok')
      return
    }
    if (act === 'login') {
      const r = await call('/api/setup/login', { tool }, tool, '正在打开登录窗口…')
      if (r?.ok) note(tool, r.hint || '已经打开窗口，按提示操作。', 'ok')
      return
    }
    if (act === 'test') {
      const r = await call('/api/setup/test', { tool }, tool, '正在让它回一句话，最多等一两分钟…')
      if (r?.ok) note(tool, `能干活！它回复：${r.reply || '在岗'}`, 'ok')
      return
    }
    if (act === 'test-api') {
      const form = b.closest('form')
      const d = formData(form)
      const p = st.presets.find((x) => x.id === d.preset) || {}
      const r = await call('/api/setup/test', { api: { baseUrl: d.baseUrl || p.baseUrl, apiKey: d.apiKey, noKey: p.noKey, models: { ...p.models, ...Object.fromEntries(Object.entries(d.models).filter(([, v]) => v)) } } }, 'api', '正在试着发一句话…')
      if (r?.ok) note('api', `连上了！模型 ${r.model} 回复：${r.reply}`, 'ok')
      return
    }
    if (act === 'remove') {
      const r = await call('/api/setup/remove', { id }, 'groups', '正在让他们回家…')
      if (r?.ok) refresh()
    }
  }

  async function onSubmit(e) {
    const form = e.target.closest('form.api-form')
    if (!form) return
    e.preventDefault()
    const d = formData(form)
    const p = st.presets.find((x) => x.id === d.preset) || {}
    d.models = { ...p.models, ...Object.fromEntries(Object.entries(d.models).filter(([, v]) => v)) }
    const r = await call('/api/setup/api', d, 'api', '正在测试并接入…')
    if (r?.ok) {
      note('api', r.available ? `接好了！模型回复：${r.reply}。新同事已经坐进工位。` : '接上了，但检查没通过，看看上面的状态。', r.available ? 'ok' : 'bad')
      pick = null
      await refresh()
      note('groups', r.available ? '新同事到岗啦！' : '', 'ok')
    }
  }

  function event(ev) {
    if (!logs[ev.tool]) return
    if (ev.line) logs[ev.tool].push(ev.line)
    if (ev.done) {
      note(ev.tool, ev.ok ? '装好了！傻妞已经重新点名。下一步点「登录」。' : ev.error || '安装失败', ev.ok ? 'ok' : 'bad')
      refresh()
      return
    }
    const pre = dlg?.querySelector(`.card.cli [data-tool="${ev.tool}"]`)?.closest('.card')?.querySelector('.log')
    if (pre) pre.textContent = logs[ev.tool].slice(-12).join('\n')
    else if (dlg?.open) render()
  }

  window.NiumaSetup = { open, event }
})()
