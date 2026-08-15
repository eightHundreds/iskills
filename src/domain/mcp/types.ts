export type McpTransport = 'stdio' | 'http' | 'sse';
export type McpScope = 'project' | 'global';
export type McpOwnership = 'owned' | 'borrowed';

export type McpCollectionMatch =
  | 'same-source'
  | 'conflicting-source'
  | 'collected-as';

export interface McpRecipe {
  transport: McpTransport;
  command?: string;
  args?: string[];
  cwd?: string;
  url?: string;
  envKeys: string[];
  headerKeys: string[];
}

export interface McpSecretValues {
  env: Record<string, string>;
  headers: Record<string, string>;
  /** Full URL when the recipe URL stripped userinfo/query. */
  url?: string;
}

export interface McpSource {
  type: string;
  agent?: string;
  scope?: McpScope;
  nativeKey?: string;
  path?: string;
}

export interface CollectedMcp {
  name: string;
  description: string;
  tags: string[];
  note: string;
  source: McpSource;
  recipe: McpRecipe;
}

export interface McpLocationEntry {
  agent: string;
  scope: McpScope;
  ownership: McpOwnership;
  /** Display id for borrowed source (claude, cursor, shared-mcp-json, …). */
  borrowedFrom?: string;
  nativeKey: string;
  enabled: boolean;
  writable: boolean;
  recipe: McpRecipe;
  secrets: McpSecretValues;
  /** Absolute config file this row was read from (owned or source of borrow). */
  filePath: string;
}

export type HttpProbeStatus = 'reachable' | 'needs-auth' | 'failed';

export interface McpScanContext {
  home: string;
  cwd: string;
}

export interface ImportMcpOptions {
  allowReplace?: boolean;
  keepSecrets?: boolean;
  confirmReplace?: (input: {
    name: string;
    match: Exclude<McpCollectionMatch, 'collected-as'>;
    current: CollectedMcp;
    incoming: CollectedMcp;
  }) => Promise<boolean>;
}

export type ImportMcpResult = 'imported' | 'unchanged' | 'cancelled' | 'collected-as';

export interface AddMcpTarget {
  agent: string;
  scope: McpScope;
}

export interface UpdateMcpLocationsOptions {
  confirmDrift?: (input: {
    entry: McpLocationEntry;
    collected: CollectedMcp;
  }) => Promise<boolean>;
}

export type CreateMcpInput = {
  name: string;
  description?: string;
  tags?: string[];
  note?: string;
  recipe: McpRecipe;
  secrets?: McpSecretValues;
};
