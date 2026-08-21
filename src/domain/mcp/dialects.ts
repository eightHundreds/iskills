import { join } from 'node:path';
import { isAgentPresent } from '../core.js';
import { DomainError } from '../errors.js';
import {
  pathExists,
  readJsonObject,
  readTomlObject,
  removeFileIfExists,
  writeJsonObject,
  writeTomlObject,
} from './io.js';
import {
  extractFromServerObject,
  isLaunchableServerObject,
  projectServerObject,
  projectTomlServer,
} from './recipe.js';
import { emptySecrets } from './secrets.js';
import type {
  McpLocationEntry,
  McpRecipe,
  McpScanContext,
  McpScope,
  McpSecretValues,
} from './types.js';

export const MCP_AGENT_IDS = [
  'agents',
  'codex',
  'claude',
  'cursor',
  'opencode',
  'pi',
  'zcode',
  'trae',
  'qoder',
  'grok',
] as const;

export type McpAgentId = (typeof MCP_AGENT_IDS)[number];

interface RawRow {
  nativeKey: string;
  recipe: McpRecipe;
  secrets: McpSecretValues;
  enabled: boolean;
  filePath: string;
}

export function isMcpAgentId(name: string): name is McpAgentId {
  return (MCP_AGENT_IDS as readonly string[]).includes(name);
}

export function mcpAgentIds(): McpAgentId[] {
  return [...MCP_AGENT_IDS];
}

export function ownedFilePath(
  agent: McpAgentId,
  scope: McpScope,
  ctx: McpScanContext
): string | undefined {
  if (scope === 'global') {
    if (agent === 'claude') return join(ctx.home, '.claude.json');
    if (agent === 'cursor') return join(ctx.home, '.cursor/mcp.json');
    if (agent === 'codex') return join(ctx.home, '.codex/config.toml');
    if (agent === 'grok') return join(ctx.home, '.grok/config.toml');
    if (agent === 'opencode') return join(ctx.home, '.config/opencode/opencode.json');
    if (agent === 'pi') return join(ctx.home, '.pi/agent/mcp.json');
    if (agent === 'trae') return join(ctx.home, '.trae/mcp.json');
    if (agent === 'qoder') return join(ctx.home, '.qoder/settings.json');
    if (agent === 'agents') return join(ctx.home, '.agents/mcp.json');
    if (agent === 'zcode') return join(ctx.home, '.zcode/cli/config.json');
  }
  if (agent === 'claude') return join(ctx.cwd, '.mcp.json');
  if (agent === 'cursor') return join(ctx.cwd, '.cursor/mcp.json');
  if (agent === 'grok') return join(ctx.cwd, '.grok/config.toml');
  if (agent === 'opencode') return join(ctx.cwd, 'opencode.json');
  if (agent === 'pi') return join(ctx.cwd, '.pi/mcp.json');
  if (agent === 'trae') return join(ctx.cwd, '.trae/mcp.json');
  if (agent === 'qoder') return join(ctx.cwd, '.qoder/settings.json');
  if (agent === 'zcode') return join(ctx.cwd, '.zcode/config.json');
  return undefined;
}

export async function agentMcpWritable(
  agent: McpAgentId,
  scope: McpScope,
  ctx: McpScanContext
): Promise<boolean> {
  const path = ownedFilePath(agent, scope, ctx);
  if (!path) return false;
  if (agent === 'zcode' && scope === 'global') {
    if (!(await pathExists(path))) return false;
    const doc = await readJsonObject(path);
    return 'mcpServers' in doc || 'mcp' in doc;
  }
  if (await pathExists(path)) return true;
  if (agent === 'pi') return isPiAdapterPresent(ctx);
  return isMcpAgentPresent(agent, ctx);
}

/** Claude's MCP global file is ~/.claude.json, not under the skills root. */
async function isMcpAgentPresent(agent: McpAgentId, ctx: McpScanContext): Promise<boolean> {
  if (await isAgentPresent(agent, ctx.home)) return true;
  if (agent === 'claude') return pathExists(join(ctx.home, '.claude.json'));
  return false;
}

