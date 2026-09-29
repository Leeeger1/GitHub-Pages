// The company: project groups (项目组, one per model backend) and employees (员工, one per skill).
import { COST_ZH, TIER_ZH } from './models.js'
import { loadSkills, skillDirs } from './skills.js'
import { ClaudeCliWorker, CodexCliWorker } from './workers/cli.js'
import { OpenAIWorker } from './workers/openai.js'

const TYPES = { 'claude-cli': ClaudeCliWorker, 'codex-cli': CodexCliWorker, 'openai-api': OpenAIWorker }
const TYPE_ZH = { 'claude-cli': 'Claude Code', 'codex-cli': 'Codex', 'openai-api': 'API' }
const BRAND_COLORS = [
  [/deepseek/i, '#4d6bfe'],
  [/qwen|tongyi/i, '#7a52e0'],
  [/kimi|moonshot/i, '#3a4a66'],
  [/glm|zhipu/i, '#2f78d6'],
  [/gemini/i, '#3c7be0'],
]
const PALETTE = ['#3d6fd9', '#8e5cd9', '#c98a0c', '#4f9e3a', '#b5533a', '#2f95b5']
const DIFFS = ['hard', 'medium', 'easy']

export class Team {
  constructor(config, { root, workdir, logDir }) {
    this.config = config
    this.root = root
    this.workdir = workdir
    this.logDir = logDir
    this.load()
  }

  load() {
    const ctx = { workdir: this.workdir, logDir: this.logDir, autonomy: this.config.autonomy }
    const old = this.groups
    this.groups = new Map()
    let extra = 0
    for (const g of this.config.groups || []) {
      if (!g || g.enabled === false || !g.id) continue
      const Cls = TYPES[g.type]
      if (!Cls) {
        console.warn(`[傻妞] 项目组 ${g.id} 的 type「${g.type}」不认识，可选：${Object.keys(TYPES).join(' / ')}`)
        continue
      }
      const w = new Cls(g, ctx)
      w.name = g.name || g.id
      const brand = BRAND_COLORS.find(([re]) => re.test(`${g.id} ${g.model || ''} ${g.baseUrl || ''}`))
      w.color = g.color || brand?.[1] || PALETTE[extra++ % PALETTE.length]
      const prev = old?.get(g.id)
      if (prev) Object.assign(w, { available: prev.available, version: prev.version, note: prev.note })
      this.groups.set(g.id, w)
    }

    this.skills = loadSkills(skillDirs(this.root, this.workdir))
    this.employees = []
    const add = ({ id, skill, group, name }) => {
      const s = this.skills.get(skill) || this.skills.get('generalist')
      if (!s || !this.groups.has(group)) return
      let eid = String(id || s.id)
      if (this.employees.some((e) => e.id === eid)) eid = `${eid}-${group}`
      if (this.employees.some((e) => e.id === eid)) return
      this.employees.push({ id: eid, name: name || s.name, skill: s, group })
    }
    for (const e of this.config.employees || []) if (e && e.enabled !== false) add(e)
    // Groups nobody was assigned to in the config get a generalist, even after skill files hire more people.
    const staffed = new Set(this.employees.map((e) => e.group))
    for (const g of this.groups.values()) {
      if (!staffed.has(g.id)) add({ id: g.id, skill: 'generalist', group: g.id, name: `${g.name.replace(/\s*组$/, '')}通才` })
    }
    for (const s of this.skills.values()) {
      if (s.group && s.source !== 'builtin' && !this.employees.some((e) => e.skill.id === s.id && e.group === s.group)) {
        add({ id: s.id, skill: s.id, group: s.group })
      }
    }
  }

  async check() {
    await Promise.all([...this.groups.values()].map((g) => g.check().catch(() => (g.available = false))))
  }

  employee(id) {
    return this.employees.find((e) => e.id === id)
  }

  groupOf(empId) {
    const e = this.employee(empId)
    return e ? this.groups.get(e.group) : null
  }

  isAvailable(empId) {
    return !!this.groupOf(empId)?.available
  }

  /** Find an employee by id, name or skill, as the planner (or the boss) wrote it. */
  resolve(ref) {
    const r = String(ref || '').trim().toLowerCase()
    if (!r) return null
    return (
      this.employees.find((e) => e.id.toLowerCase() === r) ||
      this.employees.find((e) => e.name.toLowerCase() === r) ||
      this.employees.find((e) => e.skill.id.toLowerCase() === r) ||
      this.employees.find((e) => r.includes(e.id.toLowerCase()) || r.includes(e.name.toLowerCase())) ||
      this.groupLead(r) ||
      null
    )
  }

  /** "@claude" or "@Claude 组": the first available employee of that group. */
  groupLead(r) {
    const g = [...this.groups.values()].find((x) => x.id.toLowerCase() === r || x.name.toLowerCase().replace(/\s*组$/, '') === r.replace(/\s*组$/, ''))
    if (!g) return null
    const staff = this.employees.filter((e) => e.group === g.id)
    return staff.find((e) => e.skill.id === 'generalist') || staff[0] || null
  }

  modelsLine(g) {
    const seen = new Map()
    for (const d of DIFFS) {
      const m = g.modelFor(d) || '默认模型'
      const p = g.profileFor(d)
      if (!seen.has(m)) seen.set(m, { diffs: [], p })
      seen.get(m).diffs.push({ hard: '难', medium: '中', easy: '易' }[d])
    }
    return [...seen.entries()].map(([m, { diffs, p }]) => `${diffs.join('/')}→${m}（能力${TIER_ZH[p.tier]}，${COST_ZH[p.cost]}）`).join('；')
  }

  /** Public view for the web page. */
  roster() {
    const groups = [...this.groups.values()].map((g) => ({
      id: g.id,
      name: g.name,
      type: g.type,
      typeLabel: TYPE_ZH[g.type],
      color: g.color,
      available: g.available,
      note: g.note,
      version: g.version,
      models: Object.fromEntries(DIFFS.map((d) => [d, g.modelFor(d)])),
      strengths: g.profileFor('medium').strengths,
    }))
    const employees = this.employees.map((e) => {
      const g = this.groups.get(e.group)
      return {
        id: e.id,
        name: e.name,
        group: e.group,
        skill: e.skill.id,
        description: e.skill.description,
        look: e.skill.look || 'none',
        color: g.color,
        available: g.available,
      }
    })
    return { groups, employees }
  }
}
