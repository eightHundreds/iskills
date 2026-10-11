import { DomainError } from '../domain/errors.js';

/** Bare mcp is the retained human entry; all actions route before the TUI loads. */
export async function commandMcp(argv: string[]): Promise<void> {
  if (argv.length) throw new DomainError('cli.unknownMcpCommand', { command: argv[0]! });
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new DomainError('mcp.ttyRequired');
  const { runMcpBrowserApp } = await import('../ui/mcp/index.js');
  await runMcpBrowserApp();
}
