export type {
  AddMcpTarget,
  CollectedMcp,
  CreateMcpInput,
  HttpProbeStatus,
  ImportMcpOptions,
  ImportMcpResult,
  McpCollectionMatch,
  McpLocationEntry,
  McpRecipe,
  McpScanContext,
  McpScope,
  McpSecretValues,
  McpSource,
  McpTransport,
  UpdateMcpLocationsOptions,
} from './types.js';

export {
  assertMcpName,
  classifyMcpMatch,
  findCollectedByEndpoint,
  findCollectedByName,
  recipeEndpoint,
  recipesSameEndpoint,
} from './identity.js';

export { listCollectedMcps, readCollectedMcp, ensureMcpCollection } from './collection.js';

export {
  deleteMcpSecrets,
  emptySecrets,
  isEmptySecrets,
  mcpLoginState,
  mcpProtocolLoginState,
  mcpSecretState,
  readMcpSecrets,
  readMcpSecretsInGit,
  setMcpSecretsInGit,
  writeMcpSecrets,
} from './secrets.js';

export type { McpLoginState, McpSecretState } from './secrets.js';

export { probeHttp } from './probe.js';

export {
  isSecretHeaderName,
  parseColonPairs,
  secretsFromPairs,
} from './headers.js';

export { isMcpAgentId, mcpAgentIds, agentMcpWritable } from './dialects.js';

export {
  classifyJsonSnippet,
  classifyJsonSnippets,
  parseMcpJsonSnippet,
} from './json-snippet.js';

export type {
  JsonImportCandidate,
  JsonImportStatus,
  ParsedMcpSnippet,
  ParseMcpJsonResult,
} from './json-snippet.js';

export { isPlaceholder } from './recipe.js';

export {
  addCollectedMcp,
  createCollectedMcp,
  writableMcpTargets,
  importLocationToCollection,
  importSnippetToCollection,
  listMcpLocations,
  probeCollectedHttp,
  removeCollectedMcp,
  removeMcpLocation,
  renameCollectedMcp,
  scanContext,
  storeCollectedLoginSecret,
  storeCollectedOverlaySecret,
  toggleMcpLocation,
  updateCollectedMeta,
  updateCollectedRecipe,
  updateLocationsFromCollection,
} from './write.js';
