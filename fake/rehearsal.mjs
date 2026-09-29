// Rehearsal company for `niuma --fake` and the tests: fake Claude / Codex CLIs plus two
// project groups behind a local fake OpenAI-compatible API. Nothing costs money or changes files.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startFakeOpenAI } from './openai-server.mjs'

/** Rehearsal company: fake Claude / Codex CLIs plus two groups behind a local fake API. */
export async function rehearsalConfig(config, root) {
  const api = await startFakeOpenAI()
  const node = (file) => [process.execPath, path.join(root, 'fake', file)]
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'niuma-rehearsal-'))
  return {
    close: api.close,
    config: {
      ...config,
      groups: [
        { id: 'claude', name: 'Claude 组', type: 'claude-cli', command: node('claude.mjs'), color: '#c4602f', models: { hard: 'opus', medium: 'sonnet', easy: 'haiku' } },
        { id: 'codex', name: 'Codex 组', type: 'codex-cli', command: node('codex.mjs'), color: '#16837a' },
        { id: 'deepseek', name: 'DeepSeek 组', type: 'openai-api', baseUrl: api.url, apiKey: 'rehearsal', models: { hard: 'deepseek-reasoner', medium: 'deepseek-chat', easy: 'deepseek-chat' } },
        { id: 'qwen', name: 'Qwen 组', type: 'openai-api', baseUrl: api.url, apiKey: 'rehearsal', model: 'qwen3-coder' },
      ],
      employees: [...config.employees.filter((e) => ['claude', 'codex'].includes(e.group)), { id: 'writer', skill: 'writer', group: 'deepseek' }],
      brain: 'claude',
      brainModel: '',
      autonomy: 'full',
      git: { autoInit: false, autoCommit: false },
      meeting: { ...config.meeting, save: false },
      statsFile: path.join(tmp, 'stats.json'),
      logDir: path.join(tmp, 'logs'),
    },
  }
}

