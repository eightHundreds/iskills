import { DomainError } from '../errors.js';
import type { CollectedMcp, McpCollectionMatch, McpRecipe, McpTransport } from './types.js';

export function assertMcpName(name: string): string {
  const trimmed = name.trim();
  if (
    !trimmed ||
    trimmed === '.' ||
    trimmed === '..' ||
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(trimmed)
  ) {
    throw new DomainError('mcp.unsafeName', { name });
  }
  return trimmed;
}

export function recipeEndpoint(recipe: McpRecipe): string {
  if (recipe.transport === 'stdio') {
    const command = normalizeStdioCommand(recipe.command ?? '');
    const args = normalizeStdioArgs(recipe.command ?? '', recipe.args ?? []);
    return `stdio:${command} ${args.join(' ')}`.trim();
  }
  return `${recipe.transport}:${normalizeRemoteUrl(recipe.url ?? '')}`;
}

export function recipesSameEndpoint(left: McpRecipe, right: McpRecipe): boolean {
  if (left.transport !== right.transport) return false;
  return recipeEndpoint(left) === recipeEndpoint(right);
}

export function classifyMcpMatch(
  current: Pick<CollectedMcp, 'name' | 'recipe'>,
  incoming: Pick<CollectedMcp, 'name' | 'recipe'>
): McpCollectionMatch {
  const sameEndpoint = recipesSameEndpoint(current.recipe, incoming.recipe);
  const sameName = current.name.toLowerCase() === incoming.name.toLowerCase();
  if (sameName && sameEndpoint) return 'same-source';
  if (sameName) return 'conflicting-source';
  if (sameEndpoint) return 'collected-as';
  return 'conflicting-source';
}

export function findCollectedByEndpoint(
  collection: CollectedMcp[],
  recipe: McpRecipe
): CollectedMcp | undefined {
  return collection.find((item) => recipesSameEndpoint(item.recipe, recipe));
}

export function findCollectedByName(
  collection: CollectedMcp[],
  name: string
): CollectedMcp | undefined {
  const key = name.toLowerCase();
  return collection.find((item) => item.name.toLowerCase() === key);
}

export function inferTransport(raw: Record<string, unknown>): McpTransport {
  const type = typeof raw.type === 'string' ? raw.type.toLowerCase() : '';
  if (type === 'sse') return 'sse';
  if (type === 'http' || type === 'streamable-http' || type === 'remote') return 'http';
  if (type === 'stdio' || type === 'local') return 'stdio';
  if (typeof raw.url === 'string' && raw.url.trim()) {
    return type === 'sse' ? 'sse' : 'http';
  }
  return 'stdio';
}

export function normalizeRemoteUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    if (
      (parsed.protocol === 'http:' && parsed.port === '80') ||
      (parsed.protocol === 'https:' && parsed.port === '443')
    ) {
      parsed.port = '';
    }
    parsed.hostname = parsed.hostname.toLowerCase();
    if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    let href = parsed.toString();
    if (href.endsWith('/') && parsed.pathname === '/') href = href.slice(0, -1);
    return href;
  } catch {
    return trimmed.replace(/[?#].*$/, '');
  }
}

export function stripSecretUrl(url: string): { recipeUrl: string; secretUrl?: string } {
  const trimmed = url.trim();
  if (!trimmed) return { recipeUrl: '' };
  try {
    const parsed = new URL(trimmed);
    const hasSecret = Boolean(parsed.username || parsed.password || parsed.search);
    const recipeUrl = normalizeRemoteUrl(trimmed);
    return hasSecret ? { recipeUrl, secretUrl: trimmed } : { recipeUrl };
  } catch {
    return { recipeUrl: trimmed };
  }
}

function normalizeStdioCommand(command: string): string {
  return command.trim();
}

function normalizeStdioArgs(command: string, args: string[]): string[] {
  const launchers = new Set(['npx', 'pnpm', 'bunx', 'yarn', 'dlx']);
  const base = command.trim().split(/[/\\]/).pop()?.toLowerCase() ?? '';
  const isLauncher = launchers.has(base) || base === 'pnpx';
  const out: string[] = [];
  for (const raw of args) {
    const arg = raw.trim();
    if (!arg) continue;
    if (isLauncher && (arg === '-y' || arg === '--yes')) continue;
    out.push(stripArgSecrets(arg));
  }
  return out;
}

function stripArgSecrets(arg: string): string {
  if (/^https?:\/\//i.test(arg)) return normalizeRemoteUrl(arg);
  return arg;
}
