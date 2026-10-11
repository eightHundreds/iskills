/** Select the process entry before loading any terminal runtime. */
export function isNonInteractiveCommand(argv) {
  const tokens = ['help', '-h', '--help'].includes(argv[0]) ? argv.slice(1) : argv;
  const [command, action] = tokens;
  if (['skill', 'collection', 'agents', 'status'].includes(command)) return true;
  if (command === 'help') return ['skill', 'mcp', 'collection', 'config', 'agents', 'status'].includes(action);
  if (['mcp', 'config'].includes(command)) return Boolean(action && !['-h', '--help'].includes(action));
  if (!command || ['search', 'import', 'help', '-h', '--help', '-v', '--version'].includes(command)) return false;
  if (command === '--help' || command === '-h') return true;
  return true;
}
