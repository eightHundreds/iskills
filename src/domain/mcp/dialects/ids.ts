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

export function isMcpAgentId(name: string): name is McpAgentId {
  return (MCP_AGENT_IDS as readonly string[]).includes(name);
}

export function mcpAgentIds(): McpAgentId[] {
  return [...MCP_AGENT_IDS];
}