export async function isPiAdapterPresent(ctx: McpScanContext): Promise<boolean> {
  const mcp = join(ctx.home, '.pi/agent/mcp.json');
  if (await pathExists(mcp)) return true;
  const settings = join(ctx.home, '.pi/agent/settings.json');
  if (!(await pathExists(settings))) return false;
  const doc = await readJsonObject(settings);
  const packages = Array.isArray(doc.packages) ? doc.packages : [];
  return packages.some((entry) => {
    const text = typeof entry === 'string' ? entry : JSON.stringify(entry);
    return text.includes('pi-mcp-adapter');
  });
}

export async function readOwnedRows(
  agent: McpAgentId,
  scope: McpScope,
  ctx: McpScanContext
): Promise<RawRow[]> {
  const path = ownedFilePath(agent, scope, ctx);
  if (!path || !(await pathExists(path))) {
    if (agent === 'claude' && scope === 'project') {
      return readClaudeLocalRows(ctx);
    }
    return [];
  }
  if (agent === 'codex' || agent === 'grok') return readTomlRows(path, agent, ctx, scope);
  if (agent === 'opencode') return readOpencodeRows(path);
  const rows = await readJsonMcpServers(path, jsonRootKey(agent));
  if (agent === 'claude' && scope === 'project') {
    const local = await readClaudeLocalRows(ctx);
    return [...rows, ...local];
  }
  if (agent === 'claude') return applyClaudeDisabled(rows, ctx, scope);
  if (agent === 'pi') return applyPiDisabled(rows, ctx, scope);
  return rows;
}

export async function readBorrowedEntries(
  agent: McpAgentId,
  scope: McpScope,
  ctx: McpScanContext
): Promise<McpLocationEntry[]> {
  const out: McpLocationEntry[] = [];
  if (agent === 'pi') {
    if (scope === 'global') {
      const imports = await readPiImports(ctx);
      if (imports.includes('claude-code')) {
        out.push(...(await asBorrowed('pi', 'global', 'claude', 'global', ctx, 'claude')));
      }
      if (imports.includes('cursor')) {
        out.push(...(await asBorrowed('pi', 'global', 'cursor', 'global', ctx, 'cursor')));
      }
      if (imports.includes('codex')) {
        out.push(...(await asBorrowed('pi', 'global', 'codex', 'global', ctx, 'codex')));
      }
      if (imports.includes('opencode')) {
        out.push(...(await asBorrowed('pi', 'global', 'opencode', 'global', ctx, 'opencode')));
      }
      out.push(...(await sharedJsonBorrowed(join(ctx.home, '.agents/mcp.json'), 'agents', ctx, agent, scope)));
      out.push(
        ...(await sharedJsonBorrowed(
          join(ctx.home, '.config/mcp/mcp.json'),
          '~/.config/mcp/mcp.json',
          ctx,
          agent,
          scope
        ))
      );
    } else {
      out.push(
        ...(await sharedJsonBorrowed(join(ctx.cwd, '.mcp.json'), '<rootDir>/.mcp.json', ctx, agent, scope))
      );
    }
    return applyPiDisabledEntries(out, ctx, scope);
  }
  if (agent === 'grok') {
    const compat = await readGrokCompat(ctx, scope);
    if (scope === 'global') {
      if (compat.claude) {
        out.push(...(await asBorrowed('grok', 'global', 'claude', 'global', ctx, 'claude')));
      }
      if (compat.cursor) {
        out.push(...(await asBorrowed('grok', 'global', 'cursor', 'global', ctx, 'cursor')));
      }
    } else {
      out.push(
        ...(await sharedJsonBorrowed(join(ctx.cwd, '.mcp.json'), '<rootDir>/.mcp.json', ctx, agent, scope))
      );
    }
    return applyGrokDisabledEntries(out, ctx, scope);
  }
  return out;
}

