import { parseArgs } from 'node:util';
import { DomainError } from '../domain/errors.js';
import {
  addCollectedMcp,
  createCollectedMcp,
  importLocationToCollection,
  listCollectedMcps,
  listMcpLocations,
  mcpAgentIds,
  scanContext,
  writableMcpTargets,
  type McpLocationEntry,
  type McpRecipe,
  type McpScope,
  type McpTransport,
} from '../domain/mcp/index.js';
import { t } from '../i18n/index.js';

export async function commandMcp(argv: string[]): Promise<void> {
  const [subcommand, ...rest] = argv;
  if (!subcommand) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new DomainError('mcp.ttyRequired');
    }
    const { runMcpBrowserApp } = await import('../ui/mcp/index.js');
    return runMcpBrowserApp();
  }
  if (subcommand === 'create') return commandMcpCreate(rest);
  if (subcommand === 'import') return commandMcpImport(rest);
  if (subcommand === 'add') return commandMcpAdd(rest);
  throw new DomainError('cli.unknownMcpCommand', { command: subcommand });
}

export async function commandMcpCreate(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      transport: { type: 'string' },
      command: { type: 'string' },
      url: { type: 'string' },
      args: { type: 'string', multiple: true },
    },
  });
  if (positionals.length > 1) throw new DomainError('cmd.oneSkillNameOnly');
  let name = positionals[0]?.trim();
  let transport = parseTransport(values.transport);
  let command = values.command;
  let url = values.url;
  let args = values.args ?? [];

  if (!name || !transport || (transport === 'stdio' ? !command : !url)) {
    if (!process.stdin.isTTY) throw new DomainError('mcp.createNeedsFields');
    const { promptText, promptChoice } = await import('../ui/prompts/present.js');
    if (!name) {
      const entered = await promptText(t('mcp.namePrompt'));
      if (entered === undefined) return;
      name = entered.trim();
    }
    if (!name) throw new DomainError('mcp.specifyNames');
    if (!transport) {
      const picked = await promptChoice(
        [
          { label: 'stdio', value: 'stdio' },
          { label: 'http', value: 'http' },
          { label: 'sse', value: 'sse' },
        ],
        t('mcp.transportPrompt')
      );
      transport = parseTransport(picked);
    }
    if (!transport) throw new DomainError('mcp.createNeedsFields');
    if (transport === 'stdio') {
      if (!command) {
        const entered = await promptText(t('mcp.commandPrompt'));
        if (entered === undefined) return;
        const parts = splitArgs(entered);
        command = parts[0];
        args = parts.slice(1);
      }
    } else if (!url) {
      const entered = await promptText(t('mcp.urlPrompt'));
      if (entered === undefined) return;
      url = entered.trim();
    }
    const keysRaw = await promptText(t('mcp.keysPrompt'));
    const keys = keysRaw ? keysRaw.split(/[\s,]+/).filter(Boolean) : [];
    const recipe = buildRecipe(transport, command, url, args, keys);
    const created = await createCollectedMcp({ name, recipe });
    console.log(t('mcp.created', { name: created.name }));
    return;
  }

  const recipe = buildRecipe(transport, command, url, args, []);
  const created = await createCollectedMcp({ name, recipe });
  console.log(t('mcp.created', { name: created.name }));
}

