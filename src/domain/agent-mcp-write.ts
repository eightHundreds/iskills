import { readFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  readMcps,
  readMcpLocations,
  mcpSelector,
  publicLocation,
} from './agent-read.js';
import {
  executeWrites,
  conflictItem,
  requireAuthorization,
  type PlannedWrite,
} from './agent-write.js';
import { metadataPatch } from './agent-skill-write.js';
import {
  OperationFailure,
  registerSecrets,
  type OperationResult,
} from './operation.js';
import {
  assertMcpName,
  recipeEndpoint,
  recipesSameEndpoint,
  stripSecretUrl,
} from './mcp/identity.js';
import {
  writeCollectedMcpRecord,
  deleteCollectedMcpFile,
} from './mcp/collection.js';
import {
  readMcpSecrets,
  writeMcpSecrets,
  deleteMcpSecrets,
  emptySecrets,
} from './mcp/secrets.js';
import { parseMcpJsonSnippet } from './mcp/json-snippet.js';
import {
  agentMcpWritable,
  ownedFilePath,
  isMcpAgentId,
  writeOwnedServer,
  setLocationEnabled,
} from './mcp/dialects/index.js';
import { writeMcpLocation } from './mcp/location-write.js';
import {
  renameTagInList,
  writeTagRenameBatch,
  normalizeNewTagName,
} from './tags.js';
import type {
  AddMcpTarget,
  CollectedMcp,
  McpLocationEntry,
  McpRecipe,
  McpSecretValues,
  McpScanContext,
} from './mcp/types.js';
import { isPlaceholder } from './mcp/recipe.js';

export interface McpWriteRequest {
  command: string;
  project: string;
  names: string[];
  options: Record<string, unknown>;
  signal: AbortSignal;
}

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new OperationFailure(
      'usage.invalidArguments',
      'A JSON object is required.',
    );
  const data = value as Record<string, unknown>;
  if (Object.keys(data).some((key) => !keys.includes(key)))
    throw new OperationFailure(
      'usage.invalidArguments',
      'The JSON contains unknown fields.',
    );
  return data;
}

export function validateRecipe(raw: unknown): McpRecipe {
  const recipe = object(raw, [
    'transport',
    'command',
    'args',
    'cwd',
    'url',
    'envKeys',
    'headerKeys',
  ]);
  if (!['stdio', 'http', 'sse'].includes(String(recipe.transport)))
    throw new OperationFailure(
      'usage.invalidArguments',
      'Invalid MCP transport.',
    );
  for (const key of ['envKeys', 'headerKeys'])
    if (
      !Array.isArray(recipe[key]) ||
      (recipe[key] as unknown[]).some(
        (value) => typeof value !== 'string' || !value,
      )
    )
      throw new OperationFailure(
        'usage.invalidArguments',
        'Secret key lists must be arrays of strings.',
      );
  for (const key of ['command', 'cwd', 'url'])
    if (recipe[key] !== undefined && typeof recipe[key] !== 'string')
      throw new OperationFailure(
        'usage.invalidArguments',
        'MCP string field has an invalid type.',
        { field: key },
      );
  if (
    recipe.args !== undefined &&
    (!Array.isArray(recipe.args) ||
      recipe.args.some((value) => typeof value !== 'string'))
  )
    throw new OperationFailure(
      'usage.invalidArguments',
      'Arguments must be strings.',
    );
  if (recipe.transport === 'stdio') {
    if (!recipe.command || recipe.url !== undefined)
      throw new OperationFailure(
        'usage.invalidArguments',
        'stdio requires command and does not accept url.',
      );
  } else {
    if (
      !recipe.url ||
      ['command', 'args', 'cwd'].some((key) => recipe[key] !== undefined)
    )
      throw new OperationFailure(
        'usage.invalidArguments',
        'HTTP/SSE requires url and does not accept process fields.',
      );
    try {
      if (!['https:', 'http:'].includes(new URL(recipe.url as string).protocol))
        throw new Error();
    } catch {
      throw new OperationFailure(
        'usage.invalidArguments',
        'A valid HTTP URL is required.',
      );
    }
  }
  return recipe as unknown as McpRecipe;
}

function validateSecrets(raw: unknown): McpSecretValues {
  if (raw === undefined) return emptySecrets();
  const data = object(raw, ['env', 'headers', 'url']);
  const out = emptySecrets();
  for (const slot of ['env', 'headers'] as const) {
    if (data[slot] === undefined) continue;
    if (
      !data[slot] ||
      typeof data[slot] !== 'object' ||
      Array.isArray(data[slot])
    )
      throw new OperationFailure(
        'usage.invalidArguments',
        'Secrets must be string maps.',
      );
    for (const [key, value] of Object.entries(
      data[slot] as Record<string, unknown>,
    )) {
      if (typeof value !== 'string')
        throw new OperationFailure(
          'usage.invalidArguments',
          'Secret values must be strings.',
        );
      out[slot][key] = value;
    }
  }
  if (data.url !== undefined) {
    if (typeof data.url !== 'string')
      throw new OperationFailure(
        'usage.invalidArguments',
        'Secret URL must be a string.',
      );
    out.url = data.url;
  }
  return out;
}

