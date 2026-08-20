import { inferTransport, stripSecretUrl } from './identity.js';
import { emptySecrets } from './secrets.js';
import type { McpRecipe, McpSecretValues, McpTransport } from './types.js';

const SECRET_KEY = /token|key|secret|password|auth|credential|authorization/i;

export function isSecretKey(key: string): boolean {
  return SECRET_KEY.test(key);
}

export function isPlaceholder(value: string): boolean {
  const trimmed = value.trim();
  if (/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(trimmed)) return true;
  if (/^<[A-Za-z][A-Za-z0-9._-]*>$/.test(trimmed)) return true;
  if (/\$\{[A-Za-z_][A-Za-z0-9_]*\}/.test(trimmed)) return true;
  if (/<[A-Za-z][A-Za-z0-9._-]*>/.test(trimmed)) return true;
  return false;
}

export function extractFromServerObject(raw: Record<string, unknown>): {
  recipe: McpRecipe;
  secrets: McpSecretValues;
  enabled: boolean;
} {
  const transport = inferTransport(raw);
  const envRecord = recordOfStrings(raw.env ?? raw.environment);
  const headerRecord = recordOfStrings(raw.headers);
  const envKeys = Object.keys(envRecord);
  const headerKeys = Object.keys(headerRecord);
  const secrets = emptySecrets();
  for (const [key, value] of Object.entries(envRecord)) {
    if (!isPlaceholder(value) && (isSecretKey(key) || looksSecretValue(value))) {
      secrets.env[key] = value;
    }
  }
  for (const [key, value] of Object.entries(headerRecord)) {
    if (!isPlaceholder(value) && (isSecretKey(key) || looksSecretValue(value))) {
      secrets.headers[key] = value;
    }
  }

  let url: string | undefined;
  if (typeof raw.url === 'string' && raw.url.trim()) {
    const stripped = stripSecretUrl(raw.url);
    url = stripped.recipeUrl;
    if (stripped.secretUrl) secrets.url = stripped.secretUrl;
  }

  const commandParts = commandAndArgs(raw, transport);
  const enabled = raw.enabled === false || raw.disabled === true ? false : true;

  return {
    recipe: {
      transport,
      ...(commandParts.command ? { command: commandParts.command } : {}),
      ...(commandParts.args.length ? { args: commandParts.args } : {}),
      ...(typeof raw.cwd === 'string' ? { cwd: raw.cwd } : {}),
      ...(url ? { url } : {}),
      envKeys,
      headerKeys,
    },
    secrets,
    enabled,
  };
}

export function projectServerObject(
  recipe: McpRecipe,
  secrets: McpSecretValues,
  style: 'json' | 'opencode'
): Record<string, unknown> {
  const env = projectMap(recipe.envKeys, secrets.env);
  const headers = projectMap(recipe.headerKeys, secrets.headers);
  const url = secrets.url ?? recipe.url;

  if (style === 'opencode') {
    if (recipe.transport === 'stdio') {
      const command = [recipe.command, ...(recipe.args ?? [])].filter(
        (part): part is string => Boolean(part)
      );
      return {
        type: 'local',
        command,
        ...(recipe.cwd ? { cwd: recipe.cwd } : {}),
        ...(Object.keys(env).length ? { environment: env } : {}),
        enabled: true,
      };
    }
    return {
      type: 'remote',
      url,
      ...(Object.keys(headers).length ? { headers } : {}),
      enabled: true,
    };
  }

  if (recipe.transport === 'stdio') {
    return {
      command: recipe.command,
      ...(recipe.args?.length ? { args: recipe.args } : {}),
      ...(recipe.cwd ? { cwd: recipe.cwd } : {}),
      ...(Object.keys(env).length ? { env } : {}),
    };
  }
  return {
    type: recipe.transport === 'sse' ? 'sse' : 'http',
    url,
    ...(Object.keys(headers).length ? { headers } : {}),
    ...(Object.keys(env).length ? { env } : {}),
  };
}

export function projectTomlServer(
  recipe: McpRecipe,
  secrets: McpSecretValues
): Record<string, unknown> {
  const env = projectMap(recipe.envKeys, secrets.env);
  const headers = projectMap(recipe.headerKeys, secrets.headers);
  const url = secrets.url ?? recipe.url;
  const out: Record<string, unknown> = {};
  if (recipe.transport === 'stdio') {
    if (recipe.command) out.command = recipe.command;
    if (recipe.args?.length) out.args = recipe.args;
    if (recipe.cwd) out.cwd = recipe.cwd;
    if (Object.keys(env).length) out.env = env;
  } else {
    if (url) out.url = url;
    if (Object.keys(headers).length) out.headers = headers;
    if (Object.keys(env).length) out.env = env;
  }
  return out;
}

export function projectMap(keys: string[], values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    if (values[key]) out[key] = values[key];
    else out[key] = `\${${key}}`;
  }
  return out;
}

export function fillMissingSecrets(
  existing: McpSecretValues,
  overlay: McpSecretValues
): McpSecretValues {
  const env = { ...existing.env };
  for (const [key, value] of Object.entries(overlay.env)) {
    if (!env[key]) env[key] = value;
  }
  const headers = { ...existing.headers };
  for (const [key, value] of Object.entries(overlay.headers)) {
    if (!headers[key]) headers[key] = value;
  }
  return {
    env,
    headers,
    ...(existing.url || overlay.url ? { url: existing.url ?? overlay.url } : {}),
  };
}

function recordOfStrings(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined || value === null) continue;
    out[key] = String(value);
  }
  return out;
}

function commandAndArgs(
  raw: Record<string, unknown>,
  transport: McpTransport
): { command?: string; args: string[] } {
  if (transport !== 'stdio') return { args: [] };
  if (Array.isArray(raw.command)) {
    const parts = raw.command.map(String).filter(Boolean);
    return parts[0] ? { command: parts[0], args: parts.slice(1) } : { args: [] };
  }
  if (typeof raw.command === 'string') {
    return {
      command: raw.command,
      args: Array.isArray(raw.args) ? raw.args.map(String) : [],
    };
  }
  return { args: [] };
}

function looksSecretValue(value: string): boolean {
  if (isPlaceholder(value)) return false;
  if (/^bearer\s+/i.test(value)) return true;
  return value.length >= 24 && /^[A-Za-z0-9_\-.=+/]+$/.test(value);
}
