import { join } from 'node:path';
import { readJsonObject, writeJsonObject } from './io.js';
import { projectServerObject } from './recipe.js';
import {
  removeOwnedServer,
  writeOwnedServer,
  isMcpAgentId,
  setLocationEnabled,
} from './dialects/index.js';
import type {
  McpLocationEntry,
  McpRecipe,
  McpScanContext,
  McpSecretValues,
} from './types.js';
import { OperationFailure } from '../operation.js';

/** Preserve Claude's distinct project-local object instead of routing it to .mcp.json. */
export async function writeMcpLocation(
  entry: McpLocationEntry,
  ctx: McpScanContext,
  recipe?: McpRecipe,
  secrets?: McpSecretValues,
): Promise<void> {
  if (entry.ownership !== 'owned' || !entry.writable)
    throw new OperationFailure(
      'mcp.borrowedNotMutable',
      'This MCP location cannot be changed.',
      { nativeKey: entry.nativeKey },
    );
  if (!isMcpAgentId(entry.agent))
    throw new OperationFailure('usage.unsupportedCapability', 'Unknown Agent.');
  if (
    entry.agent === 'claude' &&
    entry.scope === 'project' &&
    entry.filePath === join(ctx.home, '.claude.json')
  ) {
    const doc = await readJsonObject(entry.filePath);
    const projects = (doc.projects ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    const project = projects[ctx.cwd] ?? {};
    const servers = (project.mcpServers ?? {}) as Record<string, unknown>;
    if (recipe) {
      const next = projectServerObject(
        recipe,
        secrets ?? entry.secrets,
        'json',
      );
      delete next.disabled;
      servers[entry.nativeKey] = next;
    } else delete servers[entry.nativeKey];
    project.mcpServers = servers;
    projects[ctx.cwd] = project;
    doc.projects = projects;
    await writeJsonObject(entry.filePath, doc);
  } else if (recipe) {
    await writeOwnedServer(
      entry.agent,
      entry.scope,
      ctx,
      entry.nativeKey,
      recipe,
      secrets ?? entry.secrets,
    );
    if (!entry.enabled) await setLocationEnabled(entry, ctx, false);
  } else
    await removeOwnedServer(entry.agent, entry.scope, ctx, entry.nativeKey);
}
