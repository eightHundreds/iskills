import { homedir } from 'node:os';
import { commitCollection, exists } from '../core.js';
import { DomainError, domainNotify } from '../errors.js';
import {
  createCollectedRecord,
  deleteCollectedMcpFile,
  listCollectedMcps,
  readCollectedMcp,
  writeCollectedMcp,
  writeCollectedMcpRecord,
} from './collection.js';
import {
  agentMcpWritable,
  isMcpAgentId,
  mcpAgentIds,
  ownedFilePath,
  readBorrowedEntries,
  readOwnedRows,
  removeOwnedServer,
  setLocationEnabled,
  toLocationEntries,
  writeOwnedServer,
} from './dialects.js';
import {
  assertMcpName,
  classifyMcpMatch,
  findCollectedByEndpoint,
  findCollectedByName,
  recipesSameEndpoint,
} from './identity.js';
import { probeHttp, type HttpProbeInit } from './probe.js';
import { fillMissingSecrets } from './recipe.js';
import {
  deleteMcpSecrets,
  isEmptySecrets,
  mergeSecrets,
  moveMcpSecrets,
  readMcpSecrets,
  writeMcpSecrets,
} from './secrets.js';
import type { ParsedMcpSnippet } from './json-snippet.js';
import type {
  AddMcpTarget,
  CollectedMcp,
  CreateMcpInput,
  HttpProbeStatus,
  ImportMcpOptions,
  ImportMcpResult,
  McpInstallReviewOptions,
  McpInstallReviewTarget,
  McpLocationEntry,
  McpScanContext,
  McpScope,
  McpSecretValues,
  UpdateMcpLocationsOptions,
} from './types.js';

export function scanContext(home = homedir(), cwd = process.cwd()): McpScanContext {
  return { home, cwd };
}

export async function listMcpLocations(
  scope: McpScope,
  ctx: McpScanContext = scanContext()
): Promise<McpLocationEntry[]> {
  const entries: McpLocationEntry[] = [];
  for (const agent of mcpAgentIds()) {
    const writable = await agentMcpWritable(agent, scope, ctx);
    const owned = await readOwnedRows(agent, scope, ctx);
    entries.push(...toLocationEntries(agent, scope, owned, 'owned', writable));
    entries.push(...(await readBorrowedEntries(agent, scope, ctx)));
  }
  return entries;
}

export async function importLocationToCollection(
  entry: McpLocationEntry,
  options: ImportMcpOptions = {}
): Promise<{ result: ImportMcpResult; name: string }> {
  const incoming: CollectedMcp = {
    name: assertMcpName(entry.nativeKey),
    description: '',
    tags: [],
    note: '',
    source: {
      type: entry.borrowedFrom ?? entry.agent,
      agent: entry.agent,
      scope: entry.scope,
      nativeKey: entry.nativeKey,
      path: entry.filePath,
    },
    recipe: entry.recipe,
  };
  return commitImportedMcp(incoming, entry.secrets, options);
}

export async function importSnippetToCollection(
  snippet: ParsedMcpSnippet,
  options: ImportMcpOptions = {}
): Promise<{ result: ImportMcpResult; name: string }> {
  const incoming: CollectedMcp = {
    name: assertMcpName(snippet.name),
    description: '',
    tags: [],
    note: '',
    source: { type: 'create' },
    recipe: snippet.recipe,
  };
  return commitImportedMcp(incoming, snippet.secrets, options);
}

