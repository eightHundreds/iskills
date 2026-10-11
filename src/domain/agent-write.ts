import {
  commitCollectionResult,
  withDeferredCollectionCommit,
} from './core.js';
import {
  OperationFailure,
  operationError,
  type OperationError,
  type OperationResult,
} from './operation.js';
import { getDomainNotify, setDomainNotify } from './errors.js';
import { withProcessSignal } from './process.js';

export interface PlannedWrite {
  item: Record<string, unknown>;
  execute: () => Promise<void>;
}

/** Shared execution boundary: reject the entire preflight, then preserve committed targets. */
export async function executeWrites(
  plans: PlannedWrite[],
  dryRun: boolean,
  collection: boolean,
  command: string,
  signal: AbortSignal,
): Promise<OperationResult> {
  const conflicts = plans.filter((plan) => plan.item.status === 'conflict');
  if (conflicts.length) {
    for (const plan of plans) {
      if (plan.item.status === 'planned') plan.item.status = 'not-run';
      const stages = plan.item.stages as Record<string, string> | undefined;
      if (stages)
        for (const key of Object.keys(stages))
          if (stages[key] === 'planned') stages[key] = 'not-run';
    }
    return {
      result: {
        items: plans.map((plan) => plan.item),
        git: { status: 'not-needed' },
      },
      error: conflicts[0]!.item.error as OperationError,
      exitCode: 3,
    };
  }
  if (dryRun)
    return {
      result: {
        items: plans.map((plan) => plan.item),
        git: { status: 'not-needed' },
        plannedGit: collection ? ['commit'] : [],
      },
    };
  let error: OperationError | undefined;
  let changed = false;
  const warnings: OperationError[] = [];
  const notify = getDomainNotify();
  setDomainNotify((code) =>
    warnings.push({
      code,
      message: 'A post-write operation reported a warning.',
      details: {},
      retry: 'inspect-state',
    }),
  );
  try {
    await withDeferredCollectionCommit(async () => {
      for (const plan of plans) {
        if (plan.item.status === 'unchanged') continue;
        if (error) {
          plan.item.status = 'not-run';
          const stages = plan.item.stages as Record<string, string> | undefined;
          if (stages)
            for (const key of Object.keys(stages))
              if (stages[key] === 'planned') stages[key] = 'not-run';
          continue;
        }
        try {
          if (signal.aborted)
            throw new OperationFailure(
              'execution.interrupted',
              'The operation was interrupted.',
              {},
              130,
              'inspect-state',
            );
          await plan.execute();
          plan.item.status = 'committed';
          changed = true;
        } catch (cause) {
          error = signal.aborted
            ? {
                code: 'execution.interrupted',
                message: 'The operation was interrupted.',
                details: {},
                retry: 'inspect-state',
              }
            : operationError(cause, 'write');
          plan.item.status = 'failed';
          plan.item.error = error;
          plan.item.restored ??= error.details.restored ?? 'unknown';
          const stages = plan.item.stages as Record<string, string> | undefined;
          if (stages && Object.values(stages).includes('committed'))
            changed = true;
        }
      }
    });
  } finally {
    setDomainNotify(notify);
  }
  const git =
    collection && changed
      ? await withProcessSignal(
          signal.aborted ? new AbortController().signal : signal,
          () => commitCollectionResult(command.replaceAll('.', ' ')),
        )
      : { status: 'not-needed' };
  if (git.status === 'failed' && 'error' in git && git.error)
    warnings.push({
      ...git.error,
      details: { ...git.error.details, businessCommitted: true },
    });
  if (signal.aborted && !error)
    error = {
      code: 'execution.interrupted',
      message: 'The operation was interrupted.',
      details: {},
      retry: 'inspect-state',
    };
  return {
    result: { items: plans.map((plan) => plan.item), git },
    warnings,
    ...(error
      ? { error, exitCode: signal.aborted ? 130 : 1, partial: changed }
      : {}),
  };
}

export function conflictItem(
  item: Record<string, unknown>,
  code: string,
  details: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...item,
    status: 'conflict',
    error: {
      code,
      message: 'The selected operation conflicts with existing data.',
      details,
      retry: 'after-fix',
    },
  };
}

export function requireAuthorization(
  yes: boolean,
  dryRun: boolean,
  names: string[],
): void {
  if (!yes && !dryRun)
    throw new OperationFailure(
      'usage.confirmationRequired',
      'This operation requires explicit deletion authorization.',
      { requiredFlags: ['--yes'], names },
    );
}
