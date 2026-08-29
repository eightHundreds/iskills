import { exists } from '../../core.js';
import {
  readJsonObject,
  readTomlObject,
  writeJsonObject,
  writeTomlObject,
} from '../io.js';
import {
  extractFromServerObject,
  isLaunchableServerObject,
} from '../recipe.js';
import type {
  McpLocationEntry,
  McpRecipe,
  McpSecretValues,
} from '../types.js';

export interface RawRow {
  nativeKey: string;
  recipe: McpRecipe;
  secrets: McpSecretValues;
  enabled: boolean;
  filePath: string;
}

export function asObject(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}

export function stringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(String);
}

export function jsonDocIsEmptyMcpShell(doc: Record<string, unknown>, rootKey: string): boolean {
  const keys = Object.keys(doc);
  if (keys.length === 0) return true;
  if (keys.length !== 1 || keys[0] !== rootKey) return false;
  return Object.keys(asObject(doc[rootKey])).length === 0;
}

export function rowsFromJsonServers(
  servers: Record<string, unknown>,
  filePath: string
): RawRow[] {
  return Object.entries(servers).flatMap(([nativeKey, value]) => {
    const raw = asObject(value);
    if (!isLaunchableServerObject(raw)) return [];
    const extracted = extractFromServerObject(raw);
    return [{ nativeKey, filePath, ...extracted }];
  });
}

export async function readJsonMcpServers(path: string, rootKey: string): Promise<RawRow[]> {
  const doc = await readJsonObject(path);
  return rowsFromJsonServers(asObject(doc[rootKey]), path);
}

export async function upsertJsonServer(
  path: string,
  rootKey: string,
  nativeKey: string,
  next: Record<string, unknown>
): Promise<void> {
  const doc = (await exists(path)) ? await readJsonObject(path) : {};
  const servers = asObject(doc[rootKey]);
  servers[nativeKey] = next;
  doc[rootKey] = servers;
  await writeJsonObject(path, doc);
}

export async function deleteJsonServer(path: string, rootKey: string, nativeKey: string): Promise<void> {
  const doc = await readJsonObject(path);
  const servers = asObject(doc[rootKey]);
  delete servers[nativeKey];
  doc[rootKey] = servers;
  await writeJsonObject(path, doc);
}

export async function upsertTomlServer(
  path: string,
  nativeKey: string,
  next: Record<string, unknown>
): Promise<void> {
  const doc = (await exists(path)) ? await readTomlObject(path) : {};
  const servers = asObject(doc.mcp_servers);
  servers[nativeKey] = next;
  doc.mcp_servers = servers;
  await writeTomlObject(path, doc);
}

export async function deleteTomlServer(path: string, nativeKey: string): Promise<void> {
  const doc = await readTomlObject(path);
  const servers = asObject(doc.mcp_servers);
  delete servers[nativeKey];
  doc.mcp_servers = servers;
  const disabled = stringList(doc.disabled_mcp_servers).filter((name) => name !== nativeKey);
  if (disabled.length) doc.disabled_mcp_servers = disabled;
  else delete doc.disabled_mcp_servers;
  await writeTomlObject(path, doc);
}

export function toLocationEntries(
  agent: string,
  scope: McpLocationEntry['scope'],
  rows: RawRow[],
  ownership: 'owned' | 'borrowed',
  writable: boolean,
  borrowedFrom?: string
): McpLocationEntry[] {
  return rows.map((row) => ({
    agent,
    scope,
    ownership,
    ...(borrowedFrom ? { borrowedFrom } : {}),
    nativeKey: row.nativeKey,
    enabled: row.enabled,
    writable: ownership === 'owned' && writable,
    recipe: row.recipe,
    secrets: row.secrets,
    filePath: row.filePath,
  }));
}
