import { join } from 'node:path';
import { exists } from '../../core.js';
import { readJsonMcpServers, toLocationEntries } from './shared.js';
import { getDialect } from './registry.js';
import type { McpAgentId } from './ids.js';
import type { McpLocationEntry, McpScanContext, McpScope } from '../types.js';

export async function asBorrowed(
  viewer: string,
  viewerScope: McpScope,
  sourceAgent: McpAgentId,
  sourceScope: McpScope,
  ctx: McpScanContext,
  borrowedFrom: string
): Promise<McpLocationEntry[]> {
  const source = getDialect(sourceAgent);
  const rows = await source.readOwned(sourceScope, ctx);
  const path = source.ownedPath(sourceScope, ctx) ?? rows[0]?.filePath ?? '';
  return toLocationEntries(viewer, viewerScope, rows, 'borrowed', false, borrowedFrom).map((entry) => ({
    ...entry,
    filePath: path || entry.filePath,
  }));
}

export async function sharedJsonBorrowed(
  path: string,
  borrowedFrom: string,
  ctx: McpScanContext,
  viewer: string,
  scope: McpScope
): Promise<McpLocationEntry[]> {
  if (!(await exists(path))) return [];
  const rows = await readJsonMcpServers(path, 'mcpServers');
  return toLocationEntries(viewer, scope, rows, 'borrowed', false, borrowedFrom).map((entry) => ({
    ...entry,
    filePath: path,
  }));
}

export function projectSharedMcpJson(ctx: McpScanContext): string {
  return join(ctx.cwd, '.mcp.json');
}