async function inputText(path: string, project: string): Promise<string> {
  if (path !== '-') return readFile(resolve(project, path), 'utf8');
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function jsonInput(path: unknown, project: string): Promise<unknown> {
  if (typeof path !== 'string')
    throw new OperationFailure(
      'usage.invalidArguments',
      '--input is required.',
    );
  try {
    return JSON.parse(await inputText(path, project));
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new OperationFailure(
        'usage.invalidArguments',
        'Input JSON is invalid.',
      );
    throw error;
  }
}

export function fillMissing(
  base: McpSecretValues,
  incoming: McpSecretValues,
): McpSecretValues {
  const next = {
    env: { ...base.env },
    headers: { ...base.headers },
    ...(base.url ? { url: base.url } : {}),
  };
  for (const slot of ['env', 'headers'] as const)
    for (const [key, value] of Object.entries(incoming[slot])) {
      const existing = Object.keys(next[slot]).find((name) =>
        slot === 'headers'
          ? name.toLowerCase() === key.toLowerCase()
          : name === key,
      );
      if (
        !existing ||
        !next[slot][existing] ||
        isPlaceholder(next[slot][existing]!)
      ) {
        if (existing) delete next[slot][existing];
        next[slot][key] = value;
      }
    }
  if (!next.url && incoming.url) next.url = incoming.url;
  return next;
}

export function checkSecrets(
  recipe: McpRecipe,
  secrets: McpSecretValues,
  name: string,
): void {
  const missingKeys = [
    ...recipe.envKeys
      .filter((key) => !secrets.env[key] || isPlaceholder(secrets.env[key]!))
      .map((key) => ({ slot: 'env', key })),
    ...recipe.headerKeys
      .filter(
        (key) =>
          !Object.entries(secrets.headers).some(
            ([stored, value]) =>
              stored.toLowerCase() === key.toLowerCase() &&
              value &&
              !isPlaceholder(value),
          ),
      )
      .map((key) => ({ slot: 'headers', key })),
  ];
  if (missingKeys.length)
    throw new OperationFailure(
      'mcp.missingSecrets',
      'Required MCP secrets are missing.',
      { name, missingKeys },
      1,
    );
}

function validateNames(names: string[]): void {
  for (const name of names)
    try {
      if (assertMcpName(name) !== name) throw new Error();
    } catch {
      throw new OperationFailure('usage.invalidArguments', 'Invalid MCP name.');
    }
}

export async function selectMcpLocations(
  selectors: string[],
  project: string,
  allowAbsent = false,
): Promise<Array<McpLocationEntry | { absent: true; selector: string }>> {
  if (!selectors.length)
    throw new OperationFailure(
      'usage.selectionRequired',
      'At least one MCP location is required.',
    );
  const locations = await readMcpLocations(project, [], ['project', 'global']);
  if (locations.issues.length)
    throw new OperationFailure(
      'execution.readFailed',
      'MCP locations could not be read completely.',
      { issues: locations.issues },
      1,
    );
  return [...new Set(selectors)].map((selector) => {
    let identity: unknown;
    try {
      identity = JSON.parse(
        Buffer.from(selector.slice(5), 'base64url').toString(),
      );
    } catch {
      throw new OperationFailure(
        'usage.invalidLocation',
        'Invalid MCP selector.',
      );
    }
    if (
      !selector.startsWith('mcp1-') ||
      !Array.isArray(identity) ||
      identity.length !== 6 ||
      identity.some((part) => typeof part !== 'string') ||
      identity[0] !== project ||
      !isMcpAgentId(identity[1]) ||
      !['project', 'global'].includes(identity[2]) ||
      !['owned', 'borrowed'].includes(identity[3]) ||
      !identity[4].startsWith('/') ||
      !identity[5]
    )
      throw new OperationFailure(
        'usage.invalidLocation',
        'The MCP selector belongs to a different project or is invalid.',
      );
    const matches = locations.entries.filter(
      (entry) => mcpSelector(entry, project) === selector,
    );
    if (matches.length > 1)
      throw new OperationFailure(
        'usage.ambiguousSelection',
        'The MCP selector matches multiple entries.',
      );
    if (!matches.length) {
      if (allowAbsent) return { absent: true as const, selector };
      throw new OperationFailure(
        'usage.selectionNotFound',
        'The selected MCP location no longer exists.',
        { selector },
      );
    }
    return matches[0]!;
  });
}

export async function executeMcpWrite(
  request: McpWriteRequest,
): Promise<OperationResult> {
  const { command, project, options, signal } = request;
  const names = ['mcp.rename', 'mcp.tag.rename'].includes(command)
    ? request.names
    : [...new Set(request.names)];
  const dryRun = options['dry-run'] === true;
  if (['mcp.create', 'mcp.import'].includes(command))
    return collectMcps(request);
  if (
    [
      'mcp.add',
      'mcp.update',
      'mcp.enable',
      'mcp.disable',
      'mcp.uninstall',
    ].includes(command)
  )
    return maintainMcpLocations(request);
  if (command !== 'mcp.tag.rename') validateNames(names);
  const collection = await readMcps();
  if (collection.issues.length)
    throw new OperationFailure(
      'execution.readFailed',
      'The MCP collection contains unreadable entries.',
      { issues: collection.issues },
      1,
    );
  const lookup = (name: string): CollectedMcp => {
    const item = collection.items.find((mcp) => mcp.name === name);
    if (!item)
      throw new OperationFailure(
        'usage.selectionNotFound',
        'The MCP is not collected.',
        { name },
      );
    return item;
  };
  const plans: PlannedWrite[] = [];
  if (command === 'mcp.tag.rename') {
    if (names.length !== 2)
      throw new OperationFailure(
        'usage.invalidArguments',
        'Two tag names are required.',
      );
    const [from, to] = names;
    normalizeNewTagName(to!);
    const changes = collection.items.flatMap((before) => {
      const tags = renameTagInList(before.tags, from!, to!);
      return tags ? [{ before, after: { ...before, tags } }] : [];
    });
    plans.push({
      item: {
        name: from,
        action: 'rename-tag',
        status: changes.length ? 'planned' : 'unchanged',
        reason: 'same-value',
        affectedNames: changes.map((change) => change.before.name),
      },
      execute: () => writeTagRenameBatch(changes, writeCollectedMcpRecord),
    });
  } else if (command === 'mcp.remove') {
    if (!names.length)
      throw new OperationFailure(
        'usage.selectionRequired',
        'Select at least one MCP.',
      );
    requireAuthorization(options.yes === true, dryRun, names);
    for (const name of names) {
      const present = collection.items.some((item) => item.name === name);
      const secrets = await readMcpSecrets(name);
      const item = {
        name,
        action: 'remove',
        status:
          present || !isDeepStrictEqual(secrets, emptySecrets())
            ? 'planned'
            : 'unchanged',
        reason: 'absent',
        requiredFlags: ['--yes'],
        stages: {
          recipe: present ? 'planned' : 'unchanged',
          secrets: 'planned',
        },
      };
      plans.push({
        item,
        execute: async () => {
          try {
            await deleteCollectedMcpFile(name);
            item.stages.recipe = present ? 'committed' : 'unchanged';
          } catch (error) {
            item.stages.recipe = 'failed';
            item.stages.secrets = 'not-run';
            throw error;
          }
          try {
            await deleteMcpSecrets(name);
            item.stages.secrets = isDeepStrictEqual(secrets, emptySecrets())
              ? 'unchanged'
              : 'committed';
          } catch (error) {
            item.stages.secrets = 'failed';
            throw error;
          }
        },
      });
    }
  } else if (command === 'mcp.rename') {
    if (names.length !== 2)
      throw new OperationFailure(
        'usage.invalidArguments',
        'The old and new MCP names are required.',
      );
    const before = lookup(names[0]!);
    const name = names[1]!;
    const secrets = await readMcpSecrets(before.name);
    let item: Record<string, unknown> = {
      name: before.name,
      newName: name,
      action: 'rename',
      status: 'planned',
    };
    if (before.name === name)
      item = { ...item, status: 'unchanged', reason: 'same-name' };
    else if (collection.items.some((entry) => entry.name === name))
      item = conflictItem(item, 'conflict.alreadyExists', { name });
    const stages = {
      recipe: item.status === 'unchanged' ? 'unchanged' : 'planned',
      secrets: item.status === 'unchanged' ? 'unchanged' : 'planned',
    };
    item.stages = stages;
    plans.push({
      item,
      execute: async () => {
        try {
          await writeCollectedMcpRecord({ ...before, name });
          stages.recipe = 'committed';
        } catch (error) {
          stages.recipe = 'failed';
          stages.secrets = 'not-run';
          throw error;
        }
        try {
          await writeMcpSecrets(name, secrets);
          await deleteMcpSecrets(before.name);
          stages.secrets = 'committed';
          await deleteCollectedMcpFile(before.name);
        } catch (error) {
          stages.secrets = 'failed';
          throw error;
        }
      },
    });
  } else {
    if (names.length !== 1)
      throw new OperationFailure(
        'usage.invalidArguments',
        'Exactly one MCP name is required.',
      );
    const before = lookup(names[0]!);
    const secrets = await readMcpSecrets(before.name);
    if (command === 'mcp.edit') {
      if (
        ![
          'recipe-input',
          'description',
          'tags',
          'add-tag',
          'remove-tag',
          'note',
        ].some((key) => options[key] !== undefined)
      )
        throw new OperationFailure(
          'usage.invalidArguments',
          'At least one field is required.',
        );
      const recipe = options['recipe-input']
        ? validateRecipe(await jsonInput(options['recipe-input'], project))
        : before.recipe;
      if (recipe.url && stripSecretUrl(recipe.url).secretUrl)
        throw new OperationFailure(
          'usage.invalidArguments',
          'Recipe URLs cannot contain credentials; use secret set --url.',
        );
      const next = {
        ...before,
        ...metadataPatch(before, options),
        recipe,
      } as CollectedMcp;
      const clearSecrets = Boolean(
        before.secretsResetPending ||
        !recipesSameEndpoint(before.recipe, next.recipe),
      );
      const stages = {
        recipe: 'planned',
        secrets: clearSecrets ? 'planned' : 'unchanged',
      };
      const item = {
        name: before.name,
        action: 'edit',
        status: isDeepStrictEqual(before, next) ? 'unchanged' : 'planned',
        reason: 'same-value',
        stages,
        clearSecretKeys: clearSecrets
          ? {
              env: Object.keys(secrets.env),
              headers: Object.keys(secrets.headers),
              url: Boolean(secrets.url),
            }
          : null,
      };
      if (item.status === 'unchanged') stages.recipe = 'unchanged';
      plans.push({
        item,
        execute: async () => {
          try {
            await writeCollectedMcpRecord({
              ...next,
              secretsResetPending: clearSecrets,
            });
            stages.recipe = 'committed';
          } catch (error) {
            stages.recipe = 'failed';
            stages.secrets = 'not-run';
            throw error;
          }
          if (clearSecrets) {
            try {
              await deleteMcpSecrets(before.name);
              stages.secrets = 'committed';
              await writeCollectedMcpRecord({
                ...next,
                secretsResetPending: false,
              });
            } catch (error) {
              stages.secrets = 'failed';
              throw error;
            }
          }
        },
      });
    } else if (['mcp.secret.set', 'mcp.secret.unset'].includes(command)) {
      if (before.secretsResetPending)
        throw new OperationFailure(
          'mcp.missingSecrets',
          'Complete the endpoint credential reset by retrying import or edit first.',
          { name: before.name, stage: 'secrets' },
          1,
        );
      const slots = ['env', 'header', 'url'].filter(
        (key) => options[key] !== undefined,
      );
      if (slots.length !== 1)
        throw new OperationFailure(
          'usage.invalidArguments',
          'Choose exactly one secret slot.',
        );
      const slot = slots[0] === 'header' ? 'headers' : slots[0]!;
      const key = slot === 'url' ? 'url' : String(options[slots[0]!]);
      if (
        (slot === 'env' && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) ||
        (slot === 'headers' && !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key))
      )
        throw new OperationFailure(
          'usage.invalidArguments',
          'Invalid secret key.',
        );
      if (slot === 'url' && before.recipe.transport === 'stdio')
        throw new OperationFailure(
          'usage.unsupportedCapability',
          'stdio has no secret URL.',
        );
      const next = structuredClone(secrets);
      let value: string | undefined;
      if (command.endsWith('.set')) {
        if (Boolean(options['value-stdin']) === Boolean(options['value-file']))
          throw new OperationFailure(
            'usage.invalidArguments',
            'Choose --value-stdin or --value-file.',
          );
        value = (
          await inputText(
            options['value-stdin'] ? '-' : String(options['value-file']),
            project,
          )
        ).replace(/\r?\n$/, '');
        if (!value)
          throw new OperationFailure(
            'usage.invalidArguments',
            'An empty secret value is not accepted.',
          );
        if (
          slot === 'url' &&
          !recipesSameEndpoint(before.recipe, { ...before.recipe, url: value })
        )
          throw new OperationFailure(
            'usage.invalidArguments',
            'The secret URL must identify the collected endpoint.',
          );
      } else requireAuthorization(options.yes === true, dryRun, names);
      if (slot === 'url' && value !== undefined) {
        try {
          if (!['http:', 'https:'].includes(new URL(value).protocol))
            throw new Error();
        } catch {
          throw new OperationFailure(
            'usage.invalidArguments',
            'A valid HTTP URL is required.',
          );
        }
      }
      if (slot === 'url') {
        if (value !== undefined) next.url = value;
        else delete next.url;
      } else {
        const map = next[slot as 'env' | 'headers'];
        const stored = Object.keys(map).find((name) =>
          slot === 'headers'
            ? name.toLowerCase() === key.toLowerCase()
            : name === key,
        );
        if (stored) delete map[stored];
        if (value !== undefined) map[key] = value;
      }
      const unchanged = isDeepStrictEqual(secrets, next);
      const stages = {
        recipe: 'unchanged',
        secrets: unchanged ? 'unchanged' : 'planned',
      };
      plans.push({
        item: {
          name: before.name,
          slot,
          key,
          action: command.endsWith('.set') ? 'set-secret' : 'unset-secret',
          status: unchanged ? 'unchanged' : 'planned',
          reason: 'same-value',
          configured: value !== undefined,
          stages,
        },
        execute: async () => {
          try {
            await writeMcpSecrets(before.name, next);
            stages.secrets = 'committed';
          } catch (error) {
            stages.secrets = 'failed';
            throw error;
          }
        },
      });
    } else
      throw new OperationFailure(
        'usage.unknownCommand',
        'Unknown MCP operation.',
      );
  }
  return executeWrites(plans, dryRun, true, command, signal);
}

