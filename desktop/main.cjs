// 牛马工作室桌面版：在应用里直接启动傻妞（和命令行版是同一套代码），用原生窗口打开办公室。
// 菜单里能切换项目文件夹、换皮肤、开彩排模式；关掉窗口会缩到托盘，活不会停。
const { app, BrowserWindow, Menu, Tray, dialog, shell, nativeImage, Notification } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { pathToFileURL } = require('node:url')

const CORE = app.isPackaged ? path.join(process.resourcesPath, 'core') : path.join(__dirname, '..')
const SKINS = [
  ['sakura', '樱花'],
  ['night', '夜班'],
  ['neon', '赛博霓虹'],
  ['neko', '猫耳咖啡'],
  ['pixel', '像素复古'],
]
const REPO = 'https://github.com/Leeeger1/niuma-studio'

// 设置和缓存放在固定的英文目录里（各系统的「应用数据」下的 niuma-studio）。
app.setName('牛马工作室')
app.setPath('userData', path.join(app.getPath('appData'), 'niuma-studio'))

let win = null
let tray = null
let studio = null
let quitting = false
let settings = {}

const icon = (name) => path.join(__dirname, 'build', name)
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json')

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))
  } catch {
    return {}
  }
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true })
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2))
  } catch {}
}

function addRecent(dir) {
  settings.recent = [dir, ...(settings.recent || []).filter((d) => d !== dir)].slice(0, 8)
  saveSettings()
}

// 从访达、资源管理器或桌面图标启动的程序拿不到终端里的 PATH（claude、codex 一般装在 npm 全局目录），
// 先从登录 shell 里借一份，再补上常见目录。
function fixPath() {
  if (process.platform === 'win32') return
  const sh = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  const parts = (process.env.PATH || '').split(':')
  try {
    const out = execFileSync(sh, ['-ilc', 'printf "__NIUMA__%s__NIUMA__" "$PATH"'], { encoding: 'utf8', timeout: 6000, stdio: ['ignore', 'pipe', 'ignore'] })
    const m = out.match(/__NIUMA__(.*)__NIUMA__/)
    if (m) parts.unshift(...m[1].split(':'))
  } catch {}
  const home = os.homedir()
  parts.push('/usr/local/bin', '/opt/homebrew/bin', path.join(home, '.npm-global', 'bin'), path.join(home, '.local', 'bin'), path.join(home, '.volta', 'bin'))
  process.env.PATH = [...new Set(parts.filter(Boolean))].join(':')
}

async function start(workdir, { fake = false } = {}) {
  if (studio) {
    await studio.close()
    studio = null
  }
  const { startStudio } = await import(pathToFileURL(path.join(CORE, 'src', 'studio.js')).href)
  studio = await startStudio({ root: CORE, workdir, fake, overrides: { host: '127.0.0.1', port: 17777 } })
  studio.fake = fake
  studio.workdir = workdir
}

function loadingPage(text) {
  const img = fs.readFileSync(icon('icon.png')).toString('base64')
  const html = `<!doctype html><meta charset="utf-8"><title>牛马工作室</title>
    <body style="margin:0;height:100vh;display:grid;place-items:center;background:linear-gradient(160deg,#fff5f9,#ffe1ee);font-family:system-ui,'PingFang SC','Microsoft YaHei',sans-serif;color:#6a4a5e">
    <div style="text-align:center"><img src="data:image/png;base64,${img}" width="120" height="120" style="animation:b 1.2s ease-in-out infinite alternate">
    <p style="font-size:18px;margin-top:18px">${text}</p></div>
    <style>@keyframes b{to{transform:translateY(-10px)}}</style></body>`
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html)
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    title: '牛马工作室',
    icon: icon('icon.png'),
    backgroundColor: '#fff5f9',
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  win.once('ready-to-show', () => win.show())
  win.on('page-title-updated', (e) => e.preventDefault())
  // 页面里的外部链接（GitHub、说明文档）用系统浏览器打开。
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (studio && url.startsWith(`http://127.0.0.1:${studio.port}/`)) return
    e.preventDefault()
    if (/^https?:/.test(url)) shell.openExternal(url)
  })
  win.webContents.on('did-finish-load', async () => {
    if (!studio) return
    try {
      const skin = await win.webContents.executeJavaScript('document.documentElement.dataset.skin || ""')
      if (settings.skin && skin && skin !== settings.skin) await setSkin(settings.skin)
      else if (skin && skin !== settings.skin) {
        settings.skin = skin
        saveSettings()
        buildMenu()
      }
    } catch {}
  })
  win.on('close', (e) => {
    if (quitting || process.platform === 'darwin' || !tray) return
    e.preventDefault()
    win.hide()
    if (!settings.trayHintShown && Notification.isSupported()) {
      new Notification({ title: '牛马工作室还在后台', body: '傻妞在托盘里继续盯着活，点托盘里的图标就能回来。' }).show()
      settings.trayHintShown = true
      saveSettings()
    }
  })
}

function showPage() {
  win.setTitle(`牛马工作室 · ${path.basename(studio.workdir)}${studio.fake ? '（彩排模式）' : ''}`)
  win.loadURL(studio.local)
}

