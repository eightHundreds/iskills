import type { McpAgentId } from './ids.js';
import type { RawRow } from './shared.js';
import type { McpLocationEntry, McpRecipe, McpScanContext, McpScope, McpSecretValues } from '../types.js';

export interface McpDialect {
  readonly id: McpAgentId;
  ownedPath(scope: McpScope, ctx: McpScanContext): string | undefined;
  writable(scope: McpScope, ctx: McpScanContext): Promise<boolean>;
  readOwned(scope: McpScope, ctx: McpScanContext): Promise<RawRow[]>;
  writeOwned(
    scope: McpScope,
    ctx: McpScanContext,
    nativeKey: string,
    recipe: McpRecipe,
    secrets: McpSecretValues
  ): Promise<void>;
  removeOwned(scope: McpScope, ctx: McpScanContext, nativeKey: string): Promise<void>;
  setEnabled(entry: McpLocationEntry, ctx: McpScanContext, enabled: boolean): Promise<void>;
  readBorrowed(scope: McpScope, ctx: McpScanContext): Promise<McpLocationEntry[]>;
}

const dialects = new Map<McpAgentId, McpDialect>();

export function registerDialect(dialect: McpDialect): void {
  dialects.set(dialect.id, dialect);
}

export function getDialect(id: McpAgentId): McpDialect {
  const dialect = dialects.get(id);
  if (!dialect) throw new Error(`unknown MCP dialect: ${id}`);
  return dialect;
}