async function collectMcps(request: McpWriteRequest): Promise<OperationResult> {
  const { command, options, project, signal } = request;
  const names = [...new Set(request.names)];
  const incoming: Array<{ mcp: CollectedMcp; secrets: McpSecretValues }> = [];
  if (command === 'mcp.create') {
    if (names.length !== 1)
      throw new OperationFailure(
        'usage.invalidArguments',
        'One MCP name is required.',
      );
    validateNames(names);
    const data = object(await jsonInput(options.input, project), [
      'recipe',
      'description',
      'tags',
      'note',
      'secrets',
    ]);
    for (const key of ['description', 'note'])
      if (data[key] !== undefined && typeof data[key] !== 'string')
        throw new OperationFailure(
          'usage.invalidArguments',
          'Metadata values must be strings.',
        );
    if (
      data.tags !== undefined &&
      (!Array.isArray(data.tags) ||
        data.tags.some((tag) => typeof tag !== 'string'))
    )
      throw new OperationFailure(
        'usage.invalidArguments',
        'Tags must be strings.',
      );
    const recipe = validateRecipe(data.recipe);
    const secrets = validateSecrets(data.secrets);
    if (recipe.url) {
      const stripped = stripSecretUrl(recipe.url);
      recipe.url = stripped.recipeUrl;
      if (stripped.secretUrl) secrets.url = stripped.secretUrl;
    }
    incoming.push({
      mcp: {
        name: names[0]!,
        description: (data.description ?? '') as string,
        note: (data.note ?? '') as string,
        tags: (data.tags ?? []) as string[],
        source: { type: 'create' },
        recipe,
      },
      secrets,
    });
  } else {
    if (
      names.length ||
      Boolean(options.input) ===
        Boolean((options.location as string[] | undefined)?.length)
    )
      throw new OperationFailure(
        'usage.invalidArguments',
        'Choose --input or --location for import.',
      );
    if (options.input) {
      const parsed = parseMcpJsonSnippet(
        await inputText(String(options.input), project),
      );
      if (!parsed.ok)
        throw new OperationFailure(
          'usage.invalidArguments',
          'The MCP JSON snippet could not be parsed.',
        );
      if (
        options.name &&
        (parsed.entries.length !== 1 || !parsed.entries[0]!.unnamed)
      )
        throw new OperationFailure(
          'usage.invalidArguments',
          '--name is only valid for an unnamed single entry.',
        );
      for (const entry of parsed.entries) {
        const name = entry.unnamed ? String(options.name ?? '') : entry.name;
        validateNames([name]);
        incoming.push({
          mcp: {
            name,
            description: '',
            note: '',
            tags: [],
            source: { type: 'create' },
            recipe: entry.recipe,
          },
          secrets: entry.secrets,
        });
      }
    } else {
      if (options.name)
        throw new OperationFailure(
          'usage.invalidArguments',
          '--name cannot be combined with location import.',
        );
      for (const row of await selectMcpLocations(
        options.location as string[],
        project,
      )) {
        if ('absent' in row) continue;
        incoming.push({
          mcp: {
            name: assertMcpName(row.nativeKey),
            description: '',
            tags: [],
            note: '',
            recipe: row.recipe,
            source: {
              type: row.agent,
              agent: row.agent,
              scope: row.scope,
              nativeKey: row.nativeKey,
              path: row.filePath,
            },
          },
          secrets: row.secrets,
        });
      }
    }
  }
  return collectMcpRecords(incoming, options, command, signal);
}

