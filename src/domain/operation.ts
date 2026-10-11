export type Retry = 'safe' | 'after-fix' | 'inspect-state';
export interface OperationError {
  code: string;
  message: string;
  details: Record<string, unknown>;
  retry: Retry;
}

export class OperationFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
    readonly exitCode = 2,
    readonly retry: Retry = 'after-fix',
  ) {
    super(message);
    this.name = 'OperationFailure';
  }
}

export interface OperationResult {
  result: Record<string, unknown>;
  warnings?: OperationError[];
  error?: OperationError;
  exitCode?: number;
  partial?: boolean;
}

/** Public diagnostics never expose raw I/O messages, which may include credentials. */
export function operationError(error: unknown, stage = 'read'): OperationError {
  if (error instanceof OperationFailure) {
    return {
      code: error.code,
      message: error.message,
      details: error.details,
      retry: error.retry,
    };
  }
  const cause = error as {
    code?: unknown;
    name?: unknown;
    params?: Record<string, string | number>;
  };
  if (
    typeof cause?.code === 'string' &&
    [
      'domain.unsafeSkillName',
      'domain.unsafeSourcePath',
      'domain.invalidTagName',
      'cmd.invalidGitSource',
    ].includes(cause.code)
  ) {
    return {
      code: 'usage.invalidArguments',
      message: 'An argument is invalid.',
      details: { cause: cause.code },
      retry: 'after-fix',
    };
  }
  if (
    typeof cause?.code === 'string' &&
    [
      'domain.symlinkEscapesTree',
      'domain.cyclicSymlink',
      'domain.mergeNotValidSkill',
    ].includes(cause.code)
  ) {
    return {
      code: 'source.invalidSkill',
      message: 'The skill tree is invalid.',
      details: { cause: cause.code, path: cause.params?.path },
      retry: 'after-fix',
    };
  }
  const rollback =
    typeof cause?.code === 'string' && /rollback/i.test(cause.code);
  return {
    code: rollback ? 'execution.rollbackFailed' : `execution.${stage}Failed`,
    message: rollback
      ? 'The operation could not be restored.'
      : `The ${stage} operation failed.`,
    details: {
      stage,
      ...(typeof cause?.code === 'string' ? { cause: cause.code } : {}),
      ...Object.fromEntries(
        Object.entries(cause?.params ?? {}).filter(([key]) =>
          ['path', 'target', 'backup', 'name', 'commit', 'ref'].includes(key),
        ),
      ),
    },
    retry: rollback ? 'inspect-state' : 'after-fix',
  };
}

export function redactOutput(value: unknown): unknown {
  if (typeof value === 'string') {
    if (knownSecrets.has(value)) return '[redacted]';
    let text = value;
    for (const secret of knownSecrets)
      if (secret.length >= 4) text = text.split(secret).join('[redacted]');
    return text.replace(/(?:https?|ssh):\/\/[^\s<>"']+/g, (input) => {
      try {
        const url = new URL(input);
        url.username = '';
        url.password = '';
        url.search = '';
        return url.toString();
      } catch {
        return '[redacted-url]';
      }
    });
  }
  if (Array.isArray(value)) return value.map(redactOutput);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, redactOutput(child)]),
    );
  }
  return value;
}

const knownSecrets = new Set<string>();

/** Values never become diagnostics; this catches a value repeated in freeform metadata. */
export function registerSecrets(values: {
  env: Record<string, string>;
  headers: Record<string, string>;
  url?: string;
}): void {
  for (const value of [
    ...Object.values(values.env),
    ...Object.values(values.headers),
  ])
    if (value) knownSecrets.add(value);
  if (values.url) knownSecrets.add(values.url);
}
