import { homedir } from 'node:os';
import { commitCollection } from '../core.js';
import { DomainError } from '../errors.js';
import {
  createCollectedRecord,
  deleteCollectedMcpFile,
  listCollectedMcps,
  mcpCollectionPath,
  readCollectedMcp,
  writeCollectedMcp,
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
  emptySecrets,
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
    if (match === 'same-source') return { result: 'unchanged', name: existing.name };
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
  const committed = await writeCollectedMcp(incoming, `mcp: import ${incoming.name}`);
  if (!committed) throw new DomainError('domain.gitCommitFailed', { error: incoming.name });
  if (options.keepSecrets !== false && !isEmptySecrets(secrets)) {
    await writeMcpSecrets(incoming.name, secrets);
  }
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

export async function addCollectedMcp(
  name: string,
  targets: AddMcpTarget[],
  ctx: McpScanContext = scanContext()
): Promise<{ added: number; skipped: number }> {
  const collected = await readCollectedMcp(name);
  if (!collected) throw new DomainError('mcp.missingInCollection', { name });
  const secrets = await readMcpSecrets(collected.name);
  let added = 0;
  let skipped = 0;
  for (const target of targets) {
    if (!isMcpAgentId(target.agent)) throw new DomainError('mcp.unknownAgent', { name: target.agent });
    const locations = (await listMcpLocations(target.scope, ctx)).filter(
      (entry) => entry.agent === target.agent
    );
    const already = locations.find((entry) => recipesSameEndpoint(entry.recipe, collected.recipe));
    if (already) {
      skipped += 1;
      continue;
    }
    if (!(await agentMcpWritable(target.agent, target.scope, ctx))) {
      throw new DomainError('mcp.notWritable', { name: target.agent });
    }
    await writeOwnedServer(
      target.agent,
      target.scope,
      ctx,
      collected.name,
      collected.recipe,
      secrets
    );
    added += 1;
  }
  return { added, skipped };
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
      await writeOwnedServer(entry.agent, entry.scope, ctx, entry.nativeKey, collected.recipe, secrets);
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
  await removeOwnedServer(entry.agent, entry.scope, ctx, entry.nativeKey);
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
  const committed = await writeCollectedMcp(next, `mcp: edit ${name}`);
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

export { emptySecrets, mcpCollectionPath, ownedFilePath };