export async function collectMcpRecords(
  incoming: Array<{ mcp: CollectedMcp; secrets: McpSecretValues }>,
  options: Record<string, unknown>,
  command: string,
  signal: AbortSignal,
): Promise<OperationResult> {
  if (new Set(incoming.map((entry) => entry.mcp.name)).size !== incoming.length)
    throw new OperationFailure(
      'usage.ambiguousSelection',
      'Duplicate names in the MCP import.',
    );
  const collection = await readMcps();
  if (collection.issues.length)
    throw new OperationFailure(
      'execution.readFailed',
      'The MCP collection contains unreadable entries.',
      { issues: collection.issues },
      1,
    );
  const plans: PlannedWrite[] = [];
  for (const { mcp, secrets } of incoming) {
    registerSecrets(secrets);
    const current = collection.items.find((entry) => entry.name === mcp.name);
    const sameEndpoint = collection.items.find((entry) =>
      recipesSameEndpoint(entry.recipe, mcp.recipe),
    );
    const previousSecrets = current
      ? await readMcpSecrets(current.name)
      : emptySecrets();
    let nextSecrets = secrets;
    let recipeChange = true;
    let item: Record<string, unknown> = {
      name: mcp.name,
      action: command.endsWith('create') ? 'create' : 'import',
      status: 'planned',
      stages: { recipe: 'planned', secrets: 'planned' },
      secretKeys: {
        env: Object.keys(secrets.env),
        headers: Object.keys(secrets.headers),
        url: Boolean(secrets.url),
      },
      removedSecretKeys:
        current && !recipesSameEndpoint(current.recipe, mcp.recipe)
          ? {
              env: Object.keys(previousSecrets.env),
              headers: Object.keys(previousSecrets.headers),
              url: Boolean(previousSecrets.url),
            }
          : null,
    };
    if (current) {
      if (command === 'mcp.create') {
        item =
          isDeepStrictEqual(
            {
              recipe: current.recipe,
              description: current.description,
              tags: current.tags,
              note: current.note,
            },
            {
              recipe: mcp.recipe,
              description: mcp.description,
              tags: mcp.tags,
              note: mcp.note,
            },
          ) && isDeepStrictEqual(previousSecrets, secrets)
            ? { ...item, status: 'unchanged', reason: 'same-input' }
            : conflictItem(item, 'conflict.alreadyExists', { name: mcp.name });
      } else if (recipesSameEndpoint(current.recipe, mcp.recipe)) {
        recipeChange = false;
        nextSecrets = current.secretsResetPending
          ? secrets
          : fillMissing(previousSecrets, secrets);
        item.reason = 'secrets-completed';
        if (
          !current.secretsResetPending &&
          isDeepStrictEqual(nextSecrets, previousSecrets)
        )
          item = { ...item, status: 'unchanged', reason: 'same-source' };
      } else if (!options.replace)
        item = conflictItem(item, 'conflict.sameName', {
          name: mcp.name,
          existing: {
            transport: current.recipe.transport,
            url: current.recipe.url,
          },
          incoming: { transport: mcp.recipe.transport, url: mcp.recipe.url },
          requiredFlags: ['--replace'],
        });
    } else if (sameEndpoint && command !== 'mcp.create')
      item = {
        ...item,
        status: 'unchanged',
        reason: 'collected-as',
        collectedName: sameEndpoint.name,
      };
    const stages = item.stages as Record<string, string>;
    const resetting = Boolean(
      current &&
      (current.secretsResetPending ||
        !recipesSameEndpoint(current.recipe, mcp.recipe)),
    );
    if (item.status === 'unchanged') {
      stages.recipe = 'unchanged';
      stages.secrets = 'unchanged';
    } else if (!recipeChange) stages.recipe = 'unchanged';
    plans.push({
      item,
      execute: async () => {
        try {
          if (recipeChange) {
            await writeCollectedMcpRecord({
              ...mcp,
              secretsResetPending: resetting,
            });
            stages.recipe = 'committed';
          } else stages.recipe = 'unchanged';
        } catch (error) {
          stages.recipe = 'failed';
          stages.secrets = 'not-run';
          throw error;
        }
        try {
          if (resetting || !isDeepStrictEqual(previousSecrets, nextSecrets)) {
            await writeMcpSecrets(current?.name ?? mcp.name, nextSecrets);
            stages.secrets = 'committed';
          } else stages.secrets = 'unchanged';
          if (resetting)
            await writeCollectedMcpRecord({
              ...(recipeChange ? mcp : current!),
              secretsResetPending: false,
            });
        } catch (error) {
          stages.secrets = 'failed';
          item.restored = false;
          throw error;
        }
      },
    });
  }
  return executeWrites(
    plans,
    options['dry-run'] === true,
    true,
    command,
    signal,
  );
}

