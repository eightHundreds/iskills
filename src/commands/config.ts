import { DomainError } from '../domain/errors.js';
import { commitCollection } from '../domain/core.js';
import {
  clearCollectionRemote,
  configureCollectionRemote,
  getCollectionRemote,
} from '../domain/git.js';
import { setMcpSecretsInGit } from '../domain/mcp/index.js';
import { readUserConfig, writeUserConfig } from '../domain/user-config.js';
import { applyLocalePreference } from '../i18n/index.js';
import { presentSettings } from '../ui/config/index.js';

/**
 * Interactive preferences (`iskills config`).
 * Locale / MCP secrets → tracked config.json; collection remote → git origin.
 * Settings list: ←→ / Enter apply immediately; Esc/q closes.
 */
export async function commandConfig(_argv: string[] = []): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new DomainError('cli.configTtyRequired');
  }

  const current = await readUserConfig();
  applyLocalePreference(current.locale);
  const remote = await getCollectionRemote();

  await presentSettings({
    initial: current,
    initialRemote: remote ?? '',
    onPersist: async (config) => {
      await writeUserConfig(config);
      applyLocalePreference(config.locale);
      await setMcpSecretsInGit(config.mcpSecretsInGit === true);
      await commitCollection('update collection config');
    },
    onPersistRemote: async (url) => {
      const trimmed = url.trim();
      if (!trimmed) {
        await clearCollectionRemote();
        return '';
      }
      await configureCollectionRemote(trimmed);
      return trimmed;
    },
  });
}
