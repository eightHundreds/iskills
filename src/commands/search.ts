import { parseArgs } from 'node:util';
import { assertSkillName, errorMessage, listCollection, sanitizeTerminal } from '../domain/core.js';
import { confirm } from '../ui/prompts.js';
import type { RemoteSkill, SkillMetadata } from '../domain/types.js';
import { searchRemoteSkill } from '../ui/search.js';
import { InkSession } from '../ui/session.js';
import { importRemoteSkillToCollection } from './library.js';

const GITHUB_SOURCE =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/(?!\.{1,2}$)[A-Za-z0-9_.-]{1,100}$/;

function formatIdentity(skill: SkillMetadata): string {
  const source = skill.source;
  const base = source.url || source.id || source.type;
  const path = source.path && source.path !== '.' ? `/${source.path}` : '';
  return sanitizeTerminal(`${base.replace(/\/$/, '')}${path}`);
}

function printImportResult(result: Awaited<ReturnType<typeof importRemoteSkillToCollection>>): void {
  if (result.status === 'imported') console.log(`已收藏 ${result.name}。`);
  if (result.status === 'unchanged') {
    console.log(`${result.name} 已收藏自同一来源；如需更新请使用 update。`);
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
      json: { type: 'boolean' },
      collect: { type: 'string' },
      replace: { type: 'boolean' },
    },
    allowPositionals: true,
  });
  if (values.json && values.collect) throw new Error('--json 和 --collect 不能同时使用');
  let query = positionals.join(' ').trim();
  if (values.collect && !query) query = values.collect.split('/').at(-1) || '';

  if (values.json || values.collect) {
    if (query.length < 2) throw new Error('搜索关键词至少需要 2 个字符');
    const results = await searchSkills(
      query,
      new AbortController().signal,
      values.collect ? 100 : 10
    );
    if (values.json) {
      console.log(JSON.stringify({ query, results }, null, 2));
      return;
    }
    const selected = results.find((skill) => skill.resultId === values.collect);
    if (!selected) {
      throw new Error(`搜索结果中不存在 resultId：${sanitizeTerminal(values.collect || '')}`);
    }
    console.error('正在校验并收藏…');
    const result = await importRemoteSkillToCollection(selected.source, selected.name, {
      replace: values.replace ?? false,
    });
    printImportResult(result);
    return;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('交互搜索需要 stdin 和 stdout TTY；自动化请使用 search <关键词> --json');
  }
  const collection = await listCollection();
  const collectedNames = new Set(collection.map((skill) => skill.name.toLowerCase()));
  const session = new InkSession();
  let selected: RemoteSkill | undefined;
  try {
    selected = await searchRemoteSkill(
      {
        initialQuery: positionals.join(' ').trim(),
        collectedNames,
        search: searchSkills,
      },
      session
    );
  } finally {
    session.close();
  }
  if (!selected) return;
  while (true) {
    console.error('正在校验并收藏…');
    try {
      const result = await importRemoteSkillToCollection(selected.source, selected.name, {
        replace: values.replace ?? false,
        confirmReplace: (current, incoming) => confirm(
          `替换 ${selected.name}：${formatIdentity(current)} → ${formatIdentity(incoming)}？`
        ),
      });
      printImportResult(result);
      return;
    } catch (error) {
      console.error(`收藏失败：${errorMessage(error)}`);
      if (!(await confirm('重试收藏吗？'))) {
        process.exitCode = 1;
        return;
      }
    }
  }
}