async function maintainMcpLocations(
  request: McpWriteRequest,
): Promise<OperationResult> {
  const { command, options, project, signal } = request;
  const names = [...new Set(request.names)];
  const ctx = { cwd: project, home: homedir() };
  const plans: PlannedWrite[] = [];
  if (command === 'mcp.add') {
    if (
      !names.length ||
      !(options.agent as string[] | undefined)?.length ||
      !['project', 'global'].includes(String(options.scope))
    )
      throw new OperationFailure(
        'usage.invalidArguments',
        'MCP add requires names, --agent and --scope.',
      );
    const targets = [...new Set(options.agent as string[])];
    const scope = options.scope as 'project' | 'global';
    plans.push(
      ...(await planMcpAdds(
        names,
        targets.map((agent) => ({ agent, scope })),
        ctx,
        options.replace === true,
      )),
    );
  } else {
    const selectors =
      command === 'mcp.update' ? ((options.location as string[]) ?? []) : names;
    if (command === 'mcp.update' && names.length !== 1)
      throw new OperationFailure(
        'usage.invalidArguments',
        'MCP update requires one collection name.',
      );
    if (command === 'mcp.uninstall')
      requireAuthorization(
        options.yes === true,
        options['dry-run'] === true,
        names,
      );
    const entries = await selectMcpLocations(
      selectors,
      project,
      command === 'mcp.uninstall',
    );
    const collection = command === 'mcp.update' ? await readMcps() : undefined;
    if (collection?.issues.length)
      throw new OperationFailure(
        'execution.readFailed',
        'The MCP collection contains unreadable entries.',
        { issues: collection.issues },
        1,
      );
    const collected = collection?.items.find(
      (entry) => entry.name === names[0],
    );
    if (command === 'mcp.update' && !collected)
      throw new OperationFailure(
        'usage.selectionNotFound',
        'The MCP is not collected.',
        { name: names[0] },
      );
    if (collected?.secretsResetPending)
      throw new OperationFailure(
        'mcp.missingSecrets',
        'Complete the endpoint credential reset before updating a location.',
        { name: collected.name, stage: 'secrets' },
        1,
      );
    const overlay = collected
      ? await readMcpSecrets(collected.name)
      : emptySecrets();
    if (collected) checkSecrets(collected.recipe, overlay, collected.name);
    for (const entry of entries) {
      if ('absent' in entry) {
        plans.push({
          item: {
            selector: entry.selector,
            action: 'uninstall',
            status: 'unchanged',
            reason: 'absent',
          },
          execute: async () => {},
        });
        continue;
      }
      const info = publicLocation(entry, project);
      const switchable = ['mcp.enable', 'mcp.disable'].includes(command);
      if (!(switchable ? info.canEnable : info.canUpdate))
        throw new OperationFailure(
          'mcp.borrowedNotMutable',
          'The selected MCP does not support this operation.',
          { selector: info.selector },
        );
      let item: Record<string, unknown> = {
        ...info,
        action: command.split('.').at(-1),
        status: 'planned',
      };
      if (switchable) {
        const enabled = command === 'mcp.enable';
        if (entry.enabled === enabled)
          item = { ...item, status: 'unchanged', reason: 'same-state' };
        if (entry.agent === 'claude') {
          const all = await readMcpLocations(
            project,
            ['claude'],
            ['project', 'global'],
          );
          const kind = entry.filePath.endsWith('/.mcp.json');
          item.affectedLocations = all.entries
            .filter(
              (row) =>
                row.nativeKey === entry.nativeKey &&
                row.filePath.endsWith('/.mcp.json') === kind,
            )
            .map((row) => mcpSelector(row, project));
          item.writeFiles = [resolve(ctx.home, '.claude.json')];
        } else {
          item.affectedLocations = [info.selector];
          item.writeFiles = [entry.filePath];
        }
        plans.push({
          item,
          execute: async () => {
            await setLocationEnabled(entry, ctx, enabled);
            item.enabled = enabled;
          },
        });
      } else if (command === 'mcp.uninstall') {
        item.requiredFlags = ['--yes'];
        plans.push({ item, execute: () => writeMcpLocation(entry, ctx) });
      } else {
        if (
          isDeepStrictEqual(entry.recipe, collected!.recipe) &&
          isDeepStrictEqual(entry.secrets, overlay)
        )
          item = { ...item, status: 'unchanged', reason: 'same-value' };
        else if (!options.replace)
          item = conflictItem(item, 'conflict.targetExists', {
            selector: info.selector,
            requiredFlags: ['--replace'],
          });
        plans.push({
          item,
          execute: () =>
            writeMcpLocation(entry, ctx, collected!.recipe, overlay),
        });
      }
    }
  }
  return executeWrites(
    plans,
    options['dry-run'] === true,
    false,
    command,
    signal,
  );
}

