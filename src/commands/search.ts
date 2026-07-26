import { parseArgs } from 'node:util';
import {
  assertSkillName,
  errorMessage,
  listCollection,
  normalizeGitRepositoryIdentity,
  sanitizeTerminal,
} from '../domain/core.js';
import { Modal } from '../ui/overlay/static.js';
import type {
  CollectedSkill,
  CollectionMatch,
  RemoteSkill,
  SkillMetadata,
} from '../domain/types.js';
import { searchRemoteSkill } from '../ui/search/index.js';
import { importRemoteSkillToCollection } from './library.js';

const GITHUB_SOURCE =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/(?!\.{1,2}$)[A-Za-z0-9_.-]{1,100}$/;

function formatIdentity(skill: SkillMetadata): string {
  const source = skill.source;
  const base = source.url || source.id || source.type;
  const path = source.path && source.path !== '.' ? `/${source.path}` : '';
  return sanitizeTerminal(`${base.replace(/\/$/, '')}${path}`);
}

/**
 * The in-repository source path is only known after cloning, so a matching
 * repository cannot prove same origin yet; only a different repository is
 * conclusive before the clone.
 */
function collectionMatch(
  collection: CollectedSkill[],
  skill: RemoteSkill
): CollectionMatch | undefined {
  const collected = collection.find(
    (item) => item.name.toLowerCase() === skill.name.toLowerCase()
  );
  if (!collected) return undefined;
  const collectedRepository = collected.source.type === 'git' && collected.source.url
    ? normalizeGitRepositoryIdentity(collected.source.url)
    : undefined;
  const incomingRepository = normalizeGitRepositoryIdentity(
    `https://github.com/${skill.source}`
  );
  return collectedRepository && collectedRepository !== incomingRepository
    ? 'conflicting-source'
    : 'unverified-source';
}

function printImportResult(result: Awaited<ReturnType<typeof importRemoteSkillToCollection>>): void {
  if (result.status === 'imported') console.log(`已收藏 ${result.name}。`);
  if (result.status === 'unchanged') {
    console.log(`${result.name} 已收藏自同一来源；可在主 TUI 中更新。`);
  }
}

async function searchSkills(
  query: string,
  signal: AbortSignal,
  limit = 10
): Promise<RemoteSkill[]> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
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
    if (
      typeof item.id !== 'string' ||
      typeof item.name !== 'string' ||
      typeof item.source !== 'string'
    ) return [];
    const resultId = sanitizeTerminal(item.id);
    const name = sanitizeTerminal(item.name);
    const source = sanitizeTerminal(item.source);
    try {
      assertSkillName(name);
    } catch {
      return [];
    }
    if (!GITHUB_SOURCE.test(source)) return [];
    if (!resultId.startsWith(`${source}/`) || /\s/.test(resultId)) return [];
    return [{
      resultId,
      name,
      source,
      installs: typeof item.installs === 'number' && Number.isFinite(item.installs)
        ? Math.max(0, item.installs)
        : 0,
    }];
  });
}

export async function commandSearch(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      replace: { type: 'boolean' },
    },
    allowPositionals: true,
  });
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('独立搜索 TUI 需要 stdin 和 stdout TTY；当前终端不支持。');
  }
  const collection = await listCollection();
  const selected = await searchRemoteSkill({
    initialQuery: positionals.join(' ').trim(),
    matchCollection: (skill) => collectionMatch(collection, skill),
    search: searchSkills,
  });
  if (!selected) return;
  while (true) {
    console.error('正在校验并收藏…');
    try {
      const result = await importRemoteSkillToCollection(selected.source, selected.name, {
        replace: values.replace ?? false,
        confirmReplace: (current, incoming) => Modal.confirm({
          title: '确认',
          message: `替换 ${selected.name}：${formatIdentity(current)} → ${formatIdentity(incoming)}？`,
        }),
      });
      printImportResult(result);
      return;
    } catch (error) {
      console.error(`收藏失败：${errorMessage(error)}`);
      if (!(await Modal.confirm({ title: '确认', message: '重试收藏吗？' }))) {
        process.exitCode = 1;
        return;
      }
    }
  }
}
