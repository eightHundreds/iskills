import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { collectionPaths, commitCollection, ensureCollection, exists } from '../core.js';
import { DomainError } from '../errors.js';
import { assertMcpName } from './identity.js';
import { readJsonObject, writeJsonObject } from './io.js';
import type { CollectedMcp, CreateMcpInput, McpRecipe, McpSource } from './types.js';

export function mcpCollectionDir(): string {
  return join(collectionPaths().root, 'mcps');
}

export function mcpCollectionPath(name: string): string {
  return join(mcpCollectionDir(), `${assertMcpName(name)}.json`);
}

export async function ensureMcpCollection(): Promise<void> {
  await ensureCollection();
  await mkdir(mcpCollectionDir(), { recursive: true });
}

function normalizeRecipe(raw: unknown): McpRecipe {
  const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const transport =
    record.transport === 'http' || record.transport === 'sse' || record.transport === 'stdio'
      ? record.transport
      : 'stdio';
  return {
    transport,
    ...(typeof record.command === 'string' ? { command: record.command } : {}),
    ...(Array.isArray(record.args) ? { args: record.args.map(String) } : {}),
    ...(typeof record.cwd === 'string' ? { cwd: record.cwd } : {}),
    ...(typeof record.url === 'string' ? { url: record.url } : {}),
    envKeys: Array.isArray(record.envKeys) ? record.envKeys.map(String) : [],
    headerKeys: Array.isArray(record.headerKeys) ? record.headerKeys.map(String) : [],
  };
}

function normalizeSource(raw: unknown): McpSource {
  if (!raw || typeof raw !== 'object') return { type: 'unknown' };
  const record = raw as Record<string, unknown>;
  return {
    type: typeof record.type === 'string' ? record.type : 'unknown',
    ...(typeof record.agent === 'string' ? { agent: record.agent } : {}),
    ...(record.scope === 'project' || record.scope === 'global' ? { scope: record.scope } : {}),
    ...(typeof record.nativeKey === 'string' ? { nativeKey: record.nativeKey } : {}),
    ...(typeof record.path === 'string' ? { path: record.path } : {}),
  };
}

export function collectedFromRecord(raw: Record<string, unknown>, fallbackName: string): CollectedMcp {
  const name = assertMcpName(typeof raw.name === 'string' ? raw.name : fallbackName);
  return {
    name,
    description: typeof raw.description === 'string' ? raw.description : '',
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    note: typeof raw.note === 'string' ? raw.note : '',
    source: normalizeSource(raw.source),
    recipe: normalizeRecipe(raw.recipe),
  };
}

export async function listCollectedMcps(): Promise<CollectedMcp[]> {
  await ensureMcpCollection();
  const dir = mcpCollectionDir();
  if (!(await exists(dir))) return [];
  const entries = await readdir(dir);
  const collected: CollectedMcp[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const raw = await readJsonObject(join(dir, entry));
    collected.push(collectedFromRecord(raw, entry.replace(/\.json$/i, '')));
  }
  return collected.sort((a, b) => a.name.localeCompare(b.name));
}

export async function readCollectedMcp(name: string): Promise<CollectedMcp | undefined> {
  const path = mcpCollectionPath(name);
  if (!(await exists(path))) return undefined;
  return collectedFromRecord(await readJsonObject(path), name);
}

export async function writeCollectedMcp(mcp: CollectedMcp, commitMessage?: string): Promise<boolean> {
  await ensureMcpCollection();
  const name = assertMcpName(mcp.name);
  await writeJsonObject(mcpCollectionPath(name), {
    name,
    description: mcp.description,
    tags: mcp.tags,
    note: mcp.note,
    source: mcp.source,
    recipe: mcp.recipe,
  });
  return commitCollection(commitMessage ?? `mcp: save ${name}`);
}

export async function deleteCollectedMcpFile(name: string): Promise<void> {
  await rm(mcpCollectionPath(name), { force: true });
}

export async function createCollectedRecord(input: CreateMcpInput): Promise<CollectedMcp> {
  const name = assertMcpName(input.name);
  if (await readCollectedMcp(name)) {
    throw new DomainError('mcp.sameNameExistsReplace', { name });
  }
  const collected: CollectedMcp = {
    name,
    description: input.description ?? '',
    tags: input.tags ?? [],
    note: input.note ?? '',
    source: { type: 'create' },
    recipe: input.recipe,
  };
  return collected;
}
