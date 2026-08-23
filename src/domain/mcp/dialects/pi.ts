import { join } from 'node:path';
import { exists } from '../../core.js';
import { DomainError } from '../../errors.js';
import { readJsonObject, writeJsonObject, removeFileIfExists } from '../io.js';
import { asBorrowed, projectSharedMcpJson, sharedJsonBorrowed } from './borrow.js';
import {
  asObject,
  jsonDocIsEmptyMcpShell,
  readJsonMcpServers,
  upsertJsonServer,
  deleteJsonServer,
  type RawRow,
} from './shared.js';
import type { McpDialect } from './registry.js';
import { isLaunchableServerObject } from '../recipe.js';
import type { McpLocationEntry, McpScanContext, McpScope } from '../types.js';

export async function isPiAdapterPresent(ctx: McpScanContext): Promise<boolean> {
  const mcp = join(ctx.home, '.pi/agent/mcp.json');
  if (await exists(mcp)) return true;
  const settings = join(ctx.home, '.pi/agent/settings.json');
  if (!(await exists(settings))) return false;
  const doc = await readJsonObject(settings);
  const packages = Array.isArray(doc.packages) ? doc.packages : [];
  return packages.some((entry) => {
    const text = typeof entry === 'string' ? entry : JSON.stringify(entry);
    return text.includes('pi-mcp-adapter');
  });
}

async function readPiImports(ctx: McpScanContext): Promise<string[]> {
  const path = join(ctx.home, '.pi/agent/mcp.json');
  if (!(await exists(path))) return [];
  const doc = await readJsonObject(path);
  return Array.isArray(doc.imports) ? doc.imports.map(String) : [];
}

async function readPiOverlay(
  ctx: McpScanContext,
  scope: McpScope
): Promise<Record<string, unknown>> {
  const path = piDialect.ownedPath(scope, ctx);
  if (!path || !(await exists(path))) return {};
  const doc = await readJsonObject(path);
  return asObject(doc.mcpServers);
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

export const piDialect: McpDialect = {
  id: 'pi',
  ownedPath(scope: McpScope, ctx: McpScanContext): string | undefined {
    return scope === 'global' ? join(ctx.home, '.pi/agent/mcp.json') : join(ctx.cwd, '.pi/mcp.json');
  },
  async writable(scope: McpScope, ctx: McpScanContext): Promise<boolean> {
    const path = this.ownedPath(scope, ctx);
    if (!path) return false;
    if (await exists(path)) return true;
    return isPiAdapterPresent(ctx);
  },
  async readOwned(scope: McpScope, ctx: McpScanContext): Promise<RawRow[]> {
    const path = this.ownedPath(scope, ctx);
    if (!path || !(await exists(path))) return [];
    const rows = await readJsonMcpServers(path, 'mcpServers');
    return applyPiDisabled(rows, ctx, scope);
  },
  async writeOwned(scope, ctx, nativeKey, recipe, secrets): Promise<void> {
    const path = this.ownedPath(scope, ctx);
    if (!path) throw new DomainError('mcp.notWritable', { name: 'pi' });
    await upsertJsonServer(path, 'mcpServers', nativeKey, recipe, secrets, 'json');
  },
  async removeOwned(scope, ctx, nativeKey): Promise<void> {
    const path = this.ownedPath(scope, ctx);
    if (!path || !(await exists(path))) return;
    await deleteJsonServer(path, 'mcpServers', nativeKey);
  },
  async setEnabled(entry: McpLocationEntry, ctx: McpScanContext, enabled: boolean): Promise<void> {
    if (!(await this.writable(entry.scope, ctx))) {
      throw new DomainError('mcp.notWritable', { name: 'pi' });
    }
    const path = this.ownedPath(entry.scope, ctx);
    if (!path) return;
    const doc = (await exists(path)) ? await readJsonObject(path) : {};
    const servers = asObject(doc.mcpServers);
    const current = asObject(servers[entry.nativeKey]);
    if (enabled) {
      delete current.disabled;
      if (isLaunchableServerObject(current)) servers[entry.nativeKey] = current;
      else delete servers[entry.nativeKey];
    } else {
      current.disabled = true;
      servers[entry.nativeKey] = current;
    }
    doc.mcpServers = servers;
    if (entry.scope === 'project' && jsonDocIsEmptyMcpShell(doc, 'mcpServers')) {
      await removeFileIfExists(path);
      return;
    }
    await writeJsonObject(path, doc);
  },
  async readBorrowed(scope: McpScope, ctx: McpScanContext): Promise<McpLocationEntry[]> {
    const out: McpLocationEntry[] = [];
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
      out.push(...(await sharedJsonBorrowed(join(ctx.home, '.agents/mcp.json'), 'agents', ctx, 'pi', scope)));
      out.push(
        ...(await sharedJsonBorrowed(
          join(ctx.home, '.config/mcp/mcp.json'),
          '~/.config/mcp/mcp.json',
          ctx,
          'pi',
          scope
        ))
      );
    } else {
      out.push(
        ...(await sharedJsonBorrowed(projectSharedMcpJson(ctx), '<rootDir>/.mcp.json', ctx, 'pi', scope))
      );
    }
    return applyPiDisabledEntries(out, ctx, scope);
  },
};