async function commitImportedMcp(
  incoming: CollectedMcp,
  secrets: McpSecretValues,
  options: ImportMcpOptions
): Promise<{ result: ImportMcpResult; name: string }> {
  const collection = await listCollectedMcps();
  const sameEndpoint = findCollectedByEndpoint(collection, incoming.recipe);
  if (sameEndpoint && sameEndpoint.name.toLowerCase() !== incoming.name.toLowerCase()) {
    return { result: 'collected-as', name: sameEndpoint.name };
  }
  const existing = findCollectedByName(collection, incoming.name);
  if (existing) {
    const match = classifyMcpMatch(existing, incoming);
    if (match === 'same-source' && !existing.secretsResetPending) {
      if (options.keepSecrets !== false) {
        const { fillMissing } = await import('../agent-mcp-write.js');
        const before = await readMcpSecrets(existing.name);
        const next = fillMissing(before, secrets);
        if (JSON.stringify(before) !== JSON.stringify(next)) {
          await writeMcpSecrets(existing.name, next);
          await commitCollection(`mcp: complete secrets ${existing.name}`);
          return { result: 'imported', name: existing.name };
        }
      }
      return { result: 'unchanged', name: existing.name };
    }
    if (match === 'collected-as') return { result: 'collected-as', name: existing.name };
    if (!options.allowReplace) {
      if (!options.confirmReplace) {
        throw new DomainError('mcp.sameNameExistsReplace', { name: incoming.name });
      }
      const allowed = await options.confirmReplace({
        name: incoming.name,
        match,
        current: existing,
        incoming,
      });
      if (!allowed) return { result: 'cancelled', name: incoming.name };
    }
  }
  const { collectMcpRecords } = await import('../agent-mcp-write.js');
  const result = await collectMcpRecords([{ mcp: incoming, secrets: options.keepSecrets === false ? { env: {}, headers: {} } : secrets }], { replace: true }, 'mcp.import', new AbortController().signal);
  if (result.error) throw new DomainError('mcp.writeFailed', { name: incoming.name }, { cause: new Error(result.error.code) });
  for (const warning of result.warnings ?? []) domainNotify('domain.gitCommitFailed', { error: warning.code });
  return { result: 'imported', name: incoming.name };
}

export async function createCollectedMcp(input: CreateMcpInput): Promise<CollectedMcp> {
  const collected = await createCollectedRecord(input);
  const committed = await writeCollectedMcp(collected, `mcp: create ${collected.name}`);
  if (!committed) throw new DomainError('domain.gitCommitFailed', { error: collected.name });
  return collected;
}

export async function writableMcpTargets(
  agents: readonly string[],
  scope: McpScope,
  ctx: McpScanContext = scanContext()
): Promise<AddMcpTarget[]> {
  const targets: AddMcpTarget[] = [];
  for (const agent of agents) {
    if (isMcpAgentId(agent) && (await agentMcpWritable(agent, scope, ctx))) {
      targets.push({ agent, scope });
    }
  }
  return targets;
}

/** Who is writable, with config paths. UI draws labels. */
export async function mcpInstallReviewOptions(
  ctx: McpScanContext = scanContext()
): Promise<McpInstallReviewOptions> {
  const targets: McpInstallReviewTarget[] = [];
  const defaultProjectAgents: string[] = [];
  const writableGlobal: string[] = [];
  for (const agent of mcpAgentIds()) {
    const projectPath = ownedFilePath(agent, 'project', ctx);
    const globalPath = ownedFilePath(agent, 'global', ctx);
    const projectWritable = await agentMcpWritable(agent, 'project', ctx);
    const globalWritable = await agentMcpWritable(agent, 'global', ctx);
    if (!projectWritable && !globalWritable) continue;
    targets.push({
      value: agent,
      ...(projectWritable && projectPath ? { projectPath } : {}),
      ...(globalWritable && globalPath ? { globalPath } : {}),
    });
    if (projectWritable && projectPath && (await exists(projectPath))) {
      defaultProjectAgents.push(agent);
    }
    if (globalWritable) writableGlobal.push(agent);
  }
  const defaultGlobalAgents = writableGlobal.includes('agents')
    ? ['agents']
    : writableGlobal[0]
      ? [writableGlobal[0]]
      : [];
  return { targets, defaultProjectAgents, defaultGlobalAgents };
}

