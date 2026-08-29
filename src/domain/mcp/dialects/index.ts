import { join } from 'node:path';
import { exists, isAgentPresent } from '../../core.js';
import { DomainError } from '../../errors.js';
import { claudeDialect } from './claude.js';
import { grokDialect } from './grok.js';
import { MCP_AGENT_IDS, isMcpAgentId, mcpAgentIds, type McpAgentId } from './ids.js';
import {
  asObject,
  deleteJsonServer,
  deleteTomlServer,
  readJsonMcpServers,
  toLocationEntries,
  upsertJsonServer,
  upsertTomlServer,
  type RawRow,
} from './shared.js';
import { piDialect, isPiAdapterPresent } from './pi.js';
import { getDialect, registerDialect, type McpDialect } from './registry.js';
import { readJsonObject, writeJsonObject, readTomlObject, writeTomlObject } from '../io.js';
import { extractFromServerObject, projectServerObject, projectTomlServer } from '../recipe.js';
import type {
  McpLocationEntry,
  McpRecipe,
  McpScanContext,
  McpScope,
  McpSecretValues,
} from '../types.js';

export { MCP_AGENT_IDS, isMcpAgentId, mcpAgentIds, type McpAgentId };
export { isPiAdapterPresent, toLocationEntries };

function jsonPaths(
  globalPath: (ctx: McpScanContext) => string,
  projectPath?: (ctx: McpScanContext) => string
): Pick<McpDialect, 'ownedPath'> {
  return {
    ownedPath(scope: McpScope, ctx: McpScanContext): string | undefined {
      if (scope === 'global') return globalPath(ctx);
      return projectPath?.(ctx);
    },
  };
}

async function fileOrPresent(
  id: McpAgentId,
  path: string | undefined,
  ctx: McpScanContext
): Promise<boolean> {
  if (!path) return false;
  if (await exists(path)) return true;
  return isAgentPresent(id, ctx.home);
}

function jsonDialect(
  id: McpAgentId,
  paths: Pick<McpDialect, 'ownedPath'>,
  options: { zcodeGlobal?: boolean } = {}
): McpDialect {
  return {
    id,
    ownedPath: paths.ownedPath,
    async writable(scope, ctx): Promise<boolean> {
      const path = this.ownedPath(scope, ctx);
      if (!path) return false;
      if (options.zcodeGlobal && scope === 'global') {
        if (!(await exists(path))) return false;
        const doc = await readJsonObject(path);
        return 'mcpServers' in doc || 'mcp' in doc;
      }
      return fileOrPresent(id, path, ctx);
    },
    async readOwned(scope, ctx): Promise<RawRow[]> {
      const path = this.ownedPath(scope, ctx);
      if (!path || !(await exists(path))) return [];
      return readJsonMcpServers(path, 'mcpServers');
    },
    async writeOwned(scope, ctx, nativeKey, recipe, secrets): Promise<void> {
      const path = this.ownedPath(scope, ctx);
      if (!path) throw new DomainError('mcp.notWritable', { name: id });
      let previous: Record<string, unknown> = {};
      if (await exists(path)) {
        const doc = await readJsonObject(path);
        previous = asObject(asObject(doc.mcpServers)[nativeKey]);
      }
      const next = projectServerObject(recipe, secrets, 'json');
      if (previous.disabled === true) next.disabled = true;
      await upsertJsonServer(path, 'mcpServers', nativeKey, next);
    },
    async removeOwned(scope, ctx, nativeKey): Promise<void> {
      const path = this.ownedPath(scope, ctx);
      if (!path || !(await exists(path))) return;
      await deleteJsonServer(path, 'mcpServers', nativeKey);
    },
    async setEnabled(entry, ctx, enabled): Promise<void> {
      if (entry.ownership === 'borrowed') {
        throw new DomainError('mcp.borrowedNotMutable', { name: entry.nativeKey });
      }
      const path = this.ownedPath(entry.scope, ctx);
      if (!path || !(await exists(path))) return;
      const doc = await readJsonObject(path);
      const servers = asObject(doc.mcpServers);
      const current = asObject(servers[entry.nativeKey]);
      if (enabled) delete current.disabled;
      else current.disabled = true;
      servers[entry.nativeKey] = current;
      doc.mcpServers = servers;
      await writeJsonObject(path, doc);
    },
    async readBorrowed(): Promise<McpLocationEntry[]> {
      return [];
    },
  };
}

