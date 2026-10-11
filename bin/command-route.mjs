/** Select the process entry before loading any terminal runtime. */
export function isNonInteractiveCommand(argv) {
  const hasHelpFlag = argv.includes('-h') || argv.includes('--help');
  const tokens = ['help', '-h', '--help'].includes(argv[0]) ? argv.slice(1) : argv.filter((token) => !['-h', '--help'].includes(token));
  const [command, action] = tokens;
  if (['skill', 'collection', 'agents', 'status'].includes(command)) return true;
  if (command === 'help') return ['skill', 'mcp', 'collection', 'config', 'agents', 'status'].includes(action);
  if (['mcp', 'config'].includes(command)) {
    if (command === 'config' && hasHelpFlag && !action) return false;
    if (command === 'mcp' && hasHelpFlag && !action) return false;
    return Boolean(action);
  }
  if (!command || ['search', 'import', 'help', '-h', '--help', '-v', '--version'].includes(command)) return false;
  return true;
}
