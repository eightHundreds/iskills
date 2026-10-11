import { join } from 'node:path';
import {
  collectionPaths,
  ensureCollection,
  exists,
  collectionGitAddPaths,
} from './core.js';
import {
  readUserConfig,
  writeUserConfig,
  type LocalePreference,
} from './user-config.js';
import { setMcpSecretsInGit, mcpSecretsPath } from './mcp/secrets.js';
import {
  executeWrites,
  conflictItem,
  requireAuthorization,
} from './agent-write.js';
import {
  OperationFailure,
  operationError,
  type OperationResult,
} from './operation.js';
import { optionalGit } from './agent-read.js';
import { runGit } from './process.js';
import { syncCollection, type CollectionSyncProgress } from './git.js';

export async function executeCollectionWrite(
  command: string,
  names: string[],
  options: Record<string, unknown>,
  signal: AbortSignal,
): Promise<OperationResult> {
  const dryRun = options['dry-run'] === true;
  const { root } = collectionPaths();
  if (command === 'config.set') {
    if (
      names.length !== 2 ||
      !['locale', 'mcpSecretsInGit'].includes(names[0]!)
    )
      throw new OperationFailure(
        'usage.invalidArguments',
        'A supported configuration key and value are required.',
      );
    const [key, input] = names;
    if (
      !(key === 'locale' ? ['system', 'zh', 'en'] : ['true', 'false']).includes(
        input!,
      )
    )
      throw new OperationFailure(
        'usage.invalidArguments',
        'Invalid configuration value.',
        { key },
      );
    const value = key === 'locale' ? input : input === 'true';
    const config = await readUserConfig();
    return executeWrites(
      [
        {
          item: {
            name: key,
            value,
            action: 'set-config',
            status:
              config[key as keyof typeof config] === value
                ? 'unchanged'
                : 'planned',
            reason: 'same-value',
            ...(key === 'mcpSecretsInGit'
              ? { secretOverlayPath: mcpSecretsPath(), trackSecrets: value }
              : {}),
          },
          execute: async () => {
            if (key === 'mcpSecretsInGit')
              await setMcpSecretsInGit(value === true);
            else {
              await writeUserConfig({
                ...config,
                locale: value as LocalePreference,
              });
            }
          },
        },
      ],
      dryRun,
      true,
      command,
      signal,
    );
  }
  if (command === 'collection.sync') {
    if (names.length)
      throw new OperationFailure(
        'usage.invalidArguments',
        'Sync accepts no positional arguments.',
      );
    if (!(await exists(join(root, '.git'))))
      throw new OperationFailure(
        'usage.invalidArguments',
        'The collection has no Git repository.',
      );
    const origin = await optionalGit(
      root,
      ['remote', 'get-url', 'origin'],
      signal,
    );
    if (!origin)
      throw new OperationFailure(
        'usage.invalidArguments',
        'The collection has no origin remote.',
      );
    if (dryRun)
      return {
        result: {
          items: [
            {
              name: 'collection',
              action: 'sync',
              status: 'planned',
              origin,
              branch: await optionalGit(
                root,
                ['symbolic-ref', '--short', 'HEAD'],
                signal,
              ),
              upstream: await optionalGit(
                root,
                ['rev-parse', '--abbrev-ref', '@{upstream}'],
                signal,
              ),
            },
          ],
          git: { status: 'not-needed' },
          plannedGit: ['commit', 'fetch', 'merge', 'push'],
        },
      };
    const progress: CollectionSyncProgress = {
      stages: {
        commit: 'not-run',
        fetch: 'not-run',
        merge: 'not-run',
        push: 'not-run',
      },
      conflicts: [],
    };
    const before = await optionalGit(root, ['rev-parse', 'HEAD'], signal);
    try {
      await syncCollection(false, progress);
      return {
        result: {
          items: [
            {
              name: 'collection',
              action: 'sync',
              status: 'committed',
              ...progress,
            },
          ],
          git: {
            status: 'committed',
            commit: await runGit(['-C', root, 'rev-parse', 'HEAD'], signal),
          },
        },
      };
    } catch (error) {
      const failure = {
        ...operationError(error, 'write'),
        code: signal.aborted ? 'execution.interrupted' : 'git.syncFailed',
      };
      const after = await optionalGit(root, ['rev-parse', 'HEAD']);
      return {
        result: {
          items: [
            {
              name: 'collection',
              action: 'sync',
              status: 'failed',
              error: failure,
              restored: 'unknown',
              ...progress,
            },
          ],
          git: { status: 'failed', error: failure },
        },
        error: failure,
        exitCode: signal.aborted ? 130 : 1,
        partial: before !== after,
      };
    }
  }
  const initializing = command === 'collection.init';
  const clearing = command === 'collection.remote.clear';
  if (names.length !== (command === 'collection.remote.set' ? 1 : 0))
    throw new OperationFailure(
      'usage.invalidArguments',
      'Invalid arguments for collection management.',
    );
  const remote = initializing
    ? (options.remote as string | undefined)
    : names[0];
  if (remote !== undefined && !remote.trim())
    throw new OperationFailure(
      'usage.invalidArguments',
      'Remote cannot be empty.',
    );
  if (clearing) requireAuthorization(options.yes === true, dryRun, ['origin']);
  const repo = await exists(join(root, '.git'));
  const head = repo
    ? await optionalGit(root, ['rev-parse', '--verify', 'HEAD'], signal)
    : null;
  const previous = repo
    ? await optionalGit(root, ['remote', 'get-url', 'origin'], signal)
    : null;
  let item: Record<string, unknown> = {
    name: initializing ? 'collection' : 'origin',
    action: initializing ? 'init' : clearing ? 'clear-remote' : 'set-remote',
    status: 'planned',
    origin: clearing ? null : (remote ?? previous),
  };
  if (
    clearing
      ? !previous
      : initializing
        ? Boolean(head) && (!remote || remote === previous)
        : remote === previous
  )
    item = { ...item, status: 'unchanged', reason: 'same-value' };
  else if (remote && previous && remote !== previous && !options.replace)
    item = conflictItem(item, 'conflict.targetExists', {
      existing: previous,
      incoming: remote,
      requiredFlags: ['--replace'],
    });
  const response = await executeWrites(
    [
      {
        item,
        execute: async () => {
          if (clearing) {
            await runGit(['-C', root, 'remote', 'remove', 'origin'], signal);
            return;
          }
          if (!head) {
            await ensureCollection();
            if (!repo)
              await runGit(
                ['-C', root, 'init', '--quiet', '-b', 'main'],
                signal,
              );
            for (const [key, fallback] of [
              ['user.name', 'Skill Collection'],
              ['user.email', 'iskills@localhost'],
            ]) {
              if (!(await optionalGit(root, ['config', '--get', key!], signal)))
                await runGit(['-C', root, 'config', key!, fallback!], signal);
            }
            await runGit(
              [
                '-C',
                root,
                'add',
                '-A',
                '--',
                ...(await collectionGitAddPaths(root)),
              ],
              signal,
            );
            await runGit(
              [
                '-C',
                root,
                'commit',
                '--quiet',
                '-m',
                'initialize skill collection',
              ],
              signal,
            );
          }
          if (remote)
            await runGit(
              [
                '-C',
                root,
                'remote',
                previous ? 'set-url' : 'add',
                'origin',
                remote,
              ],
              signal,
            );
        },
      },
    ],
    dryRun,
    false,
    command,
    signal,
  );
  if (response.error && response.exitCode !== 3) {
    response.error.code = signal.aborted
      ? 'execution.interrupted'
      : 'git.syncFailed';
    response.result.git = { status: 'failed', error: response.error };
  } else if (!response.error && !dryRun && item.status === 'committed') {
    response.result.git = {
      status: 'committed',
      commit: await optionalGit(root, ['rev-parse', 'HEAD']),
    };
  } else if (!response.error && !dryRun && repo) {
    response.result.git = { status: 'unchanged' };
  }
  return response;
}
