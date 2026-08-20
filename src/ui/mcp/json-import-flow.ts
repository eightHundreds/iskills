import { homedir } from 'node:os';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { DomainError } from '../../domain/errors.js';
import {
  classifyJsonSnippets,
  importSnippetToCollection,
  listCollectedMcps,
  parseMcpJsonSnippet,
  type JsonImportCandidate,
  type McpSecretValues,
  type ParsedMcpSnippet,
} from '../../domain/mcp/index.js';
import { t } from '../../i18n/index.js';
import { recipeDisplayLine } from './format.js';

export interface JsonImportReviewItem {
  name: string;
  selectable: boolean;
  defaultSelected: boolean;
  title: string;
  hint: string;
}

export interface JsonImportFlowHost {
  readClipboard: () => Promise<string | undefined>;
  promptFallback: () => Promise<string | undefined>;
  promptName: (initial?: string) => Promise<string | undefined>;
  review: (items: JsonImportReviewItem[]) => Promise<string[] | undefined>;
  confirmReplace: (name: string) => Promise<boolean>;
}

export interface JsonImportFlowResult {
  imported: number;
  notices: string[];
}

export async function runMcpJsonImportFlow(
  host: JsonImportFlowHost
): Promise<JsonImportFlowResult | undefined> {
  const snippets = await loadSnippets(host);
  if (!snippets) return undefined;
  const collection = await listCollectedMcps();
  const candidates = classifyJsonSnippets(collection, snippets);
  const selected = await host.review(candidates.map(toReviewItem));
  if (!selected?.length) return undefined;
  const chosen = new Set(selected);
  let imported = 0;
  const notices: string[] = [];
  for (const candidate of candidates) {
    if (!chosen.has(candidate.snippet.name)) continue;
    const result = await importSnippetToCollection(candidate.snippet, {
      confirmReplace: async ({ name }) => host.confirmReplace(name),
    });
    if (result.result === 'imported') imported += 1;
    if (result.result === 'collected-as') {
      notices.push(t('mcp.alreadyCollectedAs', { name: result.name }));
    }
  }
  return { imported, notices };
}

export async function resolveJsonSource(raw: string): Promise<string> {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return trimmed;
  const expanded = trimmed.startsWith('~/') ? join(homedir(), trimmed.slice(2)) : trimmed;
  try {
    if ((await stat(expanded)).isFile()) return await readFile(expanded, 'utf8');
  } catch {
    /* not a readable file — treat as JSON text */
  }
  return trimmed;
}

async function loadSnippets(host: JsonImportFlowHost): Promise<ParsedMcpSnippet[] | undefined> {
  const clipboard = await host.readClipboard();
  const fromClipboard = clipboard ? parseMcpJsonSnippet(clipboard) : undefined;
  let parsed = fromClipboard?.ok ? fromClipboard : undefined;
  if (!parsed) {
    const entered = await host.promptFallback();
    if (entered === undefined) return undefined;
    const text = await resolveJsonSource(entered);
    const next = parseMcpJsonSnippet(text);
    if (!next.ok) {
      throw new DomainError(next.error === 'no-servers' ? 'mcp.jsonNoServers' : 'mcp.jsonInvalid');
    }
    parsed = next;
  }
  const entries = [...parsed.entries];
  if (entries.length === 1 && entries[0]?.unnamed) {
    const name = await host.promptName();
    if (!name?.trim()) return undefined;
    entries[0] = { ...entries[0], name: name.trim(), unnamed: false };
  }
  return entries;
}

function toReviewItem(candidate: JsonImportCandidate): JsonImportReviewItem {
  const { snippet, status } = candidate;
  const endpoint = recipeDisplayLine(snippet.recipe);
  const title = `${snippet.name || '—'}  ${snippet.recipe.transport}  ${endpoint}`;
  return {
    name: snippet.name,
    selectable: status === 'importable' || status === 'conflict',
    defaultSelected: status === 'importable',
    title,
    hint: reviewHint(candidate),
  };
}

function reviewHint(candidate: JsonImportCandidate): string {
  if (candidate.status === 'collected-as' && candidate.collectedAs) {
    return t('mcp.jsonCollectedAs', { name: candidate.collectedAs });
  }
  if (candidate.status === 'unchanged') return t('mcp.jsonUnchanged');
  if (candidate.status === 'conflict') return t('mcp.jsonConflict');
  return secretHint(
    candidate.snippet.recipe.headerKeys,
    candidate.snippet.recipe.envKeys,
    candidate.snippet.secrets
  );
}

function secretHint(headerKeys: string[], envKeys: string[], secrets: McpSecretValues): string {
  const overlay = [...Object.keys(secrets.headers), ...Object.keys(secrets.env)];
  if (overlay.length) return t('mcp.jsonSecretKeys', { keys: overlay.join(', ') });
  const names = [...headerKeys, ...envKeys];
  if (names.length) return t('mcp.jsonSecretPlaceholders', { keys: names.join(', ') });
  return '';
}