export async function writeOwnedServer(
  agent: McpAgentId,
  scope: McpScope,
  ctx: McpScanContext,
  nativeKey: string,
  recipe: McpRecipe,
  secrets: McpSecretValues
): Promise<void> {
  if (!(await agentMcpWritable(agent, scope, ctx))) {
    throw new DomainError('mcp.notWritable', { name: agent });
  }
  const path = ownedFilePath(agent, scope, ctx);
  if (!path) throw new DomainError('mcp.notWritable', { name: agent });
  if (agent === 'codex' || agent === 'grok') {
    await upsertTomlServer(path, nativeKey, recipe, secrets);
    return;
  }
  if (agent === 'opencode') {
    await upsertOpencodeServer(path, nativeKey, recipe, secrets);
    return;
  }
  await upsertJsonServer(path, jsonRootKey(agent), nativeKey, recipe, secrets, 'json');
}

export async function removeOwnedServer(
  agent: McpAgentId,
  scope: McpScope,
  ctx: McpScanContext,
  nativeKey: string
): Promise<void> {
  if (!(await agentMcpWritable(agent, scope, ctx))) {
    throw new DomainError('mcp.borrowedNotMutable', { name: nativeKey });
  }
  const path = ownedFilePath(agent, scope, ctx);
  if (!path || !(await pathExists(path))) return;
  if (agent === 'codex' || agent === 'grok') {
    await deleteTomlServer(path, nativeKey);
    return;
  }
  if (agent === 'opencode') {
    await deleteOpencodeServer(path, nativeKey);
    return;
  }
  await deleteJsonServer(path, jsonRootKey(agent), nativeKey);
}

export async function setLocationEnabled(entry: McpLocationEntry, ctx: McpScanContext, enabled: boolean): Promise<void> {
  if (entry.agent === 'pi') {
    if (!(await agentMcpWritable('pi', entry.scope, ctx))) {
      throw new DomainError('mcp.notWritable', { name: 'pi' });
    }
    await setPiEnabled(ctx, entry.scope, entry.nativeKey, enabled);
    return;
  }
  if (entry.agent === 'grok') {
    if (!(await agentMcpWritable('grok', entry.scope, ctx))) {
      throw new DomainError('mcp.notWritable', { name: 'grok' });
    }
    await setGrokEnabled(ctx, entry.scope, entry.nativeKey, enabled);
    return;
  }
  if (entry.ownership === 'borrowed') {
    throw new DomainError('mcp.borrowedNotMutable', { name: entry.nativeKey });
  }
  if (entry.agent === 'claude') {
    await setClaudeEnabled(ctx, entry.scope, entry.nativeKey, enabled);
    return;
  }
  if (entry.agent === 'opencode') {
    const path = ownedFilePath('opencode', entry.scope, ctx);
    if (!path) return;
    const doc = await readJsonObject(path);
    const mcp = asObject(doc.mcp);
    const current = asObject(mcp[entry.nativeKey]);
    current.enabled = enabled;
    mcp[entry.nativeKey] = current;
    doc.mcp = mcp;
    await writeJsonObject(path, doc);
    return;
  }
  if (entry.agent === 'codex') {
    const path = ownedFilePath('codex', entry.scope, ctx);
    if (!path) return;
    const doc = await readTomlObject(path);
    const servers = asObject(doc.mcp_servers);
    const current = asObject(servers[entry.nativeKey]);
    current.enabled = enabled;
    servers[entry.nativeKey] = current;
    doc.mcp_servers = servers;
    await writeTomlObject(path, doc);
    return;
  }
  const agent = entry.agent as McpAgentId;
  const path = ownedFilePath(agent, entry.scope, ctx);
  if (!path || !(await pathExists(path))) return;
  const rootKey = jsonRootKey(agent);
  const doc = await readJsonObject(path);
  const servers = asObject(doc[rootKey]);
  const current = asObject(servers[entry.nativeKey]);
  if (enabled) delete current.disabled;
  else current.disabled = true;
  servers[entry.nativeKey] = current;
  doc[rootKey] = servers;
  await writeJsonObject(path, doc);
}

