// Skills (技能) are Markdown files: front matter (name, description, group, look) plus working
// rules. Every skill file placed in a skills folder becomes an employee (员工).
// Both `name.md` and Claude Code style `name/SKILL.md` layouts are accepted.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function parseSkill(text, id) {
  const m = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  const meta = {}
  let body = String(text)
  if (m) {
    body = m[2]
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^([\w-]+)\s*:\s*(.*)$/)
      if (kv) meta[kv[1].toLowerCase()] = kv[2].trim().replace(/^["']|["']$/g, '')
    }
  }
  return {
    id,
    name: meta.name || id,
    description: meta.description || '',
    group: meta.group || '',
    look: meta.look || '',
    instructions: body.trim(),
  }
}

export function skillDirs(root, workdir) {
  return [
    { dir: path.join(root, 'skills'), source: 'builtin' },
    { dir: path.join(os.homedir(), '.shaniu', 'skills'), source: 'user' },
    { dir: path.join(workdir, '.shaniu', 'skills'), source: 'project' },
  ]
}

/** Later folders override earlier ones, so a user can redefine a built-in skill. */
export function loadSkills(dirs) {
  const skills = new Map()
  for (const { dir, source } of dirs) {
    let entries = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      let file = null
      let id = null
      if (e.isFile() && e.name.endsWith('.md')) {
        file = path.join(dir, e.name)
        id = e.name.slice(0, -3)
      } else if (e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'SKILL.md'))) {
        file = path.join(dir, e.name, 'SKILL.md')
        id = e.name
      }
      if (!file || !/^[\w-]+$/.test(id)) continue
      try {
        skills.set(id, { ...parseSkill(fs.readFileSync(file, 'utf8'), id), source, file })
      } catch {}
    }
  }
  return skills
}

export function skillId(name) {
  const ascii = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return ascii || `skill-${Date.now().toString(36)}`
}

export function writeSkill(dir, { id, name, description, group, look, instructions }) {
  fs.mkdirSync(dir, { recursive: true })
  let file = path.join(dir, `${id}.md`)
  for (let i = 2; fs.existsSync(file); i++) file = path.join(dir, `${id}-${i}.md`)
  const front = [`name: ${name}`, `description: ${description}`, group ? `group: ${group}` : '', look ? `look: ${look}` : ''].filter(Boolean)
  fs.writeFileSync(file, `---\n${front.join('\n')}\n---\n${instructions.trim()}\n`)
  return file
}