const opencodeDialect: McpDialect = {
  id: 'opencode',
  ownedPath(scope, ctx) {
    return scope === 'global'
      ? join(ctx.home, '.config/opencode/opencode.json')
      : join(ctx.cwd, 'opencode.json');
  },
  async writable(scope, ctx): Promise<boolean> {
    return fileOrPresent('opencode', this.ownedPath(scope, ctx), ctx);
  },
  async readOwned(scope, ctx): Promise<RawRow[]> {
    const path = this.ownedPath(scope, ctx);
    if (!path || !(await exists(path))) return [];
    const doc = await readJsonObject(path);
    const mcp = asObject(doc.mcp);
    return Object.entries(mcp).map(([nativeKey, value]) => {
      const extracted = extractFromServerObject(asObject(value));
      return { nativeKey, filePath: path, ...extracted };
    });
  },
  async writeOwned(scope, ctx, nativeKey, recipe, secrets): Promise<void> {
    const path = this.ownedPath(scope, ctx);
    if (!path) throw new DomainError('mcp.notWritable', { name: 'opencode' });
    const doc = (await exists(path)) ? await readJsonObject(path) : {};
    const mcp = asObject(doc.mcp);
    const previous = asObject(mcp[nativeKey]);
    const next = projectServerObject(recipe, secrets, 'opencode');
    if (previous.enabled === false) next.enabled = false;
    mcp[nativeKey] = next;
    doc.mcp = mcp;
    await writeJsonObject(path, doc);
  },
  async removeOwned(scope, ctx, nativeKey): Promise<void> {
    const path = this.ownedPath(scope, ctx);
    if (!path || !(await exists(path))) return;
    const doc = await readJsonObject(path);
    const mcp = asObject(doc.mcp);
    delete mcp[nativeKey];
    doc.mcp = mcp;
    await writeJsonObject(path, doc);
  },
  async setEnabled(entry, ctx, enabled): Promise<void> {
    if (entry.ownership === 'borrowed') {
      throw new DomainError('mcp.borrowedNotMutable', { name: entry.nativeKey });
    }
    const path = this.ownedPath(entry.scope, ctx);
    if (!path) return;
    const doc = await readJsonObject(path);
    const mcp = asObject(doc.mcp);
    const current = asObject(mcp[entry.nativeKey]);
    current.enabled = enabled;
    mcp[entry.nativeKey] = current;
    doc.mcp = mcp;
    await writeJsonObject(path, doc);
  },
  async readBorrowed(): Promise<McpLocationEntry[]> {
    return [];
  },
};

const codexDialect: McpDialect = {
  id: 'codex',
  ownedPath(scope, ctx) {
    if (scope === 'global') return join(ctx.home, '.codex/config.toml');
    return undefined;
  },
  async writable(scope, ctx): Promise<boolean> {
    return fileOrPresent('codex', this.ownedPath(scope, ctx), ctx);
  },
  async readOwned(scope, ctx): Promise<RawRow[]> {
    const path = this.ownedPath(scope, ctx);
    if (!path || !(await exists(path))) return [];
    const doc = await readTomlObject(path);
    const servers = asObject(doc.mcp_servers);
    return Object.entries(servers).map(([nativeKey, value]) => {
      const extracted = extractFromServerObject(asObject(value));
      return { nativeKey, filePath: path, ...extracted };
    });
  },
  async writeOwned(scope, ctx, nativeKey, recipe, secrets): Promise<void> {
    const path = this.ownedPath(scope, ctx);
    if (!path) throw new DomainError('mcp.notWritable', { name: 'codex' });
    let previous: Record<string, unknown> = {};
    if (await exists(path)) {
      const doc = await readTomlObject(path);
      previous = asObject(asObject(doc.mcp_servers)[nativeKey]);
    }
    const next = projectTomlServer(recipe, secrets);
    if (previous.enabled === false) next.enabled = false;
    await upsertTomlServer(path, nativeKey, next);
  },
  async removeOwned(scope, ctx, nativeKey): Promise<void> {
    const path = this.ownedPath(scope, ctx);
    if (!path || !(await exists(path))) return;
    await deleteTomlServer(path, nativeKey);
  },
  async setEnabled(entry, ctx, enabled): Promise<void> {
    if (entry.ownership === 'borrowed') {
      throw new DomainError('mcp.borrowedNotMutable', { name: entry.nativeKey });
    }
    const path = this.ownedPath(entry.scope, ctx);
    if (!path) return;
    const doc = await readTomlObject(path);
    const servers = asObject(doc.mcp_servers);
    const current = asObject(servers[entry.nativeKey]);
    current.enabled = enabled;
    servers[entry.nativeKey] = current;
    doc.mcp_servers = servers;
    await writeTomlObject(path, doc);
  },
  async readBorrowed(): Promise<McpLocationEntry[]> {
    return [];
  },
};