function show() {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

async function chooseFolder() {
  const r = await dialog.showOpenDialog(win && win.isVisible() ? win : undefined, {
    title: '选一个项目文件夹',
    message: '员工们会在这个文件夹里干活。空文件夹也行，傻妞会从零开始建项目。',
    buttonLabel: '就用这个',
    properties: ['openDirectory', 'createDirectory'],
  })
  return r.canceled ? null : r.filePaths[0] || null
}

async function confirmStop(what) {
  if (!studio?.coord?.busy) return true
  const r = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: [what, '先不了'],
    defaultId: 1,
    cancelId: 1,
    message: '傻妞手上还有活在干',
    detail: `${what}会叫停所有正在干活的员工。确定吗？`,
  })
  return r.response === 0
}

async function openFolder(dir, { fake = studio?.fake } = {}) {
  if (!dir || !(await confirmStop('切换'))) return
  win.loadURL(loadingPage('傻妞正在搬去新项目…'))
  settings.workdir = dir
  addRecent(dir)
  try {
    await start(dir, { fake })
  } catch (e) {
    dialog.showErrorBox('没能打开这个文件夹', e.message)
    return
  }
  showPage()
  buildMenu()
  buildTray()
}

async function setSkin(id) {
  settings.skin = id
  saveSettings()
  buildMenu()
  try {
    await win.webContents.executeJavaScript(`document.querySelector('#skins button[data-skin="${id}"]')?.click()`)
  } catch {}
}

async function quit() {
  if (!(await confirmStop('退出'))) return
  quitting = true
  await studio?.close()
  app.quit()
}

function buildMenu() {
  const recent = (settings.recent || []).filter((d) => d !== studio?.workdir && fs.existsSync(d)).slice(0, 6)
  const template = [
    ...(process.platform === 'darwin'
      ? [{ label: app.name, submenu: [{ role: 'about', label: '关于牛马工作室' }, { type: 'separator' }, { role: 'hide', label: '隐藏' }, { label: '退出牛马工作室', accelerator: 'Cmd+Q', click: quit }] }]
      : []),
    {
      label: '项目',
      submenu: [
        { label: '切换项目文件夹…', accelerator: 'CmdOrCtrl+O', click: async () => openFolder(await chooseFolder()) },
        { label: '最近的项目', submenu: recent.length ? recent.map((d) => ({ label: d, click: () => openFolder(d) })) : [{ label: '（还没有）', enabled: false }] },
        { label: '在文件夹里查看', click: () => studio && shell.openPath(studio.workdir) },
        { type: 'separator' },
        { label: '彩排模式（替身员工演示，不花钱、不改文件）', type: 'checkbox', checked: !!studio?.fake, click: (item) => openFolder(studio?.workdir, { fake: item.checked }) },
        { label: '在浏览器里打开', click: () => studio && shell.openExternal(studio.local) },
        ...(process.platform === 'darwin' ? [] : [{ type: 'separator' }, { label: '退出', accelerator: 'Ctrl+Q', click: quit }]),
      ],
    },
    { label: '皮肤', submenu: SKINS.map(([id, name]) => ({ label: name, type: 'radio', checked: (settings.skin || 'sakura') === id, click: () => setSkin(id) })) },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '刷新' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: 'GitHub 主页', click: () => shell.openExternal(REPO) },
        { label: '接入 API 的说明', click: () => shell.openExternal(`${REPO}/blob/main/docs/api-guide.md`) },
        { label: '打开运行日志', click: () => studio && shell.openPath(studio.config.logDir) },
        { type: 'separator' },
        { label: `版本 ${app.getVersion()}`, enabled: false },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function buildTray() {
  if (process.platform === 'darwin') return
  if (!tray) {
    tray = new Tray(nativeImage.createFromPath(icon('tray.png')))
    tray.setToolTip('牛马工作室')
    tray.on('click', show)
  }
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开牛马工作室', click: show },
      { label: '切换项目文件夹…', click: async () => openFolder(await chooseFolder()) },
      { type: 'separator' },
      { label: '退出', click: quit },
    ]),
  )
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', show)
  app.setAppUserModelId('io.github.leeeger1.niuma-studio')

  app.whenReady().then(async () => {
    fixPath()
    settings = loadSettings()
    createWindow()
    win.loadURL(loadingPage('傻妞正在叫醒牛马们…'))
    let dir = settings.workdir && fs.existsSync(settings.workdir) ? settings.workdir : null
    if (!dir) {
      dir = await chooseFolder()
      if (!dir) {
        dir = path.join(app.getPath('documents'), '牛马工作室项目')
        fs.mkdirSync(dir, { recursive: true })
      }
    }
    settings.workdir = dir
    addRecent(dir)
    try {
      await start(dir, { fake: !!process.env.NIUMA_FAKE })
    } catch (e) {
      dialog.showErrorBox('牛马工作室没能启动', e.stack || e.message)
      app.quit()
      return
    }
    showPage()
    buildMenu()
    buildTray()
  })

  app.on('activate', show)
  app.on('before-quit', () => {
    quitting = true
  })
  app.on('will-quit', () => {
    studio?.close()
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