export async function addCollectedMcp(
  name: string,
  targets: AddMcpTarget[],
  ctx: McpScanContext = scanContext()
): Promise<{ added: number; skipped: number }> {
  const { planMcpAdds } = await import('../agent-mcp-write.js');
  const { executeWrites } = await import('../agent-write.js');
  try {
    const result = await executeWrites(await planMcpAdds([name], targets, ctx), false, false, 'mcp.add', new AbortController().signal);
    if (result.error) throw new DomainError('mcp.sameNameExistsReplace', { name });
    const items = result.result.items as Array<{ status: string }>;
    return { added: items.filter((item) => item.status === 'committed').length, skipped: items.filter((item) => item.status === 'unchanged').length };
  } catch (error) {
    const failure = error as { code?: string; details?: Record<string, unknown> };
    if (failure.code === 'mcp.notWritable') throw new DomainError('mcp.notWritable', { name: String(failure.details?.agent) });
    throw error;
  }
}

export async function toggleMcpLocation(
  entry: McpLocationEntry,
  ctx: McpScanContext = scanContext()
): Promise<boolean> {
  const next = !entry.enabled;
  await setLocationEnabled(entry, ctx, next);
  return next;
}

export async function updateLocationsFromCollection(
  name: string,
  options: UpdateMcpLocationsOptions = {},
  ctx: McpScanContext = scanContext()
): Promise<{ updated: number; skipped: number; cancelled: number }> {
  const collected = await readCollectedMcp(name);
  if (!collected) throw new DomainError('mcp.missingInCollection', { name });
  const overlay = await readMcpSecrets(collected.name);
  if (collected.secretsResetPending) throw new DomainError('mcp.missingSecrets', { name });
  let updated = 0;
  let skipped = 0;
  let cancelled = 0;
  for (const scope of ['project', 'global'] as const) {
    const entries = (await listMcpLocations(scope, ctx)).filter((entry) => {
      if (entry.ownership !== 'owned') return false;
      if (recipesSameEndpoint(entry.recipe, collected.recipe)) return true;
      const keys = new Set(
        [collected.name, collected.source.nativeKey].filter((value): value is string => Boolean(value))
      );
      return keys.has(entry.nativeKey);
    });
    for (const entry of entries) {
      if (!isMcpAgentId(entry.agent)) continue;
      const drifted = !sameProjectedRecipe(entry.recipe, collected.recipe);
      if (drifted && options.confirmDrift) {
        const allowed = await options.confirmDrift({ entry, collected });
        if (!allowed) {
          cancelled += 1;
          continue;
        }
      } else if (drifted && !options.confirmDrift) {
        skipped += 1;
        continue;
      }
      const secrets = fillMissingSecrets(entry.secrets, overlay);
      const { writeMcpLocation } = await import('./location-write.js');
      await writeMcpLocation(entry, ctx, collected.recipe, secrets);
      updated += 1;
    }
  }
  return { updated, skipped, cancelled };
}

export async function removeCollectedMcp(name: string): Promise<boolean> {
  const existing = await readCollectedMcp(name);
  if (!existing) return true;
  await deleteCollectedMcpFile(name);
  await deleteMcpSecrets(name);
  return commitCollection(`mcp: remove ${name}`);
}

export async function removeMcpLocation(
  entry: McpLocationEntry,
  ctx: McpScanContext = scanContext()
): Promise<void> {
  if (entry.ownership !== 'owned' || !entry.writable) {
    throw new DomainError('mcp.borrowedNotMutable', { name: entry.nativeKey });
  }
  if (!isMcpAgentId(entry.agent)) throw new DomainError('mcp.unknownAgent', { name: entry.agent });
  const { writeMcpLocation } = await import('./location-write.js');
  await writeMcpLocation(entry, ctx);
}