const jsonAgents: McpDialect[] = [
  jsonDialect('agents', jsonPaths((ctx) => join(ctx.home, '.agents/mcp.json'))),
  jsonDialect(
    'cursor',
    jsonPaths((ctx) => join(ctx.home, '.cursor/mcp.json'), (ctx) => join(ctx.cwd, '.cursor/mcp.json'))
  ),
  jsonDialect(
    'trae',
    jsonPaths((ctx) => join(ctx.home, '.trae/mcp.json'), (ctx) => join(ctx.cwd, '.trae/mcp.json'))
  ),
  jsonDialect(
    'qoder',
    jsonPaths((ctx) => join(ctx.home, '.qoder/settings.json'), (ctx) => join(ctx.cwd, '.qoder/settings.json'))
  ),
  jsonDialect(
    'zcode',
    jsonPaths(
      (ctx) => join(ctx.home, '.zcode/cli/config.json'),
      (ctx) => join(ctx.cwd, '.zcode/config.json')
    ),
    { zcodeGlobal: true }
  ),
];

for (const dialect of [
  ...jsonAgents,
  claudeDialect,
  piDialect,
  grokDialect,
  opencodeDialect,
  codexDialect,
]) {
  registerDialect(dialect);
}

export function ownedFilePath(
  agent: McpAgentId,
  scope: McpScope,
  ctx: McpScanContext
): string | undefined {
  return getDialect(agent).ownedPath(scope, ctx);
}

export async function agentMcpWritable(
  agent: McpAgentId,
  scope: McpScope,
  ctx: McpScanContext
): Promise<boolean> {
  return getDialect(agent).writable(scope, ctx);
}

export async function readOwnedRows(
  agent: McpAgentId,
  scope: McpScope,
  ctx: McpScanContext
): Promise<RawRow[]> {
  return getDialect(agent).readOwned(scope, ctx);
}

export async function readBorrowedEntries(
  agent: McpAgentId,
  scope: McpScope,
  ctx: McpScanContext
): Promise<McpLocationEntry[]> {
  return getDialect(agent).readBorrowed(scope, ctx);
}

export async function writeOwnedServer(
  agent: McpAgentId,
  scope: McpScope,
  ctx: McpScanContext,
  nativeKey: string,
  recipe: McpRecipe,
  secrets: McpSecretValues
): Promise<void> {
  const dialect = getDialect(agent);
  if (!(await dialect.writable(scope, ctx))) {
    throw new DomainError('mcp.notWritable', { name: agent });
  }
  await dialect.writeOwned(scope, ctx, nativeKey, recipe, secrets);
}

export async function removeOwnedServer(
  agent: McpAgentId,
  scope: McpScope,
  ctx: McpScanContext,
  nativeKey: string
): Promise<void> {
  const dialect = getDialect(agent);
  if (!(await dialect.writable(scope, ctx))) {
    throw new DomainError('mcp.borrowedNotMutable', { name: nativeKey });
  }
  await dialect.removeOwned(scope, ctx, nativeKey);
}

export async function setLocationEnabled(
  entry: McpLocationEntry,
  ctx: McpScanContext,
  enabled: boolean
): Promise<void> {
  if (!isMcpAgentId(entry.agent)) {
    throw new DomainError('mcp.unknownAgent', { name: entry.agent });
  }
  await getDialect(entry.agent).setEnabled(entry, ctx, enabled);
}
