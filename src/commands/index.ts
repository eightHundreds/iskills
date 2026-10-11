import { t } from '../i18n/index.js';
import { agentIds } from '../domain/core.js';
import { DomainError } from '../domain/errors.js';

export async function commandImport(argv: string[]): Promise<void> {
  return (await import('./library.js')).commandImport(argv);
}

export async function commandSearch(argv: string[]): Promise<void> {
  return (await import('./search.js')).commandSearch(argv);
}

export async function commandConfig(argv: string[] = []): Promise<void> {
  return (await import('./config.js')).commandConfig(argv);
}

function agentHelpNames(): string {
  return agentIds().join(t('common.listSep'));
}

function commandHelp(): Record<string, () => string> {
  const agents = agentHelpNames();
  return {
    search: () => t('help.search'),
    import: () => t('help.import', { agents }),
    config: () => t('help.config'),
    mcp: () => t('help.mcp'),
  };
}

export function printHelp(command?: string): void {
  const help = command ? commandHelp()[command] : undefined;
  if (help) {
    console.log(help());
    return;
  }
  if (command) throw new DomainError('cli.unknownCommand', { command });
  console.log(t('help.root'));
}
