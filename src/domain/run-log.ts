/**
 * Process-local run-log recorder. Domain records events; CLI/UI owns write +
 * user-facing paths (`util/run-log-session.ts`).
 *
 * Same hook shape as `domainNotify`: default no-op until the CLI session
 * registers a recorder. Domain must not import i18n or write console output.
 */

export type RunLogLevel = 'info' | 'warn' | 'error';
export type RunLogExtra = Record<string, string | number>;
export type RunLogRecorder = (
  level: RunLogLevel,
  scope: string,
  message: string,
  extra?: RunLogExtra
) => void;

let recorder: RunLogRecorder = () => {
  /* no-op until CLI registers a session */
};

/** Register the process session that buffers events for a failure dump. */
export function setRunLogRecorder(fn: RunLogRecorder): void {
  recorder = fn;
}

/** Append one timeline event. Safe to call when no session is active. */
export function recordRunLog(
  level: RunLogLevel,
  scope: string,
  message: string,
  extra?: RunLogExtra
): void {
  recorder(level, scope, message, extra);
}
