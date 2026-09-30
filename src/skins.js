// 自制皮肤：放在 ~/.niuma/skins/ 里。两种放法都认：
//   ~/.niuma/skins/海边.json                 一个文件（图片放在同一个文件夹，写文件名）
//   ~/.niuma/skins/海边/skin.json + 图片      一个文件夹（「做皮肤」编辑器存的就是这种）
// 页面拿到的是检查过的皮肤，图片已经转成 data URL，不用另开静态文件目录。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import '../public/skin-format.js'
import { isWin } from './util.js'

const F = globalThis.NiumaSkinFormat
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }
const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' }
const MAX_IMAGE = 4 * 1024 * 1024

export const skinsDir = () => path.join(os.homedir(), '.niuma', 'skins')

function inside(dir, p) {
  const d = path.resolve(dir)
  return p === d || p.startsWith(d + path.sep)
}

/** 皮肤文件里写的图片文件名 → data URL。图片必须在皮肤文件夹里面。 */
function inlineImage(dir, folder, name) {
  const p = path.resolve(folder, name)
  if (!inside(dir, p)) throw new Error(`图片 ${name} 要放在皮肤文件夹里`)
  const mime = MIME[path.extname(p).toLowerCase()]
  if (!mime) throw new Error(`图片 ${name} 只支持 png、jpg、gif、webp`)
  let st
  try {
    st = fs.statSync(p)
  } catch {
    throw new Error(`找不到图片 ${name}`)
  }
  if (st.size > MAX_IMAGE) throw new Error(`图片 ${name} 太大了（超过 4MB）`)
  return `data:${mime};base64,${fs.readFileSync(p).toString('base64')}`
}

function readSkin(dir, file, folder, id, withImages) {
  const raw = F.parse(fs.readFileSync(file, 'utf8'))
  const problems = []
  const images = { ...(raw.images && typeof raw.images === 'object' ? raw.images : {}) }
  for (const k of F.IMAGE_KEYS) {
    const v = images[k]
    if (!withImages) delete images[k]
    if (!withImages || typeof v !== 'string' || !v || v.startsWith('data:')) continue
    try {
      images[k] = inlineImage(dir, folder, v)
    } catch (e) {
      delete images[k]
      problems.push(e.message)
    }
  }
  const skin = F.normalize({ ...raw, images }, { id })
  skin.warnings.unshift(...problems)
  return skin
}

/** 列出所有自制皮肤。坏掉的文件不影响别的，原因放在 errors 里给页面看。images: false 只要名字（桌面版菜单用）。 */
export function listSkins({ dir = skinsDir(), images = true } = {}) {
  const skins = []
  const errors = []
  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return { dir, skins, errors }
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  const seen = new Set(F.BUILTIN)
  for (const ent of entries) {
    let file, folder, id
    if (ent.isFile() && /\.json$/i.test(ent.name)) {
      file = path.join(dir, ent.name)
      folder = dir
      id = ent.name.replace(/\.json$/i, '')
    } else if (ent.isDirectory() && fs.existsSync(path.join(dir, ent.name, 'skin.json'))) {
      file = path.join(dir, ent.name, 'skin.json')
      folder = path.join(dir, ent.name)
      id = ent.name
    } else continue
    try {
      const skin = readSkin(dir, file, folder, id, images)
      // 文件名就是皮肤的 id：换文件名就是换 id，免得两个皮肤抢一个名字
      skin.id = F.toId(id) || skin.id
      let unique = skin.id
      for (let n = 2; seen.has(unique); n++) unique = `${skin.id}-${n}`
      skin.id = unique
      seen.add(unique)
      skin.file = file
      skins.push(skin)
      if (skin.warnings.length) errors.push({ file, id: skin.id, message: skin.warnings.join('；') })
    } catch (e) {
      errors.push({ file, message: e.message })
    }
  }
  return { dir, skins, errors }
}

/** 找到一个皮肤现在存在哪：单个文件，或者文件夹 */
function locate(dir, id) {
  const single = path.join(dir, `${id}.json`)
  if (fs.existsSync(single)) return { file: single, folder: dir, prefix: `${id}-` }
  const folder = path.join(dir, id)
  if (fs.existsSync(path.join(folder, 'skin.json'))) return { file: path.join(folder, 'skin.json'), folder, prefix: '' }
  return null
}

/**
 * 保存编辑器里做好的皮肤。replace = 改的是已有的这个皮肤；否则是新皮肤，名字重了自动加编号。
 * 图片从 data URL 写成文件，皮肤文件里只记文件名，方便手改。
 */
export function saveSkin(input, { replace = false, dir = skinsDir() } = {}) {
  const skin = F.normalize(input)
  const bad = skin.warnings.filter((w) => !/^base /.test(w))
  if (bad.length) throw new Error(bad.join('；'))
  let id = skin.id
  if (!replace) for (let n = 2; locate(dir, id); n++) id = `${skin.id}-${n}`
  let where = replace ? locate(dir, id) : null
  if (!where) where = { file: path.join(dir, id, 'skin.json'), folder: path.join(dir, id), prefix: '' }
  if (!inside(dir, path.resolve(where.file))) throw new Error('皮肤名字不对')
  fs.mkdirSync(where.folder, { recursive: true })
  // 旧图片先清掉（换了格式或者删了图片）
  for (const k of F.IMAGE_KEYS) {
    for (const ext of Object.values(EXT)) {
      const old = path.join(where.folder, `${where.prefix}${k}${ext}`)
      if (fs.existsSync(old)) fs.rmSync(old)
    }
  }
  const files = {}
  for (const [k, data] of Object.entries(skin.images)) {
    const m = data.match(/^data:(image\/[a-z]+);base64,(.*)$/)
    const name = `${where.prefix}${k}${EXT[m[1]]}`
    fs.writeFileSync(path.join(where.folder, name), Buffer.from(m[2], 'base64'))
    files[k] = name
  }
  fs.writeFileSync(where.file, F.toFile({ ...skin, id }, files))
  return { ...skin, id, file: where.file }
}

export function deleteSkin(id, { dir = skinsDir() } = {}) {
  if (!id || F.toId(id) !== id) throw new Error('不认识这个皮肤')
  const where = locate(dir, id)
  if (!where) throw new Error('找不到这个皮肤，可能已经删掉了')
  if (where.folder === dir) {
    fs.rmSync(where.file)
    for (const k of F.IMAGE_KEYS) for (const ext of Object.values(EXT)) fs.rmSync(path.join(dir, `${where.prefix}${k}${ext}`), { force: true })
  } else fs.rmSync(where.folder, { recursive: true, force: true })
  return { ok: true }
}

/** 用系统的文件管理器打开皮肤文件夹 */
export function openSkinsFolder(dir = skinsDir()) {
  fs.mkdirSync(dir, { recursive: true })
  const [cmd, args] = isWin ? ['explorer', [dir]] : process.platform === 'darwin' ? ['open', [dir]] : ['xdg-open', [dir]]
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore' })
  child.on('error', () => {})
  child.unref()
  return { ok: true, dir }
}
