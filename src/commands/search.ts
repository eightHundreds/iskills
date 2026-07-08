import { parseArgs } from 'node:util';
import { assertSkillName, listCollection, sanitizeTerminal } from '../core.js';
import { confirm } from '../prompts.js';
import type { RemoteSkill } from '../types.js';
import { searchRemoteSkill } from '../ui/search.js';
import { InkSession } from '../ui/session.js';
import { importRemoteSkillToCollection } from './library.js';

const GITHUB_SOURCE =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/(?!\.{1,2}$)[A-Za-z0-9_.-]{1,100}$/;

async function searchSkills(query: string, signal: AbortSignal): Promise<RemoteSkill[]> {
  const params = new URLSearchParams({ q: query, limit: '10' });
  const base = (process.env.SKILLS_API_URL || 'https://skills.sh').replace(/\/$/, '');
  const response = await fetch(`${base}/api/search?${params}`, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
  });
  if (!response.ok) throw new Error(`搜索失败（HTTP ${response.status}）`);
  const payload = await response.json() as { skills?: unknown };
  if (!Array.isArray(payload.skills)) throw new Error('搜索服务返回了无效数据');

  return payload.skills.flatMap((value): RemoteSkill[] => {
    if (!value || typeof value !== 'object') return [];
    const item = value as Record<string, unknown>;
    if (typeof item.name !== 'string' || typeof item.source !== 'string') return [];
    const name = sanitizeTerminal(item.name);
    const source = sanitizeTerminal(item.source);
    try {
      assertSkillName(name);
    } catch {
      return [];
    }
    if (!GITHUB_SOURCE.test(source)) return [];
    return [{
      name,
      source,
      installs: typeof item.installs === 'number' && Number.isFinite(item.installs)
        ? Math.max(0, item.installs)
        : 0,
    }];
  }).sort((left, right) => right.installs - left.installs);
}

export async function commandSearch(argv: string[]): Promise<void> {
  const { positionals } = parseArgs({ args: argv, allowPositionals: true });
  if (!process.stdin.isTTY) throw new Error('search 需要交互式终端');
  const collection = await listCollection();
  const collectedNames = new Set(collection.map((skill) => skill.name.toLowerCase()));
  const session = new InkSession();
  let selected: RemoteSkill | undefined;
  try {
    selected = await searchRemoteSkill(
      positionals.join(' ').trim(),
      collectedNames,
      searchSkills,
      session
    );
  } finally {
    session.close();
  }
  if (!selected) return;
  const exists = collectedNames.has(selected.name.toLowerCase());
  if (exists && !(await confirm(`收藏夹已存在 ${selected.name}，替换为 ${selected.source} 的版本吗？`))) {
    return;
  }
  const name = await importRemoteSkillToCollection(selected.source, selected.name, exists);
  console.log(`已收藏 ${name}。`);
}
