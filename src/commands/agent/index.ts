import { stat, readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { collectionPaths, readState } from '../../domain/core.js';
import { readUserConfig } from '../../domain/user-config.js';
import {
  OperationFailure,
  operationError,
  redactOutput,
  type OperationResult,
} from '../../domain/operation.js';
import {
  readSkills,
  readMcps,
  readResult,
  readAgents,
  readStatus,
  readSkillLocations,
  readMcpLocations,
  publicLocation,
  publicMcp,
  secretStatus,
  readDiscovery,
  readSearch,
  optionalGit,
} from '../../domain/agent-read.js';
import {
  parseArguments,
  requirePositionals,
  stringOption,
  listOption,
  type Arguments,
  type OptionKind,
} from './arguments.js';
import { executeSkillWrite } from '../../domain/agent-skill-write.js';
import { executeMcpWrite } from '../../domain/agent-mcp-write.js';
import { executeCollectionWrite } from '../../domain/agent-collection-write.js';
import { probeCollectedHttp } from '../../domain/mcp/write.js';
import { withProcessSignal } from '../../domain/process.js';

const READ_OPTIONS: Record<string, Record<string, OptionKind>> = {
  agents: {},
  status: {},
  'skill.list': { query: 'string', tag: 'multiple' },
  'skill.show': { body: 'boolean' },
  'skill.locations': { agent: 'multiple', scope: 'string', root: 'string' },
  'skill.discover': { git: 'string', local: 'string' },
  'skill.search': { limit: 'string' },
  'mcp.list': { query: 'string', tag: 'multiple' },
  'mcp.show': {},
  'mcp.locations': { agent: 'multiple', scope: 'string' },
  'mcp.secret.status': {},
  'collection.remote.get': {},
  'config.get': {},
};

const META_OPTIONS: Record<string, OptionKind> = {
  tags: 'string',
  'add-tag': 'multiple',
  'remove-tag': 'multiple',
  note: 'string',
};
const WRITE_OPTIONS: Record<string, Record<string, OptionKind>> = {
  'skill.create': {},
  'skill.adopt': { all: 'boolean' },
  'skill.import': {
    git: 'string',
    local: 'string',
    path: 'multiple',
    all: 'boolean',
    'expect-commit': 'string',
    replace: 'boolean',
    tag: 'multiple',
  },
  'skill.install': {
    'from-location': 'multiple',
    agent: 'multiple',
    scope: 'string',
    to: 'string',
    copy: 'boolean',
    replace: 'boolean',
  },
  'skill.remove': { yes: 'boolean' },
  'skill.uninstall': { yes: 'boolean' },
  'skill.materialize': {},
  'skill.update': { all: 'boolean', 'allow-delete': 'boolean', yes: 'boolean' },
  'skill.edit': META_OPTIONS,
  'skill.tag.rename': {},
  'skill.source.bind': { git: 'string', path: 'string', replace: 'boolean' },
  'skill.source.unbind': { yes: 'boolean' },
  'mcp.create': { input: 'string' },
  'mcp.import': {
    input: 'string',
    location: 'multiple',
    name: 'string',
    replace: 'boolean',
  },
  'mcp.add': { agent: 'multiple', scope: 'string', replace: 'boolean' },
  'mcp.update': { location: 'multiple', replace: 'boolean' },
  'mcp.enable': {},
  'mcp.disable': {},
  'mcp.uninstall': { yes: 'boolean' },
  'mcp.remove': { yes: 'boolean' },
  'mcp.rename': {},
  'mcp.edit': {
    ...META_OPTIONS,
    'recipe-input': 'string',
    description: 'string',
  },
  'mcp.tag.rename': {},
  'mcp.secret.set': {
    env: 'string',
    header: 'string',
    url: 'boolean',
    'value-stdin': 'boolean',
    'value-file': 'string',
  },
  'mcp.secret.unset': {
    env: 'string',
    header: 'string',
    url: 'boolean',
    yes: 'boolean',
  },
  'collection.init': { remote: 'string', replace: 'boolean' },
  'collection.sync': {},
  'collection.remote.set': { replace: 'boolean' },
  'collection.remote.clear': { yes: 'boolean' },
  'config.set': {},
};
const COMMAND_OPTIONS: Record<string, Record<string, OptionKind>> = {
  ...READ_OPTIONS,
  ...Object.fromEntries(
    Object.entries(WRITE_OPTIONS).map(([command, options]) => [
      command,
      { ...options, 'dry-run': 'boolean' as const },
    ]),
  ),
  'mcp.probe': {},
};

function commandPath(argv: string[]): { command: string; rest: string[] } {
  const depth = ['skill', 'mcp', 'collection', 'config'].includes(argv[0] ?? '')
    ? ['tag', 'source', 'secret', 'remote'].includes(argv[1] ?? '')
      ? 3
      : 2
    : 1;
  return { command: argv.slice(0, depth).join('.'), rest: argv.slice(depth) };
}

function scopes(args: Arguments): Array<'project' | 'global'> {
  const scope = stringOption(args, 'scope');
  if (scope && !['project', 'global'].includes(scope))
    throw new OperationFailure('usage.invalidArguments', 'Invalid scope.', {
      scope,
    });
  return scope ? [scope as 'project' | 'global'] : ['project', 'global'];
}

function filterItems<
  T extends { name: string; description: string; tags: string[] },
>(items: T[], args: Arguments): T[] {
  const query = stringOption(args, 'query')?.toLowerCase();
  const tags = listOption(args, 'tag');
  return items.filter(
    (item) =>
      (!query ||
        `${item.name} ${item.description}`.toLowerCase().includes(query)) &&
      tags.every((tag) => item.tags.includes(tag)),
  );
}

async function executeRead(
  command: string,
  args: Arguments,
  project: string,
  signal: AbortSignal,
): Promise<OperationResult> {
  if (command === 'agents' || command === 'status') {
    requirePositionals(args, 0);
    return command === 'agents' ? readAgents(project) : readStatus(signal);
  }
  if (command === 'config.get') {
    const [key] = requirePositionals(args, 0, 1);
    if (key && !['locale', 'mcpSecretsInGit'].includes(key))
      throw new OperationFailure(
        'usage.invalidArguments',
        'Unknown configuration key.',
        { key },
      );
    const config = await readUserConfig();
    return {
      result: key
        ? { key, value: config[key as keyof typeof config] }
        : { config },
    };
  }
  if (command === 'collection.remote.get') {
    requirePositionals(args, 0);
    return {
      result: {
        origin: await optionalGit(
          collectionPaths().root,
          ['remote', 'get-url', 'origin'],
          signal,
        ),
      },
    };
  }
  if (command === 'skill.locations' || command === 'mcp.locations') {
    requirePositionals(args, 0);
    const names = listOption(args, 'agent');
    const selectedScopes = scopes(args);
    const root = stringOption(args, 'root');
    if (root && (names.length || args.options.scope))
      throw new OperationFailure(
        'usage.invalidArguments',
        'A custom root cannot be combined with agent or scope.',
      );
    if (command === 'skill.locations')
      return readSkillLocations(project, names, selectedScopes, root);
    const locations = await readMcpLocations(project, names, selectedScopes);
    return readResult(
      {
        items: locations.entries.map((entry) => publicLocation(entry, project)),
      },
      locations.issues,
    );
  }
  if (command === 'skill.discover') {
    requirePositionals(args, 0);
    const git = stringOption(args, 'git');
    const local = stringOption(args, 'local');
    if (Boolean(git) === Boolean(local))
      throw new OperationFailure(
        'usage.invalidArguments',
        'Choose exactly one source: --git or --local.',
      );
    return readDiscovery(
      project,
      { ...(git ? { git } : {}), ...(local ? { local } : {}) },
      signal,
    );
  }
  if (command === 'skill.search') {
    const [query] = requirePositionals(args, 1);
    const limit = Number(stringOption(args, 'limit') ?? 20);
    if (query!.length < 2 || !Number.isSafeInteger(limit) || limit < 1)
      throw new OperationFailure(
        'usage.invalidArguments',
        'Search requires at least two characters and a positive integer limit.',
      );
    return readSearch(query!, limit, signal);
  }
  const collection = command.startsWith('skill.')
    ? await readSkills()
    : await readMcps();
  if (command.endsWith('.list')) {
    requirePositionals(args, 0);
    const items = filterItems<
      | Awaited<ReturnType<typeof readSkills>>['items'][number]
      | Awaited<ReturnType<typeof readMcps>>['items'][number]
    >(collection.items, args);
    return readResult(
      {
        items: command.startsWith('mcp.')
          ? await Promise.all(
              items.map(async (item) => ({
                ...publicMcp(
                  item as Awaited<ReturnType<typeof readMcps>>['items'][number],
                ),
                secrets: await secretStatus(
                  item as Awaited<ReturnType<typeof readMcps>>['items'][number],
                ),
              })),
            )
          : items,
      },
      collection.issues,
    );
  }
  const [name] = requirePositionals(args, 1);
  const item = collection.items.find((value) => value.name === name);
  if (!item)
    throw new OperationFailure(
      'usage.selectionNotFound',
      'The selected collection item does not exist.',
      { name },
    );
  if (command === 'skill.show') {
    const state = await readState();
    return {
      result: {
        item: {
          ...item,
          links: state.links.filter((link) => link.skill === name),
          ...(args.options.body
            ? {
                body: await readFile(
                  join(collectionPaths().skills, name!, 'SKILL.md'),
                  'utf8',
                ),
              }
            : {}),
        },
      },
    };
  }
  const mcp = item as Awaited<ReturnType<typeof readMcps>>['items'][number];
  if (command === 'mcp.secret.status')
    return readResult({ items: await secretStatus(mcp) });
  return {
    result: { item: { ...publicMcp(mcp), secrets: await secretStatus(mcp) } },
  };
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const help =
    ['help', '--help', '-h'].includes(argv[0] ?? '') ||
    argv.includes('--help') ||
    argv.includes('-h');
  const invocation = ['help', '--help', '-h'].includes(argv[0] ?? '')
    ? argv.slice(1)
    : argv.filter((token) => !['--help', '-h'].includes(token));
  const parsed = commandPath(invocation);
  const command = Object.hasOwn(COMMAND_OPTIONS, parsed.command)
    ? parsed.command
    : null;
  const context: {
    project: string | null;
    collection: string | null;
    dryRun: boolean;
  } = {
    project: resolve('.'),
    collection: collectionPaths().root,
    dryRun: false,
  };
  const controller = new AbortController();
  const interrupt = (): void => controller.abort();
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  let outcome = 'succeeded';
  let result: Record<string, unknown> | null = null;
  let error: ReturnType<typeof operationError> | null = null;
  let warnings: ReturnType<typeof operationError>[] = [];
  try {
    if (!command)
      throw new OperationFailure('usage.unknownCommand', 'Unknown command.', {
        command: parsed.command,
      });
    if (help) {
      const argumentsByCommand: Record<string, string> = {
        'skill.show': '<name>',
        'skill.search': '<query>',
        'skill.create': '<name>',
        'skill.adopt': '[name...]',
        'skill.install': '[name...]',
        'skill.remove': '<name...>',
        'skill.update': '[name...]',
        'skill.uninstall': '<absolute-path...>',
        'skill.materialize': '<absolute-path...>',
        'skill.edit': '<name>',
        'skill.tag.rename': '<from> <to>',
        'skill.source.bind': '<name>',
        'skill.source.unbind': '<name>',
        'mcp.show': '<name>',
        'mcp.create': '<name>',
        'mcp.add': '<name...>',
        'mcp.update': '<name>',
        'mcp.enable': '<selector...>',
        'mcp.disable': '<selector...>',
        'mcp.uninstall': '<selector...>',
        'mcp.remove': '<name...>',
        'mcp.edit': '<name>',
        'mcp.rename': '<from> <to>',
        'mcp.tag.rename': '<from> <to>',
        'mcp.probe': '<name>',
        'mcp.secret.set': '<name>',
        'mcp.secret.unset': '<name>',
        'mcp.secret.status': '<name>',
        'collection.remote.set': '<source>',
        'config.get': '[key]',
        'config.set': '<key> <value>',
      };
      process.stdout.write(
        `Usage: iskills ${command.replaceAll('.', ' ')} ${argumentsByCommand[command] ?? ''} [options]\n\nOptions:\n  --project <directory>\n  -h, --help\n${Object.entries(
          COMMAND_OPTIONS[command]!,
        )
          .map(
            ([key, kind]) =>
              `  --${key}${kind === 'boolean' ? '' : ' <value>'}${kind === 'multiple' ? ' (repeatable)' : ''}`,
          )
          .join(
            '\n',
          )}\n\nReturns one JSON document. --replace authorizes replacement; --yes authorizes deletion.\nWrites support --dry-run. Exit codes: 0 success, 2 usage, 3 preflight conflict, 1 execution, 130 interrupted.\nSee AGENT-CLI.md for input shapes and examples.\n`,
      );
      return;
    }
    const args = parseArguments(parsed.rest, COMMAND_OPTIONS[command]!);
    const stdinConsumers =
      ['input', 'recipe-input', 'value-file'].filter(
        (key) => args.options[key] === '-',
      ).length + (args.options['value-stdin'] ? 1 : 0);
    if (stdinConsumers > 1)
      throw new OperationFailure(
        'usage.invalidArguments',
        'Only one stdin consumer is allowed.',
      );
    context.dryRun = args.options['dry-run'] === true;
    context.project = resolve(stringOption(args, 'project') ?? '.');
    try {
      if (!(await stat(context.project)).isDirectory()) throw new Error();
    } catch {
      const path = context.project;
      context.project = null;
      throw new OperationFailure(
        'usage.invalidLocation',
        'The project must be an existing directory.',
        { path },
      );
    }
    process.env.SK_NO_BACKGROUND_SYNC = '1';
    process.env.ISKILLS_AGENT_CLI = '1';
    const project = context.project;
    const response = await withProcessSignal(controller.signal, async () =>
      command in READ_OPTIONS
        ? executeRead(command, args, project, controller.signal)
        : command === 'mcp.probe'
          ? executeProbe(args, controller.signal)
          : command.startsWith('skill.')
            ? executeSkillWrite({
                command,
                project,
                names: args.positional,
                options: args.options,
                signal: controller.signal,
              })
            : command.startsWith('mcp.')
              ? executeMcpWrite({
                  command,
                  project,
                  names: args.positional,
                  options: args.options,
                  signal: controller.signal,
                })
              : executeCollectionWrite(
                  command,
                  args.positional,
                  args.options,
                  controller.signal,
                ),
    );
    result = response.result;
    error = response.error ?? null;
    warnings = response.warnings ?? [];
    if (controller.signal.aborted && !error)
      error = {
        code: 'execution.interrupted',
        message: 'The operation was interrupted.',
        details: {},
        retry: 'inspect-state',
      };
    outcome = response.partial ? 'partial' : error ? 'failed' : 'succeeded';
    process.exitCode = controller.signal.aborted
      ? 130
      : (response.exitCode ?? 0);
  } catch (cause) {
    error = controller.signal.aborted
      ? {
          code: 'execution.interrupted',
          message: 'The operation was interrupted.',
          details: {},
          retry: 'inspect-state',
        }
      : operationError(cause);
    outcome = 'failed';
    process.exitCode = controller.signal.aborted
      ? 130
      : cause instanceof OperationFailure
        ? cause.exitCode
        : error.code.startsWith('usage.')
          ? 2
          : 1;
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  }
  process.stdout.once('error', (cause: NodeJS.ErrnoException) => {
    if (cause.code === 'EPIPE') process.exitCode = 1;
  });
  const envelope: Record<string, unknown> = {
    schemaVersion: 1,
    command,
    outcome,
    context,
    result,
    warnings,
    error,
  };
  if (
    error &&
    process.exitCode === 1 &&
    command &&
    Object.hasOwn(WRITE_OPTIONS, command) &&
    !context.dryRun &&
    Array.isArray(result?.items) &&
    result.items.some((item: { status?: string }) => item.status === 'failed')
  ) {
    try {
      const directory = join(collectionPaths().local, 'logs');
      const logPath = join(
        directory,
        `${Date.now()}-${process.pid}-agent.json`,
      );
      await mkdir(directory, { recursive: true });
      await writeFile(logPath, `${JSON.stringify(redactOutput(envelope))}\n`, {
        mode: 0o600,
      });
      envelope.logPath = logPath;
    } catch {}
  }
  process.stdout.write(`${JSON.stringify(redactOutput(envelope))}\n`);
}

async function executeProbe(
  args: Arguments,
  signal: AbortSignal,
): Promise<OperationResult> {
  const [name] = requirePositionals(args, 1);
  const mcp = (await readMcps()).items.find((item) => item.name === name);
  if (!mcp)
    throw new OperationFailure(
      'usage.selectionNotFound',
      'The MCP is not collected.',
      { name },
    );
  if (mcp.recipe.transport === 'stdio')
    throw new OperationFailure(
      'usage.unsupportedCapability',
      'Only HTTP/SSE endpoints can be probed.',
      { name },
    );
  let httpStatus: number | null = null;
  const status = await probeCollectedHttp(name!, {
    timeoutMs: 30_000,
    signal,
    onResponse: (value) => {
      httpStatus = value;
    },
  });
  return {
    result: { status, httpStatus },
    ...(status === 'failed'
      ? {
          error: {
            code: 'execution.networkFailed',
            message: 'The MCP endpoint could not be reached.',
            details: { name, timeoutMs: 30_000 },
            retry: 'after-fix' as const,
          },
          exitCode: 1,
        }
      : {}),
  };
}
