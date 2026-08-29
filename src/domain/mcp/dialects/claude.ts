import { join } from 'node:path';
import { exists, isAgentPresent } from '../../core.js';
import { readJsonObject, writeJsonObject } from '../io.js';
import {
  asObject,
  readJsonMcpServers,
  rowsFromJsonServers,
  stringList,
  upsertJsonServer,
  deleteJsonServer,
  type RawRow,
} from './shared.js';
import type { McpDialect } from './registry.js';
import { DomainError } from '../../errors.js';
import { projectServerObject } from '../recipe.js';
import type { McpLocationEntry, McpScanContext, McpScope } from '../types.js';

type ClaudeDisableKind = 'mcpjson' | 'user';

function claudeListKey(kind: ClaudeDisableKind): 'disabledMcpjsonServers' | 'disabledMcpServers' {
  return kind === 'mcpjson' ? 'disabledMcpjsonServers' : 'disabledMcpServers';
}

function claudeDisableKind(filePath: string, ctx: McpScanContext): ClaudeDisableKind {
  return filePath === join(ctx.cwd, '.mcp.json') ? 'mcpjson' : 'user';
}

async function readClaudeDoc(ctx: McpScanContext): Promise<Record<string, unknown>> {
  const path = join(ctx.home, '.claude.json');
  if (!(await exists(path))) return {};
  return readJsonObject(path);
}

function claudeProject(doc: Record<string, unknown>, cwd: string): Record<string, unknown> {
  return asObject(asObject(doc.projects)[cwd]);
}

function applyClaudeDisabled(
  rows: RawRow[],
  project: Record<string, unknown>,
  kind: ClaudeDisableKind
): RawRow[] {
  const disabled = new Set(stringList(project[claudeListKey(kind)]));
  if (!disabled.size) return rows;
  return rows.map((row) =>
    disabled.has(row.nativeKey) ? { ...row, enabled: false } : row
  );
}

async function readClaudeUserRows(ctx: McpScanContext): Promise<RawRow[]> {
  const path = join(ctx.home, '.claude.json');
  const doc = await readClaudeDoc(ctx);
  const rows = rowsFromJsonServers(asObject(doc.mcpServers), path);
  return applyClaudeDisabled(rows, claudeProject(doc, ctx.cwd), 'user');
}

async function readClaudeProjectRows(ctx: McpScanContext): Promise<RawRow[]> {
  const mcpPath = join(ctx.cwd, '.mcp.json');
  const doc = await readClaudeDoc(ctx);
  const project = claudeProject(doc, ctx.cwd);
  const jsonRows = (await exists(mcpPath))
    ? applyClaudeDisabled(await readJsonMcpServers(mcpPath, 'mcpServers'), project, 'mcpjson')
    : [];
  const local = rowsFromJsonServers(asObject(project.mcpServers), join(ctx.home, '.claude.json'));
  return [...jsonRows, ...applyClaudeDisabled(local, project, 'user')];
}

function setClaudeDisableList(
  project: Record<string, unknown>,
  kind: ClaudeDisableKind,
  nativeKey: string,
  enabled: boolean
): void {
  const listKey = claudeListKey(kind);
  const list = new Set(stringList(project[listKey]));
  if (enabled) list.delete(nativeKey);
  else list.add(nativeKey);
  if (list.size) project[listKey] = [...list];
  else delete project[listKey];
}

function stripClaudeDisabledFlag(
  bag: Record<string, unknown>,
  rootKey: string,
  nativeKey: string
): void {
  const raw = bag[rootKey];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
  const current = asObject(asObject(raw)[nativeKey]);
  if (!('disabled' in current)) return;
  delete current.disabled;
}

async function setClaudeEnabled(
  ctx: McpScanContext,
  kind: ClaudeDisableKind,
  nativeKey: string,
  enabled: boolean
): Promise<void> {
  const path = join(ctx.home, '.claude.json');
  const doc = (await exists(path)) ? await readJsonObject(path) : {};
  const projects = asObject(doc.projects);
  const project = asObject(projects[ctx.cwd]);
  setClaudeDisableList(project, kind, nativeKey, enabled);
  stripClaudeDisabledFlag(doc, 'mcpServers', nativeKey);
  stripClaudeDisabledFlag(project, 'mcpServers', nativeKey);
  projects[ctx.cwd] = project;
  doc.projects = projects;
  await writeJsonObject(path, doc);
}

export const claudeDialect: McpDialect = {
  id: 'claude',
  ownedPath(scope: McpScope, ctx: McpScanContext): string | undefined {
    return scope === 'global' ? join(ctx.home, '.claude.json') : join(ctx.cwd, '.mcp.json');
  },
  async writable(scope: McpScope, ctx: McpScanContext): Promise<boolean> {
    const path = this.ownedPath(scope, ctx);
    if (!path) return false;
    if (await exists(path)) return true;
    if (await isAgentPresent('claude', ctx.home)) return true;
    return exists(join(ctx.home, '.claude.json'));
  },
  readOwned(scope: McpScope, ctx: McpScanContext): Promise<RawRow[]> {
    return scope === 'project' ? readClaudeProjectRows(ctx) : readClaudeUserRows(ctx);
  },
  async writeOwned(scope, ctx, nativeKey, recipe, secrets): Promise<void> {
    const path = this.ownedPath(scope, ctx);
    if (!path) throw new DomainError('mcp.notWritable', { name: 'claude' });
    const next = projectServerObject(recipe, secrets, 'json');
    delete next.disabled;
    await upsertJsonServer(path, 'mcpServers', nativeKey, next);
  },
  async removeOwned(scope, ctx, nativeKey): Promise<void> {
    const path = this.ownedPath(scope, ctx);
    if (!path || !(await exists(path))) return;
    await deleteJsonServer(path, 'mcpServers', nativeKey);
  },
  async setEnabled(entry: McpLocationEntry, ctx: McpScanContext, enabled: boolean): Promise<void> {
    if (entry.ownership === 'borrowed') {
      throw new DomainError('mcp.borrowedNotMutable', { name: entry.nativeKey });
    }
    await setClaudeEnabled(ctx, claudeDisableKind(entry.filePath, ctx), entry.nativeKey, enabled);
  },
  async readBorrowed(): Promise<McpLocationEntry[]> {
    return [];
  },
};