export async function renameCollectedMcp(from: string, to: string): Promise<CollectedMcp> {
  const current = await readCollectedMcp(from);
  if (!current) throw new DomainError('mcp.missingInCollection', { name: from });
  const nextName = assertMcpName(to);
  if (nextName === current.name) return current;
  const existing = await readCollectedMcp(nextName);
  // Case-insensitive volumes resolve Xuansi.json to the current xuansi.json.
  // That is a case-only rename of the same MCP, not a second collection entry.
  if (existing && existing.name !== current.name) {
    throw new DomainError('mcp.sameNameExistsReplace', { name: nextName });
  }
  const renamed = { ...current, name: nextName };
  await deleteCollectedMcpFile(current.name);
  await moveMcpSecrets(current.name, nextName);
  const committed = await writeCollectedMcp(renamed, `mcp: rename ${current.name} ${nextName}`);
  if (!committed) throw new DomainError('domain.gitCommitFailed', { error: nextName });
  return renamed;
}

export async function updateCollectedRecipe(
  name: string,
  recipe: CollectedMcp['recipe']
): Promise<CollectedMcp> {
  const current = await readCollectedMcp(name);
  if (!current) throw new DomainError('mcp.missingInCollection', { name });
  const next = { ...current, recipe };
  const clear = Boolean(current.secretsResetPending || !recipesSameEndpoint(current.recipe, recipe));
  await writeCollectedMcpRecord({ ...next, secretsResetPending: clear });
  if (clear) {
    await deleteMcpSecrets(name);
    await writeCollectedMcpRecord({ ...next, secretsResetPending: false });
  }
  const committed = await commitCollection(`mcp: edit ${name}`);
  if (!committed) throw new DomainError('domain.gitCommitFailed', { error: name });
  return next;
}

export async function updateCollectedMeta(
  name: string,
  patch: Partial<Pick<CollectedMcp, 'tags' | 'note' | 'description'>>
): Promise<CollectedMcp> {
  const current = await readCollectedMcp(name);
  if (!current) throw new DomainError('mcp.missingInCollection', { name });
  const next = { ...current, ...patch };
  const committed = await writeCollectedMcp(next, `mcp: meta ${name}`);
  if (!committed) throw new DomainError('domain.gitCommitFailed', { error: name });
  return next;
}

export async function probeCollectedHttp(
  name: string,
  init?: HttpProbeInit
): Promise<HttpProbeStatus> {
  const collected = await readCollectedMcp(name);
  if (!collected) throw new DomainError('mcp.missingInCollection', { name });
  if (collected.recipe.transport !== 'http' && collected.recipe.transport !== 'sse') {
    throw new DomainError('mcp.probeUnsupported', { name });
  }
  const secrets = await readMcpSecrets(name);
  return probeHttp(collected.recipe, secrets, init);
}

export async function storeCollectedLoginSecret(
  name: string,
  headerName: string,
  value: string
): Promise<void> {
  return storeCollectedOverlaySecret(name, 'headers', headerName, value);
}

export async function storeCollectedOverlaySecret(
  name: string,
  slot: 'headers' | 'env',
  key: string,
  value: string
): Promise<void> {
  const current = await readMcpSecrets(name);
  const extra =
    slot === 'env'
      ? { env: { [key]: value }, headers: {} }
      : { env: {}, headers: { [key]: value } };
  await writeMcpSecrets(name, mergeSecrets(current, extra));
}

function sameProjectedRecipe(
  location: CollectedMcp['recipe'],
  collected: CollectedMcp['recipe']
): boolean {
  if (location.transport !== collected.transport) return false;
  if ((location.command ?? '') !== (collected.command ?? '')) return false;
  if ((location.url ?? '') !== (collected.url ?? '')) return false;
  const leftArgs = location.args ?? [];
  const rightArgs = collected.args ?? [];
  if (leftArgs.length !== rightArgs.length) return false;
  return leftArgs.every((arg, index) => arg === rightArgs[index]);
}
