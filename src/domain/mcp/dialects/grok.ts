import { join } from 'node:path';
import { exists, isAgentPresent } from '../../core.js';
import { DomainError } from '../../errors.js';
import { readTomlObject, writeTomlObject, removeFileIfExists } from '../io.js';
import { asBorrowed, projectSharedMcpJson, sharedJsonBorrowed } from './borrow.js';
import {
  asObject,
  stringList,
  upsertTomlServer,
  deleteTomlServer,
  type RawRow,
} from './shared.js';
import type { McpDialect } from './registry.js';
import { extractFromServerObject } from '../recipe.js';
import type { McpLocationEntry, McpScanContext, McpScope } from '../types.js';

async function readGrokCompat(
  ctx: McpScanContext,
  scope: McpScope
): Promise<{ claude: boolean; cursor: boolean }> {
  const path = grokDialect.ownedPath(scope, ctx);
  if (!path || !(await exists(path))) return { claude: true, cursor: true };
  const doc = await readTomlObject(path);
  const compat = asObject(doc.compat);
  const claude = asObject(compat.claude);
  const cursor = asObject(compat.cursor);
  return {
    claude: claude.mcps !== false,
    cursor: cursor.mcps !== false,
  };
}

async function readGrokRows(path: string): Promise<RawRow[]> {
  const doc = await readTomlObject(path);
  const servers = asObject(doc.mcp_servers);
  const disabled = new Set(stringList(doc.disabled_mcp_servers));
  return Object.entries(servers).map(([nativeKey, value]) => {
    const extracted = extractFromServerObject(asObject(value));
    if (disabled.has(nativeKey)) extracted.enabled = false;
    return { nativeKey, filePath: path, ...extracted };
  });
}

async function applyGrokDisabledEntries(
  entries: McpLocationEntry[],
  ctx: McpScanContext,
  scope: McpScope
): Promise<McpLocationEntry[]> {
  const path = grokDialect.ownedPath(scope, ctx);
  if (!path || !(await exists(path))) return entries;
  const doc = await readTomlObject(path);
  const disabled = new Set(stringList(doc.disabled_mcp_servers));
  return entries.map((entry) =>
    disabled.has(entry.nativeKey) ? { ...entry, enabled: false } : entry
  );
}

export const grokDialect: McpDialect = {
  id: 'grok',
  ownedPath(scope: McpScope, ctx: McpScanContext): string | undefined {
    return scope === 'global' ? join(ctx.home, '.grok/config.toml') : join(ctx.cwd, '.grok/config.toml');
  },
  async writable(scope: McpScope, ctx: McpScanContext): Promise<boolean> {
    const path = this.ownedPath(scope, ctx);
    if (!path) return false;
    if (await exists(path)) return true;
    return isAgentPresent('grok', ctx.home);
  },
  async readOwned(scope: McpScope, ctx: McpScanContext): Promise<RawRow[]> {
    const path = this.ownedPath(scope, ctx);
    if (!path || !(await exists(path))) return [];
    return readGrokRows(path);
  },
  async writeOwned(scope, ctx, nativeKey, recipe, secrets): Promise<void> {
    const path = this.ownedPath(scope, ctx);
    if (!path) throw new DomainError('mcp.notWritable', { name: 'grok' });
    await upsertTomlServer(path, nativeKey, recipe, secrets);
  },
  async removeOwned(scope, ctx, nativeKey): Promise<void> {
    const path = this.ownedPath(scope, ctx);
    if (!path || !(await exists(path))) return;
    await deleteTomlServer(path, nativeKey);
  },
  async setEnabled(entry: McpLocationEntry, ctx: McpScanContext, enabled: boolean): Promise<void> {
    if (!(await this.writable(entry.scope, ctx))) {
      throw new DomainError('mcp.notWritable', { name: 'grok' });
    }
    const path = this.ownedPath(entry.scope, ctx);
    if (!path) return;
    const doc = (await exists(path)) ? await readTomlObject(path) : {};
    const list = new Set(stringList(doc.disabled_mcp_servers));
    if (enabled) list.delete(entry.nativeKey);
    else list.add(entry.nativeKey);
    if (list.size) doc.disabled_mcp_servers = [...list];
    else delete doc.disabled_mcp_servers;
    if (Object.keys(doc).length === 0) {
      await removeFileIfExists(path);
      return;
    }
    await writeTomlObject(path, doc);
  },
  async readBorrowed(scope: McpScope, ctx: McpScanContext): Promise<McpLocationEntry[]> {
    const out: McpLocationEntry[] = [];
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
        ...(await sharedJsonBorrowed(projectSharedMcpJson(ctx), '<rootDir>/.mcp.json', ctx, 'grok', scope))
      );
    }
    return applyGrokDisabledEntries(out, ctx, scope);
  },
};