export async function planMcpAdds(
  names: string[],
  targets: AddMcpTarget[],
  ctx: McpScanContext,
  replace = false,
): Promise<PlannedWrite[]> {
  validateNames(names);
  const project = ctx.cwd;
  const collection = await readMcps();
  const plans: PlannedWrite[] = [];
  const targetKeys = new Set<string>();
  const locations = await readMcpLocations(
    project,
    [...new Set(targets.map((target) => target.agent))],
    [...new Set(targets.map((target) => target.scope))],
  );
  if (locations.issues.length || collection.issues.length)
    throw new OperationFailure(
      'execution.readFailed',
      'The MCP configuration could not be read completely.',
      {},
      1,
    );
  const plannedEndpoints = new Set<string>();
  for (const name of names) {
    const mcp = collection.items.find((entry) => entry.name === name);
    if (!mcp)
      throw new OperationFailure(
        'usage.selectionNotFound',
        'The MCP is not collected.',
        { name },
      );
    const secrets = await readMcpSecrets(name);
    if (mcp.secretsResetPending)
      throw new OperationFailure(
        'mcp.missingSecrets',
        'The endpoint credential reset must be completed before writing this MCP.',
        { name, stage: 'secrets' },
        1,
      );
    checkSecrets(mcp.recipe, secrets, name);
    const identity = recipeEndpoint(mcp.recipe);
    if (plannedEndpoints.has(identity))
      throw new OperationFailure(
        'usage.ambiguousSelection',
        'Multiple selected MCPs have the same endpoint.',
      );
    plannedEndpoints.add(identity);
    for (const { agent, scope } of targets) {
      if (!isMcpAgentId(agent))
        throw new OperationFailure(
          'usage.unsupportedCapability',
          'Unknown MCP Agent.',
          { agent },
        );
      if (!(await agentMcpWritable(agent, scope, ctx)))
        throw new OperationFailure(
          'mcp.notWritable',
          'The MCP target is not writable.',
          { agent, scope },
        );
      const entries = locations.entries.filter(
        (entry) => entry.agent === agent && entry.scope === scope,
      );
      const byEndpoint = entries.filter((entry) =>
        recipesSameEndpoint(entry.recipe, mcp.recipe),
      );
      const byName = entries.filter((entry) => entry.nativeKey === name);
      if (
        byEndpoint.length > 1 ||
        byName.length > 1 ||
        (byName.length && byEndpoint.some((entry) => entry.nativeKey !== name))
      )
        throw new OperationFailure(
          'usage.ambiguousSelection',
          'The target MCP is ambiguous.',
          {
            candidates: [...byName, ...byEndpoint].map((entry) =>
              publicLocation(entry, project),
            ),
          },
        );
      const file = ownedFilePath(agent, scope, ctx)!;
      const targetKey = JSON.stringify([
        file,
        agent === 'claude' ? scope : null,
        name,
      ]);
      if (targetKeys.has(targetKey)) continue;
      targetKeys.add(targetKey);
      let item: Record<string, unknown> = {
        name,
        agent,
        scope,
        file,
        nativeKey: name,
        action: 'add',
        status: 'planned',
        ownership: 'owned',
        enabled: true,
      };
      if (byEndpoint.length)
        item = {
          ...item,
          ...publicLocation(byEndpoint[0]!, project),
          status: 'unchanged',
          reason: 'already-present',
        };
      else if (byName.length) {
        if (byName[0]!.ownership !== 'owned')
          throw new OperationFailure(
            'mcp.borrowedNotMutable',
            'The conflicting target is borrowed.',
          );
        if (!replace)
          item = conflictItem(item, 'conflict.sameName', {
            existing: publicLocation(byName[0]!, project),
            requiredFlags: ['--replace'],
          });
        else {
          item.action = 'replace';
          item.file = byName[0]!.filePath;
          item.enabled = byName[0]!.enabled;
        }
      }
      plans.push({
        item,
        execute: async () => {
          if (byName[0])
            await writeMcpLocation(byName[0], ctx, mcp.recipe, secrets);
          else
            await writeOwnedServer(
              agent,
              scope,
              ctx,
              name,
              mcp.recipe,
              secrets,
            );
          const selected = (
            await readMcpLocations(project, [agent], [scope])
          ).entries.find(
            (entry) => entry.nativeKey === name && entry.ownership === 'owned',
          );
          if (selected)
            Object.assign(item, {
              selector: mcpSelector(selected, project),
              enabled: selected.enabled,
              ownership: selected.ownership,
            });
        },
      });
    }
  }
  return plans;
}
