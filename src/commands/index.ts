import { t } from '../i18n/index.js';
import { parseArgs } from 'node:util';
import { agentIds } from '../domain/core.js';
import { DomainError } from '../domain/errors.js';
import {
  configureCollectionRemote,
  initCollectionGit,
} from '../domain/git.js';

export async function commandAdd(argv: string[]): Promise<void> {
  return (await import('./library.js')).commandAdd(argv);
}

export async function commandCreate(argv: string[]): Promise<void> {
  return (await import('./create.js')).commandCreate(argv);
}

export async function commandImport(argv: string[]): Promise<void> {
  return (await import('./library.js')).commandImport(argv);
}

export async function commandSearch(argv: string[]): Promise<void> {
  return (await import('./search.js')).commandSearch(argv);
}

export async function commandConfig(argv: string[] = []): Promise<void> {
  return (await import('./config.js')).commandConfig(argv);
}

export async function commandInit(argv: string[] = []): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: { remote: { type: 'string' } },
  });
  const initialized = await initCollectionGit();
  console.log(initialized ? t('git.initDone') : t('git.alreadyInit'));
  let remote = values.remote;
  if (!remote && initialized && process.stdin.isTTY) {
    const [{ Modal }, { promptText }] = await Promise.all([
      import('../ui/overlay/static.js'),
      import('../ui/prompts/present.js'),
    ]);
    if (await Modal.confirm({ title: t('common.confirm'), message: t('git.configureRemotePrompt') })) {
      remote = await promptText(t('git.remoteAddressPrompt'));
    }
  }
  if (remote) {
    await configureCollectionRemote(remote);
    console.log(t('git.remoteConfigured'));
  }
}

function agentHelpNames(): string {
  return agentIds().join(t('common.listSep'));
}

function commandHelp(): Record<string, () => string> {
  const agents = agentHelpNames();
  return {
    search: () => t('help.search'),
    add: () => t('help.add', { agents }),
    create: () => t('help.create'),
    import: () => t('help.import', { agents }),
    init: () => t('help.init'),
    config: () => t('help.config'),
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
