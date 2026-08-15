/**
 * Collection preferences at `config.json` (JSON5) in the collection root.
 * Tracked by collection Git; first-class field is UI locale preference.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import JSON5 from 'json5';
import { collectionPaths } from './core.js';

/** How UI language is chosen. */
export type LocalePreference = 'system' | 'zh' | 'en';

export interface UserConfig {
  /** UI language: follow system locale, or force zh/en. */
  locale: LocalePreference;
  /** When true, collection Git may track MCP secret overlay. Default false. */
  mcpSecretsInGit?: boolean;
}

const DEFAULT_CONFIG: UserConfig = {
  locale: 'system',
  mcpSecretsInGit: false,
};

/** Absolute path: `$XDG_CONFIG_HOME/iskills/config.json` (default `~/.config/iskills/config.json`). */
export function userConfigPath(): string {
  return join(collectionPaths().root, 'config.json');
}

function normalizeLocalePreference(value: unknown): LocalePreference {
  if (value === 'zh' || value === 'en' || value === 'system') return value;
  return 'system';
}

function normalizeUserConfig(raw: unknown): UserConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CONFIG };
  const record = raw as Record<string, unknown>;
  return {
    locale: normalizeLocalePreference(record.locale),
    mcpSecretsInGit: record.mcpSecretsInGit === true,
  };
}

/** Read user config (JSON5); missing file yields defaults. */
export async function readUserConfig(): Promise<UserConfig> {
  const path = userConfigPath();
  try {
    const text = await readFile(path, 'utf8');
    return normalizeUserConfig(JSON5.parse(text));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ...DEFAULT_CONFIG };
    }
    throw error;
  }
}

/** Persist user config as pretty JSON (valid JSON5). */
export async function writeUserConfig(config: UserConfig): Promise<void> {
  const normalized: UserConfig = {
    locale: normalizeLocalePreference(config.locale),
    mcpSecretsInGit: config.mcpSecretsInGit === true,
  };
  const path = userConfigPath();
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  // Strict JSON is valid JSON5; keeps hand-edits simple and tools happy.
  await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
}