export function toLocationEntries(
  agent: string,
  scope: McpScope,
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

function jsonRootKey(agent: McpAgentId): string {
  return 'mcpServers';
}

function asObject(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}

function jsonDocIsEmptyMcpShell(doc: Record<string, unknown>, rootKey: string): boolean {
  const keys = Object.keys(doc);
  if (keys.length === 0) return true;
  if (keys.length !== 1 || keys[0] !== rootKey) return false;
  return Object.keys(asObject(doc[rootKey])).length === 0;
}

async function readJsonMcpServers(path: string, rootKey: string): Promise<RawRow[]> {
  const doc = await readJsonObject(path);
  const servers = asObject(doc[rootKey]);
  return Object.entries(servers).flatMap(([nativeKey, value]) => {
    const raw = asObject(value);
    if (!isLaunchableServerObject(raw)) return [];
    const extracted = extractFromServerObject(raw);
    return [{ nativeKey, filePath: path, ...extracted }];
  });
}

async function upsertJsonServer(
  path: string,
  rootKey: string,
  nativeKey: string,
  recipe: McpRecipe,
  secrets: McpSecretValues,
  style: 'json'
): Promise<void> {
  const doc = (await pathExists(path)) ? await readJsonObject(path) : {};
  const servers = asObject(doc[rootKey]);
  const previous = asObject(servers[nativeKey]);
  const next = projectServerObject(recipe, secrets, style);
  if (previous.disabled === true) next.disabled = true;
  servers[nativeKey] = next;
  doc[rootKey] = servers;
  await writeJsonObject(path, doc);
}

async function deleteJsonServer(path: string, rootKey: string, nativeKey: string): Promise<void> {
  const doc = await readJsonObject(path);
  const servers = asObject(doc[rootKey]);
  delete servers[nativeKey];
  doc[rootKey] = servers;
  await writeJsonObject(path, doc);
}

async function readOpencodeRows(path: string): Promise<RawRow[]> {
  const doc = await readJsonObject(path);
  const mcp = asObject(doc.mcp);
  return Object.entries(mcp).map(([nativeKey, value]) => {
    const extracted = extractFromServerObject(asObject(value));
    return { nativeKey, filePath: path, ...extracted };
  });
}

async function upsertOpencodeServer(
  path: string,
  nativeKey: string,
  recipe: McpRecipe,
  secrets: McpSecretValues
): Promise<void> {
  const doc = (await pathExists(path)) ? await readJsonObject(path) : {};
  const mcp = asObject(doc.mcp);
  const previous = asObject(mcp[nativeKey]);
  const next = projectServerObject(recipe, secrets, 'opencode');
  if (previous.enabled === false) next.enabled = false;
  mcp[nativeKey] = next;
  doc.mcp = mcp;
  await writeJsonObject(path, doc);
}

async function deleteOpencodeServer(path: string, nativeKey: string): Promise<void> {
  const doc = await readJsonObject(path);
  const mcp = asObject(doc.mcp);
  delete mcp[nativeKey];
  doc.mcp = mcp;
  await writeJsonObject(path, doc);
}

async function readTomlRows(
  path: string,
  agent: McpAgentId,
  ctx: McpScanContext,
  scope: McpScope
): Promise<RawRow[]> {
  const doc = await readTomlObject(path);
  const servers = asObject(doc.mcp_servers);
  const disabled = new Set(stringList(doc.disabled_mcp_servers));
  return Object.entries(servers).map(([nativeKey, value]) => {
    const extracted = extractFromServerObject(asObject(value));
    if (agent === 'grok' && disabled.has(nativeKey)) extracted.enabled = false;
    return { nativeKey, filePath: path, ...extracted };
  });
}

async function upsertTomlServer(
  path: string,
  nativeKey: string,
  recipe: McpRecipe,
  secrets: McpSecretValues
): Promise<void> {
  const doc = (await pathExists(path)) ? await readTomlObject(path) : {};
  const servers = asObject(doc.mcp_servers);
  const previous = asObject(servers[nativeKey]);
  const next = projectTomlServer(recipe, secrets);
  if (previous.enabled === false) next.enabled = false;
  servers[nativeKey] = next;
  doc.mcp_servers = servers;
  await writeTomlObject(path, doc);
}

async function deleteTomlServer(path: string, nativeKey: string): Promise<void> {
  const doc = await readTomlObject(path);
  const servers = asObject(doc.mcp_servers);
  delete servers[nativeKey];
  doc.mcp_servers = servers;
  const disabled = stringList(doc.disabled_mcp_servers).filter((name) => name !== nativeKey);
  if (disabled.length) doc.disabled_mcp_servers = disabled;
  else delete doc.disabled_mcp_servers;
  await writeTomlObject(path, doc);
}

async function readClaudeLocalRows(ctx: McpScanContext): Promise<RawRow[]> {
  const path = join(ctx.home, '.claude.json');
  if (!(await pathExists(path))) return [];
  const doc = await readJsonObject(path);
  const projects = asObject(doc.projects);
  const project = asObject(projects[ctx.cwd]);
  const servers = asObject(project.mcpServers);
  const disabled = new Set(stringList(project.disabledMcpServers));
  return Object.entries(servers).map(([nativeKey, value]) => {
    const extracted = extractFromServerObject(asObject(value));
    if (disabled.has(nativeKey)) extracted.enabled = false;
    return { nativeKey, filePath: path, ...extracted };
  });
}

async function applyClaudeDisabled(
  rows: RawRow[],
  ctx: McpScanContext,
  scope: McpScope
): Promise<RawRow[]> {
  const path = join(ctx.home, '.claude.json');
  if (!(await pathExists(path))) return rows;
  const doc = await readJsonObject(path);
  const projects = asObject(doc.projects);
  const project = asObject(projects[ctx.cwd]);
  const disabled = new Set([
    ...stringList(project.disabledMcpServers),
    ...(scope === 'project' ? stringList(project.disabledMcpjsonServers) : []),
  ]);
  return rows.map((row) =>
    disabled.has(row.nativeKey) ? { ...row, enabled: false } : row
  );
}

async function setClaudeEnabled(
  ctx: McpScanContext,
  scope: McpScope,
  nativeKey: string,
  enabled: boolean
): Promise<void> {
  const path = join(ctx.home, '.claude.json');
  const doc = (await pathExists(path)) ? await readJsonObject(path) : {};
  if (scope === 'global') {
    const servers = asObject(doc.mcpServers);
    const current = asObject(servers[nativeKey]);
    if (enabled) delete current.disabled;
    else current.disabled = true;
    servers[nativeKey] = current;
    doc.mcpServers = servers;
    await writeJsonObject(path, doc);
    return;
  }
  const projects = asObject(doc.projects);
  const project = asObject(projects[ctx.cwd]);
  const key = 'disabledMcpjsonServers';
  const list = new Set(stringList(project[key]));
  if (enabled) list.delete(nativeKey);
  else list.add(nativeKey);
  project[key] = [...list];
  projects[ctx.cwd] = project;
  doc.projects = projects;
  await writeJsonObject(path, doc);
}

async function readPiImports(ctx: McpScanContext): Promise<string[]> {
  const path = join(ctx.home, '.pi/agent/mcp.json');
  if (!(await pathExists(path))) return [];
  const doc = await readJsonObject(path);
  return Array.isArray(doc.imports) ? doc.imports.map(String) : [];
}

async function applyPiDisabled(
  rows: RawRow[],
  ctx: McpScanContext,
  scope: McpScope
): Promise<RawRow[]> {
  const overlay = await readPiOverlay(ctx, scope);
  return rows.map((row) => {
    const extra = asObject(overlay[row.nativeKey]);
    if (extra.disabled === true) return { ...row, enabled: false };
    return row;
  });
}

async function applyPiDisabledEntries(
  entries: McpLocationEntry[],
  ctx: McpScanContext,
  scope: McpScope
): Promise<McpLocationEntry[]> {
  const overlay = await readPiOverlay(ctx, scope);
  return entries.map((entry) => {
    const extra = asObject(overlay[entry.nativeKey]);
    return extra.disabled === true ? { ...entry, enabled: false } : entry;
  });
}

async function readPiOverlay(
  ctx: McpScanContext,
  scope: McpScope
): Promise<Record<string, unknown>> {
  const path = ownedFilePath('pi', scope, ctx);
  if (!path || !(await pathExists(path))) return {};
  const doc = await readJsonObject(path);
  return asObject(doc.mcpServers);
}

async function setPiEnabled(
  ctx: McpScanContext,
  scope: McpScope,
  nativeKey: string,
  enabled: boolean
): Promise<void> {
  const path = ownedFilePath('pi', scope === 'project' ? 'project' : 'global', ctx);
  if (!path) return;
  const doc = (await pathExists(path)) ? await readJsonObject(path) : {};
  const servers = asObject(doc.mcpServers);
  const current = asObject(servers[nativeKey]);
  if (enabled) {
    delete current.disabled;
    if (isLaunchableServerObject(current)) servers[nativeKey] = current;
    else delete servers[nativeKey];
  } else {
    current.disabled = true;
    servers[nativeKey] = current;
  }
  doc.mcpServers = servers;
  // Global ~/.pi/agent/mcp.json is also the adapter config; do not delete an empty shell.
  if (scope === 'project' && jsonDocIsEmptyMcpShell(doc, 'mcpServers')) {
    await removeFileIfExists(path);
    return;
  }
  await writeJsonObject(path, doc);
}

async function readGrokCompat(
  ctx: McpScanContext,
  scope: McpScope
): Promise<{ claude: boolean; cursor: boolean }> {
  const path = ownedFilePath('grok', scope === 'project' ? 'project' : 'global', ctx);
  if (!path || !(await pathExists(path))) return { claude: true, cursor: true };
  const doc = await readTomlObject(path);
  const compat = asObject(doc.compat);
  const claude = asObject(compat.claude);
  const cursor = asObject(compat.cursor);
  return {
    claude: claude.mcps !== false,
    cursor: cursor.mcps !== false,
  };
}

async function applyGrokDisabledEntries(
  entries: McpLocationEntry[],
  ctx: McpScanContext,
  scope: McpScope
): Promise<McpLocationEntry[]> {
  const path = ownedFilePath('grok', scope, ctx);
  if (!path || !(await pathExists(path))) return entries;
  const doc = await readTomlObject(path);
  const disabled = new Set(stringList(doc.disabled_mcp_servers));
  return entries.map((entry) =>
    disabled.has(entry.nativeKey) ? { ...entry, enabled: false } : entry
  );
}

async function setGrokEnabled(
  ctx: McpScanContext,
  scope: McpScope,
  nativeKey: string,
  enabled: boolean
): Promise<void> {
  const path = ownedFilePath('grok', scope, ctx);
  if (!path) return;
  const doc = (await pathExists(path)) ? await readTomlObject(path) : {};
  const list = new Set(stringList(doc.disabled_mcp_servers));
  if (enabled) list.delete(nativeKey);
  else list.add(nativeKey);
  if (list.size) doc.disabled_mcp_servers = [...list];
  else delete doc.disabled_mcp_servers;
  if (Object.keys(doc).length === 0) {
    await removeFileIfExists(path);
    return;
  }
  await writeTomlObject(path, doc);
}

async function asBorrowed(
  viewer: string,
  viewerScope: McpScope,
  sourceAgent: McpAgentId,
  sourceScope: McpScope,
  ctx: McpScanContext,
  borrowedFrom: string
): Promise<McpLocationEntry[]> {
  const rows = await readOwnedRows(sourceAgent, sourceScope, ctx);
  const path = ownedFilePath(sourceAgent, sourceScope, ctx) ?? rows[0]?.filePath ?? '';
  return rows.map((row) => ({
    agent: viewer,
    scope: viewerScope,
    ownership: 'borrowed' as const,
    borrowedFrom,
    nativeKey: row.nativeKey,
    enabled: row.enabled,
    writable: false,
    recipe: row.recipe,
    secrets: row.secrets,
    filePath: path || row.filePath,
  }));
}

async function sharedJsonBorrowed(
  path: string,
  borrowedFrom: string,
  ctx: McpScanContext,
  viewer: string,
  scope: McpScope
): Promise<McpLocationEntry[]> {
  if (!(await pathExists(path))) return [];
  const rows = await readJsonMcpServers(path, 'mcpServers');
  return rows.map((row) => ({
    agent: viewer,
    scope,
    ownership: 'borrowed' as const,
    borrowedFrom,
    nativeKey: row.nativeKey,
    enabled: row.enabled,
    writable: false,
    recipe: row.recipe,
    secrets: row.secrets,
    filePath: path,
  }));
}

function stringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(String);
}

export { emptySecrets };
