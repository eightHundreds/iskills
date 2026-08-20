import JSON5 from 'json5';
import {
  classifyMcpMatch,
  findCollectedByEndpoint,
  findCollectedByName,
} from './identity.js';
import { extractFromServerObject } from './recipe.js';
import type { CollectedMcp, McpRecipe, McpSecretValues } from './types.js';

export type ParseMcpJsonError = 'invalid-json' | 'no-servers';

export interface ParsedMcpSnippet {
  name: string;
  recipe: McpRecipe;
  secrets: McpSecretValues;
  unnamed: boolean;
}

export type ParseMcpJsonResult =
  | { ok: true; entries: ParsedMcpSnippet[] }
  | { ok: false; error: ParseMcpJsonError };

export type JsonImportStatus = 'importable' | 'unchanged' | 'collected-as' | 'conflict';

export interface JsonImportCandidate {
  snippet: ParsedMcpSnippet;
  status: JsonImportStatus;
  collectedAs?: string;
}

export function parseMcpJsonSnippet(text: string): ParseMcpJsonResult {
  const source = extractJsonText(text);
  if (!source) return { ok: false, error: 'invalid-json' };
  let parsed: unknown;
  try {
    parsed = JSON5.parse(source);
  } catch {
    return { ok: false, error: 'invalid-json' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'no-servers' };
  }
  const doc = parsed as Record<string, unknown>;
  const unnamed = looksLikeServer(doc) && !looksLikeServerMap(doc);
  const map = unnamed ? undefined : pickServerMap(doc);
  const entries: ParsedMcpSnippet[] = [];
  if (unnamed) {
    const extracted = extractComplete(doc);
    if (extracted) entries.push({ name: '', unnamed: true, ...extracted });
  } else if (map) {
    for (const [key, value] of Object.entries(map)) {
      if (!looksLikeServer(value)) continue;
      const extracted = extractComplete(asObject(value));
      if (!extracted) continue;
      entries.push({ name: key.trim(), unnamed: false, ...extracted });
    }
  }
  if (!entries.length) return { ok: false, error: 'no-servers' };
  return { ok: true, entries };
}

export function classifyJsonSnippets(
  collection: CollectedMcp[],
  snippets: ParsedMcpSnippet[]
): JsonImportCandidate[] {
  return snippets.map((snippet) => classifyJsonSnippet(collection, snippet));
}

export function classifyJsonSnippet(
  collection: CollectedMcp[],
  snippet: ParsedMcpSnippet
): JsonImportCandidate {
  const sameEndpoint = findCollectedByEndpoint(collection, snippet.recipe);
  if (sameEndpoint && sameEndpoint.name.toLowerCase() !== snippet.name.toLowerCase()) {
    return { snippet, status: 'collected-as', collectedAs: sameEndpoint.name };
  }
  const existing = findCollectedByName(collection, snippet.name);
  if (!existing) return { snippet, status: 'importable' };
  const match = classifyMcpMatch(existing, { name: snippet.name, recipe: snippet.recipe });
  if (match === 'same-source') return { snippet, status: 'unchanged' };
  if (match === 'collected-as') {
    return { snippet, status: 'collected-as', collectedAs: existing.name };
  }
  return { snippet, status: 'conflict' };
}

function extractJsonText(text: string): string {
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  if (!trimmed) return '';
  const fenced = trimmed.match(/```(?:jsonc?|json5)?\s*\r?\n([\s\S]*?)\r?\n```/i);
  const candidate = (fenced?.[1] ?? trimmed).trim();
  if (!candidate) return '';
  try {
    JSON5.parse(candidate);
    return candidate;
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) return candidate.slice(start, end + 1);
    return candidate;
  }
}

function pickServerMap(doc: Record<string, unknown>): Record<string, unknown> | undefined {
  const servers = asObject(doc.mcpServers);
  if (Object.keys(servers).length) return servers;
  const mcp = asObject(doc.mcp);
  if (Object.keys(mcp).length) return mcp;
  if (looksLikeServerMap(doc)) return doc;
  return undefined;
}

function looksLikeServer(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const value = raw as Record<string, unknown>;
  return (
    typeof value.type === 'string' ||
    typeof value.url === 'string' ||
    typeof value.command === 'string' ||
    Array.isArray(value.command) ||
    (value.headers !== undefined && typeof value.headers === 'object') ||
    (value.env !== undefined && typeof value.env === 'object') ||
    (value.environment !== undefined && typeof value.environment === 'object') ||
    Array.isArray(value.args)
  );
}

function looksLikeServerMap(raw: Record<string, unknown>): boolean {
  const values = Object.values(raw);
  if (!values.length) return false;
  const serverish = values.filter((value) => looksLikeServer(value)).length;
  return serverish > 0 && serverish * 2 >= values.length;
}

function extractComplete(raw: Record<string, unknown>): {
  recipe: McpRecipe;
  secrets: McpSecretValues;
} | undefined {
  const extracted = extractFromServerObject(raw);
  if (!isCompleteRecipe(extracted.recipe)) return undefined;
  return { recipe: extracted.recipe, secrets: extracted.secrets };
}

function isCompleteRecipe(recipe: McpRecipe): boolean {
  if (recipe.transport === 'stdio') return Boolean(recipe.command?.trim());
  return Boolean(recipe.url?.trim());
}

function asObject(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}
