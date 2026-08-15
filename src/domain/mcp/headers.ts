import type { McpSecretValues } from './types.js';

export interface ColonPair {
  name: string;
  value: string;
}

/** Lines of `Name: value` or `Name` (value may be empty). */
export function parseColonPairs(text: string): ColonPair[] {
  const pairs: ColonPair[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const index = line.indexOf(':');
    const name = (index < 0 ? line : line.slice(0, index)).trim();
    if (!name) continue;
    const value = index < 0 ? '' : line.slice(index + 1).trim();
    const key = name;
    if (seen.has(key.toLowerCase())) {
      const existing = pairs.find((pair) => pair.name.toLowerCase() === key.toLowerCase());
      if (existing && value) existing.value = value;
      continue;
    }
    seen.add(key.toLowerCase());
    pairs.push({ name: key, value });
  }
  return pairs;
}

export function isSecretHeaderName(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return (
    lower === 'authorization' ||
    lower === 'proxy-authorization' ||
    lower === 'x-api-key' ||
    lower === 'api-key' ||
    lower === 'x-auth-token' ||
    lower.endsWith('-token') ||
    lower.endsWith('-secret') ||
    lower.includes('password')
  );
}

export function secretsFromPairs(
  pairs: ColonPair[],
  kind: 'headers' | 'env'
): McpSecretValues {
  const env: Record<string, string> = {};
  const headers: Record<string, string> = {};
  for (const pair of pairs) {
    if (!pair.value) continue;
    if (kind === 'headers') headers[pair.name] = pair.value;
    else env[pair.name] = pair.value;
  }
  return { env, headers };
}
