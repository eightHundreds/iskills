import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { collectionPaths } from '../core.js';
import { readUserConfig, writeUserConfig } from '../user-config.js';
import { assertMcpName } from './identity.js';
import { pathExists, readJsonObject, writeJsonObject } from './io.js';
import type { HttpProbeStatus, McpRecipe, McpSecretValues } from './types.js';

/**
 * Overlay fill for recipe secret keys (static token / env).
 * `none` means the recipe records no header/env keys.
 */
export type McpSecretState = 'none' | 'signed-out' | 'signed-in';

/** @deprecated Use {@link mcpSecretState}; kept as the same union for protocol login too. */
export type McpLoginState = McpSecretState;

export function mcpSecretState(recipe: McpRecipe, secrets: McpSecretValues): McpSecretState {
  if (!recipe.headerKeys.length && !recipe.envKeys.length) return 'none';
  const headersOk = recipe.headerKeys.every((key) => Boolean(secrets.headers[key]?.trim()));
  const envOk = recipe.envKeys.every((key) => Boolean(secrets.env[key]?.trim()));
  return headersOk && envOk ? 'signed-in' : 'signed-out';
}

/** Static keys in the recipe — not HTTP 401 / OAuth discovery. */
export function mcpLoginState(recipe: McpRecipe, secrets: McpSecretValues): McpLoginState {
  return mcpSecretState(recipe, secrets);
}

/**
 * Protocol login (OAuth / Bearer challenge). Only HTTP/SSE.
 * Discovered by probing: 401/403 → unsigned; reachable with Authorization → signed-in.
 */
export function mcpProtocolLoginState(
  transport: McpRecipe['transport'],
  secrets: McpSecretValues,
  probe?: HttpProbeStatus
): McpLoginState {
  if (transport !== 'http' && transport !== 'sse') return 'none';
  if (probe === 'needs-auth') return 'signed-out';
  if (probe === 'reachable' && Boolean(secrets.headers.Authorization?.trim())) return 'signed-in';
  return 'none';
}

const SECRETS_REL = '.local/mcp-secrets.json';
const GITIGNORE_KEEP = '!.local/mcp-secrets.json';

export function mcpSecretsPath(): string {
  return join(collectionPaths().root, SECRETS_REL);
}

export async function readMcpSecretsInGit(): Promise<boolean> {
  const config = await readUserConfig();
  return config.mcpSecretsInGit === true;
}

export async function setMcpSecretsInGit(enabled: boolean): Promise<void> {
  const current = await readUserConfig();
  await writeUserConfig({ ...current, mcpSecretsInGit: enabled });
  await syncSecretsGitignore(enabled);
}

export async function readAllMcpSecrets(): Promise<Record<string, McpSecretValues>> {
  const raw = await readJsonObject(mcpSecretsPath());
  const out: Record<string, McpSecretValues> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (!value || typeof value !== 'object') continue;
    out[name] = normalizeSecrets(value as Record<string, unknown>);
  }
  return out;
}

export async function readMcpSecrets(name: string): Promise<McpSecretValues> {
  const all = await readAllMcpSecrets();
  return all[assertMcpName(name)] ?? emptySecrets();
}

export function emptySecrets(): McpSecretValues {
  return { env: {}, headers: {} };
}

export async function writeMcpSecrets(name: string, secrets: McpSecretValues): Promise<void> {
  const key = assertMcpName(name);
  const all = await readAllMcpSecrets();
  if (isEmptySecrets(secrets)) delete all[key];
  else all[key] = secrets;
  await writeJsonObject(mcpSecretsPath(), all);
  if (await readMcpSecretsInGit()) forceAddSecretsFile();
}

export async function deleteMcpSecrets(name: string): Promise<void> {
  const key = assertMcpName(name);
  const all = await readAllMcpSecrets();
  if (!(key in all)) return;
  delete all[key];
  await writeJsonObject(mcpSecretsPath(), all);
  if (await readMcpSecretsInGit()) forceAddSecretsFile();
}

export async function moveMcpSecrets(from: string, to: string): Promise<void> {
  const secrets = await readMcpSecrets(from);
  await writeMcpSecrets(to, secrets);
  if (from !== to) await deleteMcpSecrets(from);
}

export function isEmptySecrets(secrets: McpSecretValues): boolean {
  return (
    Object.keys(secrets.env).length === 0 &&
    Object.keys(secrets.headers).length === 0 &&
    !secrets.url
  );
}

export function mergeSecrets(base: McpSecretValues, extra: McpSecretValues): McpSecretValues {
  return {
    env: { ...base.env, ...extra.env },
    headers: { ...base.headers, ...extra.headers },
    ...(extra.url || base.url ? { url: extra.url ?? base.url } : {}),
  };
}

function normalizeSecrets(raw: Record<string, unknown>): McpSecretValues {
  const env =
    raw.env && typeof raw.env === 'object' && !Array.isArray(raw.env)
      ? Object.fromEntries(Object.entries(raw.env).map(([k, v]) => [k, String(v)]))
      : {};
  const headers =
    raw.headers && typeof raw.headers === 'object' && !Array.isArray(raw.headers)
      ? Object.fromEntries(Object.entries(raw.headers).map(([k, v]) => [k, String(v)]))
      : {};
  return {
    env,
    headers,
    ...(typeof raw.url === 'string' ? { url: raw.url } : {}),
  };
}

async function syncSecretsGitignore(enabled: boolean): Promise<void> {
  const gitignore = join(collectionPaths().root, '.gitignore');
  let text = '';
  if (await pathExists(gitignore)) text = await readFile(gitignore, 'utf8');
  const lines = text.split(/\r?\n/).filter((line) => line !== GITIGNORE_KEEP);
  if (enabled) {
    if (!lines.includes('.local/')) lines.push('.local/');
    lines.push(GITIGNORE_KEEP);
  }
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  await writeFile(gitignore, `${lines.join('\n')}\n`, 'utf8');
  if (!enabled) untrackSecretsFile();
}

function forceAddSecretsFile(): void {
  const root = collectionPaths().root;
  if (!existsSync(join(root, '.git'))) return;
  try {
    execFileSync('git', ['-C', root, 'add', '-f', '--', SECRETS_REL], { stdio: 'ignore' });
  } catch {
    /* not a git repo or add failed */
  }
}

function untrackSecretsFile(): void {
  const root = collectionPaths().root;
  if (!existsSync(join(root, '.git'))) return;
  try {
    execFileSync('git', ['-C', root, 'rm', '--cached', '-f', '--', SECRETS_REL], {
      stdio: 'ignore',
    });
  } catch {
    /* not tracked */
  }
}
