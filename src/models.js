// What 傻妞 knows about models: how strong, how pricey, what they are good at.
// Matched against a worker's model name (or its CLI type when no model is set).
// Any of tier / cost / strengths can be overridden per worker in the config.

export const TIER_ZH = { strong: '强', balanced: '中', fast: '快' }
export const COST_ZH = { high: '贵', medium: '适中', low: '便宜' }

const PROFILES = [
  { match: /fable|mythos/i, tier: 'strong', cost: 'high', strengths: '最强的推理和长程任务，适合最难的架构和疑难问题' },
  { match: /opus/i, tier: 'strong', cost: 'high', strengths: '深度推理和长程编码，适合架构设计、复杂重构、疑难 bug、关键审查' },
  { match: /sonnet/i, tier: 'strong', cost: 'medium', strengths: '编码能力强、速度和成本均衡，适合大多数开发任务和代码审查' },
  { match: /haiku/i, tier: 'fast', cost: 'low', strengths: '又快又便宜，适合小改动、文档、简单脚本和格式整理' },
  { match: /deepseek.*(pro|reason|r1)/i, tier: 'strong', cost: 'low', strengths: '深度推理、复杂编码和算法，性价比很高' },
  { match: /deepseek/i, tier: 'balanced', cost: 'low', strengths: '又快又便宜的通用编码，中文好，适合常规功能、脚本、文档' },
  { match: /qwen.*max/i, tier: 'strong', cost: 'medium', strengths: '通义旗舰，推理和中文都强，适合复杂任务' },
  { match: /qwen.*coder/i, tier: 'balanced', cost: 'low', strengths: '专注代码生成和补全，适合写功能、写测试' },
  { match: /qwen/i, tier: 'balanced', cost: 'low', strengths: '中文理解好，通用任务和文档' },
  { match: /kimi-?k3/i, tier: 'strong', cost: 'medium', strengths: 'Kimi 旗舰，超长上下文，适合通读大仓库和复杂编码' },
  { match: /kimi|moonshot/i, tier: 'balanced', cost: 'low', strengths: '超长上下文，适合阅读大量代码和文档、整理总结' },
  { match: /glm-?5/i, tier: 'strong', cost: 'low', strengths: '智谱旗舰，编码和工具调用强，中文好' },
  { match: /glm|zhipu/i, tier: 'balanced', cost: 'low', strengths: '中文好，通用编码和工具调用' },
  { match: /gemini.*(flash|lite)/i, tier: 'fast', cost: 'low', strengths: '速度快、上下文长，适合批量的小任务' },
  { match: /gemini/i, tier: 'strong', cost: 'medium', strengths: '超长上下文，适合通读大仓库、跨文件分析' },
  { match: /codex/i, tier: 'strong', cost: 'medium', strengths: '实现目标明确的功能、写测试、跑命令定位报错' },
  { match: /(gpt|o\d).*(mini|nano)/i, tier: 'fast', cost: 'low', strengths: '便宜快速，适合简单改动和文档' },
  { match: /gpt-5|gpt5|\bo3\b|\bo4\b/i, tier: 'strong', cost: 'medium', strengths: '推理和编码都强，适合复杂功能和排错' },
  { match: /mini|nano|flash|lite|turbo|small/i, tier: 'fast', cost: 'low', strengths: '便宜快速，适合简单任务' },
]

const TYPE_DEFAULTS = {
  'claude-cli': { tier: 'strong', cost: 'medium', strengths: 'Claude Code：理解模糊需求、架构设计、跨文件改动和重构、前端界面、代码审查' },
  'codex-cli': { tier: 'strong', cost: 'medium', strengths: 'Codex：快速实现明确的功能、写脚本和测试、跑命令定位报错、算法' },
  'openai-api': { tier: 'balanced', cost: 'low', strengths: '通用编码' },
}

export function modelProfile(worker) {
  const found = worker.model ? PROFILES.find((p) => p.match.test(worker.model)) : null
  const base = found || TYPE_DEFAULTS[worker.type] || TYPE_DEFAULTS['openai-api']
  return {
    tier: worker.tier || base.tier,
    cost: worker.cost || base.cost,
    strengths: worker.strengths || base.strengths,
  }
}

const TIER_RANK = { fast: 1, balanced: 2, strong: 3 }
const COST_RANK = { low: 1, medium: 2, high: 3 }

/** How well a worker fits a task of the given difficulty (higher is better). */
export function fitScore(profile, difficulty) {
  const tier = TIER_RANK[profile.tier] || 2
  const cost = COST_RANK[profile.cost] || 2
  if (difficulty === 'hard') return tier * 10 - cost
  if (difficulty === 'easy') return (4 - cost) * 10 + (tier === 1 ? 3 : 0)
  return (tier >= 2 ? 20 : 8) + (4 - cost) * 3 + tier
}