export async function commandMcpImport(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      global: { type: 'boolean', short: 'g' },
      all: { type: 'boolean' },
      agent: { type: 'string', multiple: true },
      replace: { type: 'boolean' },
      yes: { type: 'boolean', short: 'y' },
    },
  });
  const scope: McpScope = values.global ? 'global' : 'project';
  const ctx = scanContext();
  let entries = await listMcpLocations(scope, ctx);
  if (values.agent?.length) {
    const allowed = new Set(values.agent);
    entries = entries.filter((entry) => allowed.has(entry.agent));
  }
  if (!entries.length) throw new DomainError('mcp.noEntries');

  let selected = entries;
  if (!values.all && (entries.length > 1 || !values.yes)) {
    if (!process.stdin.isTTY) throw new DomainError('mcp.useAllOrInteractive');
    const { promptChoicesMany } = await import('../ui/prompts/present.js');
    const picked = await promptChoicesMany(
      entries.map((entry) => ({
        label: formatEntryLabel(entry),
        value: locationId(entry),
      })),
      t('mcp.selectImport')
    );
    selected = entries.filter((entry) => picked.includes(locationId(entry)));
  }
  if (!selected.length) return;
  if (!values.yes && !values.all && process.stdin.isTTY) {
    const { Modal } = await import('../ui/overlay/static.js');
    const ok = await Modal.confirm({
      title: t('common.confirm'),
      message: t('mcp.importConfirm', { count: selected.length }),
    });
    if (!ok) return;
  } else if (!values.yes && !process.stdin.isTTY) {
    throw new DomainError('mcp.useYesToConfirm');
  }

  let count = 0;
  for (const entry of selected) {
    const importOptions: Parameters<typeof importLocationToCollection>[1] = {
      allowReplace: values.replace ?? false,
    };
    if (!values.replace && process.stdin.isTTY) {
      importOptions.confirmReplace = async ({ name }) => {
        const { Modal } = await import('../ui/overlay/static.js');
        return Modal.confirm({
          title: t('common.confirm'),
          message: t('mcp.replaceConfirm', { name }),
          defaultValue: false,
        });
      };
    }
    const result = await importLocationToCollection(entry, importOptions);
    if (result.result === 'imported') count += 1;
    if (result.result === 'collected-as') {
      console.error(t('mcp.alreadyCollectedAs', { name: result.name }));
    }
  }
  console.log(t('mcp.importedCount', { count }));
}

export async function commandMcpAdd(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      global: { type: 'boolean', short: 'g' },
      agent: { type: 'string', multiple: true },
      yes: { type: 'boolean', short: 'y' },
    },
  });
  const collection = await listCollectedMcps();
  let names = positionals.map((name) => name.trim()).filter(Boolean);
  if (!names.length) {
    if (!process.stdin.isTTY) throw new DomainError('mcp.specifyNames');
    if (!collection.length) throw new DomainError('mcp.missingInCollection', { name: '' });
    const { promptChoicesMany } = await import('../ui/prompts/present.js');
    names = await promptChoicesMany(
      collection.map((item) => ({ label: item.name, value: item.name })),
      t('mcp.selectAdd')
    );
  }
  if (!names.length) return;

  const scope: McpScope = values.global ? 'global' : 'project';
  const ctx = scanContext();
  const explicit = Boolean(values.agent?.length);
  let targets = explicit
    ? (values.agent ?? []).map((agent) => ({ agent, scope }))
    : await writableMcpTargets(mcpAgentIds(), scope, ctx);
  if (!explicit && process.stdin.isTTY && targets.length) {
    const { promptChoicesMany } = await import('../ui/prompts/present.js');
    const chosen = await promptChoicesMany(
      targets.map((target) => ({ label: target.agent, value: target.agent })),
      t('mcp.selectAgents')
    );
    const allowed = new Set(chosen);
    targets = targets.filter((target) => allowed.has(target.agent));
  }
  if (!targets.length) return;
  if (!values.yes && process.stdin.isTTY) {
    const { Modal } = await import('../ui/overlay/static.js');
    const ok = await Modal.confirm({
      title: t('common.confirm'),
      message: t('mcp.addConfirm', { count: names.length }),
    });
    if (!ok) return;
  } else if (!values.yes && !process.stdin.isTTY) {
    throw new DomainError('mcp.useYesToConfirm');
  }

  let added = 0;
  for (const name of names) {
    added += (await addCollectedMcp(name, targets, ctx)).added;
  }
  console.log(t('mcp.addedCount', { count: added }));
}

function parseTransport(value: string | undefined): McpTransport | undefined {
  if (value === 'stdio' || value === 'http' || value === 'sse') return value;
  return undefined;
}

function splitArgs(value: string): string[] {
  return value.trim().split(/\s+/).filter(Boolean);
}

function buildRecipe(
  transport: McpTransport,
  command: string | undefined,
  url: string | undefined,
  args: string[],
  keys: string[]
): McpRecipe {
  if (transport === 'stdio') {
    return {
      transport,
      ...(command ? { command } : {}),
      args,
      envKeys: keys,
      headerKeys: [],
    };
  }
  return {
    transport,
    ...(url ? { url } : {}),
    envKeys: [],
    headerKeys: keys,
  };
}

function locationId(entry: McpLocationEntry): string {
  return `${entry.agent}|${entry.scope}|${entry.ownership}|${entry.nativeKey}|${entry.filePath}`;
}

function formatEntryLabel(entry: McpLocationEntry): string {
  const mark = entry.ownership === 'borrowed' ? '↪ ' : '';
  return `${mark}${entry.agent} ${entry.nativeKey}`;
}
