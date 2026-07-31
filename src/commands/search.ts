import { parseArgs } from 'node:util';
import {
  assertSkillName,
  classifyPreCloneCollectionMatch,
  listCollection,
  sanitizeTerminal,
} from '../domain/core.js';
import { Modal } from '../ui/overlay/static.js';
import type {
  RemoteSkill,
  SkillMetadata,
} from '../domain/types.js';
import { searchRemoteSkill } from '../ui/search/index.js';
import { DomainError } from '../domain/errors.js';
import { importRemoteSkillToCollection } from './library.js';
import { formatAppError, t } from '../i18n/index.js';

const GITHUB_SOURCE =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/(?!\.{1,2}$)[A-Za-z0-9_.-]{1,100}$/;

function formatIdentity(skill: SkillMetadata): string {
  const source = skill.source;
  const base = source.url || source.id || source.type;
  const path = source.path && source.path !== '.' ? `/${source.path}` : '';
  return sanitizeTerminal(`${base.replace(/\/$/, '')}${path}`);
}

function printImportResult(result: Awaited<ReturnType<typeof importRemoteSkillToCollection>>): void {
  if (result.status === 'imported') console.log(t('cmd.collected', { name: result.name }));
  if (result.status === 'unchanged') {
    console.log(t('cmd.collectedSameSource', { name: result.name }));
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
  if (!response.ok) {
    throw new DomainError('cmd.searchHttpFailed', { status: response.status });
  }
  const payload = await response.json() as { skills?: unknown };
  if (!Array.isArray(payload.skills)) throw new DomainError('cmd.searchInvalidPayload');

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
    throw new DomainError('cli.searchTtyRequired');
  }
  const collection = await listCollection();
  const selected = await searchRemoteSkill({
    initialQuery: positionals.join(' ').trim(),
    matchCollection: (skill) =>
      classifyPreCloneCollectionMatch(
        collection,
        skill.name,
        `https://github.com/${skill.source}`
      ),
    search: searchSkills,
  });
  if (!selected) return;
  while (true) {
    console.error(t('cmd.validatingCollect'));
    try {
      const result = await importRemoteSkillToCollection(selected.source, selected.name, {
        replace: values.replace ?? false,
        confirmReplace: (current, incoming) => Modal.confirm({
          title: t('common.confirm'),
          message: t('cmd.replaceIdentityConfirm', {
            name: selected.name,
            from: formatIdentity(current),
            to: formatIdentity(incoming),
          }),
        }),
      });
      printImportResult(result);
      return;
    } catch (error) {
      console.error(t('cmd.collectFailed', { error: formatAppError(error) }));
      if (!(await Modal.confirm({ title: t('common.confirm'), message: t('cmd.retryCollect') }))) {
        process.exitCode = 1;
        return;
      }
    }
  }
}
