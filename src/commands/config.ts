import { readUserConfig, writeUserConfig } from '../domain/user-config.js';
import { applyLocalePreference, t } from '../i18n/index.js';
import { presentSettings } from '../ui/config/index.js';

/**
 * Interactive UI preferences (`iskills config`).
 * Settings list: ←→ changes write immediately; Esc/q closes.
 */
export async function commandConfig(_argv: string[] = []): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(t('cli.configTtyRequired'));
  }

  const current = await readUserConfig();
  applyLocalePreference(current.locale);

  await presentSettings({
    initial: current,
    onPersist: async (config) => {
      await writeUserConfig(config);
      applyLocalePreference(config.locale);
    },
  });
}
