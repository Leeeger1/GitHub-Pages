import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { deleteSkin, listSkins, saveSkin } from '../src/skins.js'

const F = globalThis.NiumaSkinFormat
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'niuma-skins-'))
const PNG = fs.readFileSync(path.join(root, 'public', 'icon.png'))

test('skin files may have comments and trailing commas', () => {
  const raw = F.parse(`﻿// 说明
    {
      "name": "海边", // 名字
      "colors": { "accent": "#1e9bd7", /* 强调色 */ },
      "author": "http://example.com // 不是注释",
    }`)
  assert.deepEqual(raw, { name: '海边', colors: { accent: '#1e9bd7' }, author: 'http://example.com // 不是注释' })
  assert.throws(() => F.parse('{ "name": '), /格式不对/)
})

test('a skin only keeps real colors, images and choices', () => {
  const s = F.normalize(
    {
      name: '<b>坏</b>名字',
      base: 'nope',
      colors: { bg: '#fff', accent: 'red"/><script>alert(1)</script>', ink: 'rgb(1, 2, 3)', panel: 'url(javascript:alert(1))' },
      room: { wall: '#eee', sky: ['#1', '#2', '#3'], window: 'sea', particles: 'fireworks', catEars: 'yes', cat: true },
      images: { wall: 'data:image/png;base64,AAAA', window: 'data:image/svg+xml;base64,AAAA' },
      font: 'x; } body { display:none',
    },
    { id: 'sakura' },
  )
  assert.equal(s.id, 'my-sakura', 'a custom skin never takes a built-in id')
  assert.equal(s.name, 'b坏/b名字')
  assert.equal(s.base, 'sakura')
  assert.deepEqual(s.colors, { bg: '#fff', ink: 'rgb(1, 2, 3)' })
  assert.deepEqual(s.room, { wall: ['#eee', '#eee'], window: 'sea', cat: true })
  assert.deepEqual(s.images, { wall: 'data:image/png;base64,AAAA' })
  assert.equal(s.font, '')
  assert.ok(s.warnings.length >= 6)
  assert.equal(F.toId('../../etc'), 'etc')
})

test('one main color gives a full, valid palette in light and dark', () => {
  for (const dark of [false, true]) {
    const p = F.paletteFrom('#1e9bd7', dark)
    const s = F.normalize({ name: 'p', dark, colors: p.colors, room: p.room })
    assert.deepEqual(s.warnings, [])
    assert.equal(Object.keys(s.colors).length, 10)
    assert.equal(Object.keys(s.room).length, Object.keys(F.ROOM_COLORS).length)
  }
})

test('the template and examples in docs/skins stay valid', () => {
  const dir = path.join(root, 'docs', 'skins')
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
  assert.ok(files.includes('template.json'))
  for (const f of files) {
    const s = F.normalize(F.parse(fs.readFileSync(path.join(dir, f), 'utf8')), { id: f.replace('.json', '') })
    assert.deepEqual(s.warnings, [], f)
  }
  // 模板要把每一项都写出来，当说明用
  const t = F.parse(fs.readFileSync(path.join(dir, 'template.json'), 'utf8'))
  for (const k of F.COLOR_KEYS) assert.ok(k in t.colors, `template colors.${k}`)
  for (const k of [...Object.keys(F.ROOM_COLORS), ...Object.keys(F.ROOM_CHOICES), ...F.ROOM_FLAGS]) assert.ok(k in t.room, `template room.${k}`)
})

test('the skins folder: single files, folders with images, broken files', () => {
  const dir = tmp()
  fs.copyFileSync(path.join(root, 'docs', 'skins', 'minimal.json'), path.join(dir, '薄荷.json'))
  fs.mkdirSync(path.join(dir, 'wall'))
  fs.writeFileSync(path.join(dir, 'wall', 'bg.png'), PNG)
  fs.writeFileSync(path.join(dir, 'wall', 'skin.json'), JSON.stringify({ name: '墙纸', base: 'neko', images: { wall: 'bg.png', window: '../../secret.png' } }))
  fs.writeFileSync(path.join(dir, 'broken.json'), '{ "name": ')
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'ignored')

  const { skins, errors } = listSkins({ dir })
  assert.deepEqual(skins.map((s) => [s.id, s.name]).sort(), [['wall', '墙纸'], ['薄荷', '薄荷']])
  const wall = skins.find((s) => s.id === 'wall')
  assert.equal(wall.images.wall, `data:image/png;base64,${PNG.toString('base64')}`)
  assert.equal(wall.images.window, undefined)
  assert.ok(errors.some((e) => /secret\.png 要放在皮肤文件夹里/.test(e.message)))
  assert.ok(errors.some((e) => /broken\.json$/.test(e.file) && /格式不对/.test(e.message)))
  assert.deepEqual(listSkins({ dir, images: false }).skins.find((s) => s.id === 'wall').images, {})
  assert.deepEqual(listSkins({ dir: path.join(dir, 'missing') }).skins, [])
})

test('saving from the editor writes a folder with image files; replace and delete', () => {
  const dir = tmp()
  const img = `data:image/png;base64,${PNG.toString('base64')}`
  const first = saveSkin({ name: '海边度假', base: 'sakura', colors: { accent: '#1e9bd7' }, room: { window: 'image' }, images: { window: img } }, { dir })
  assert.equal(first.id, '海边度假')
  const folder = path.join(dir, '海边度假')
  assert.deepEqual(fs.readdirSync(folder).sort(), ['skin.json', 'window.png'])
  const onDisk = F.parse(fs.readFileSync(path.join(folder, 'skin.json'), 'utf8'))
  assert.deepEqual(onDisk.images, { window: 'window.png' }, 'the file names the image instead of embedding it')
  assert.equal(listSkins({ dir }).skins[0].images.window, img)

  // 同名新皮肤不会盖掉旧的
  assert.equal(saveSkin({ name: '海边度假' }, { dir }).id, '海边度假-2')
  // 改已有的：图片去掉了，旧图片也要删
  saveSkin({ id: '海边度假', name: '海边度假', colors: { accent: '#e0584a' } }, { dir, replace: true })
  assert.deepEqual(fs.readdirSync(folder), ['skin.json'])
  assert.equal(listSkins({ dir }).skins.find((s) => s.id === '海边度假').colors.accent, '#e0584a')
  // 手写的单文件皮肤，改完还写回原来的文件
  fs.copyFileSync(path.join(root, 'docs', 'skins', 'minimal.json'), path.join(dir, 'mint.json'))
  saveSkin({ id: 'mint', name: '薄荷', colors: { accent: '#00aa77' }, images: { wall: img } }, { dir, replace: true })
  assert.ok(fs.existsSync(path.join(dir, 'mint-wall.png')))
  assert.ok(!fs.existsSync(path.join(dir, 'mint')))

  assert.throws(() => saveSkin({ name: 'x', colors: { bg: '#12' } }, { dir }), /不是颜色/)
  deleteSkin('mint', { dir })
  assert.ok(!fs.existsSync(path.join(dir, 'mint.json')) && !fs.existsSync(path.join(dir, 'mint-wall.png')))
  deleteSkin('海边度假-2', { dir })
  assert.deepEqual(listSkins({ dir }).skins.map((s) => s.id), ['海边度假'])
  assert.throws(() => deleteSkin('../..', { dir }), /不认识/)
  assert.throws(() => deleteSkin('nope', { dir }), /找不到/)
})
