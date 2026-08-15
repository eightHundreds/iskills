/**
 * Launch `iskills mcp` under a PTY with fixture configs and dump visible frames.
 * Run: bun ./scripts/selftest/capture-mcp-tui.ts
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createCollectedMcp } from '../../src/domain/mcp/index.js';
import {
  makeContext,
  renderTerminalScreen,
  runInteractive,
  withCollectionEnvironment,
} from '../../test/helpers.js';

const outDir = join(process.cwd(), 'tmp/mcp-tui-frames');

async function dump(
  label: string,
  raw: string | undefined,
  size: { rows: number; columns: number }
): Promise<string> {
  const lines = await renderTerminalScreen(raw ?? '', size);
  const frame = lines.join('\n');
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, `${label}.txt`), `${frame}\n`, 'utf8');
  return frame;
}

async function seed(home: string, project: string): Promise<void> {
  await mkdir(home, { recursive: true });
  await writeFile(
    join(home, '.claude.json'),
    JSON.stringify(
      {
        theme: 'dark',
        mcpServers: {
          github: {
            type: 'http',
            url: 'https://api.githubcopilot.com/mcp/',
            headers: { Authorization: 'Bearer demo-token-not-real-0001' },
          },
          chrome: { command: 'npx', args: ['-y', 'chrome-devtools-mcp'] },
        },
      },
      null,
      2
    ),
    'utf8'
  );
  await mkdir(join(home, '.cursor'), { recursive: true });
  await writeFile(
    join(home, '.cursor/mcp.json'),
    JSON.stringify(
      {
        mcpServers: {
          Context7: { url: 'https://mcp.context7.com/mcp' },
        },
      },
      null,
      2
    ),
    'utf8'
  );
  await mkdir(join(home, '.pi/agent'), { recursive: true });
  await writeFile(
    join(home, '.pi/agent/mcp.json'),
    JSON.stringify({ imports: ['claude-code'], mcpServers: {} }, null, 2),
    'utf8'
  );
  await writeFile(
    join(project, '.mcp.json'),
    JSON.stringify(
      {
        mcpServers: {
          docs: { type: 'http', url: 'https://docs.example.com/mcp' },
        },
      },
      null,
      2
    ),
    'utf8'
  );
}

const size = { rows: 24, columns: 100 };

const context = await makeContext();
const frames: Record<string, string> = {};
try {
  await withCollectionEnvironment(context, async () => {
    await seed(context.home, context.project);
    await createCollectedMcp({
      name: 'filesystem',
      description: 'local files',
      tags: ['local'],
      note: 'demo',
      recipe: {
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
        envKeys: [],
        headerKeys: [],
      },
    });
    await createCollectedMcp({
      name: 'linear',
      recipe: {
        transport: 'http',
        url: 'https://mcp.linear.app/mcp',
        envKeys: [],
        headerKeys: ['Authorization'],
      },
    });
  });

  const collection = await runInteractive(
    context,
    ['mcp'],
    [
      { wait: 'filesystem', delay: 200 },
      { capture: 'collection', done: true },
    ],
    context.project,
    size
  );
  frames.collection = await dump('01-collection', collection.screens?.collection, size);

  const piView = await runInteractive(
    context,
    ['mcp'],
    [
      { wait: 'filesystem', delay: 150 },
      { send: '\x1b[D', enter: false },
      { wait: 'github', delay: 150 },
      { send: ']', enter: false },
      { delay: 80 },
      { send: ']', enter: false },
      { delay: 200 },
      { capture: 'pi', done: true },
    ],
    context.project,
    size
  );
  frames.pi = await dump('04-global-pi', piView.screens?.pi, size);

  const globalView = await runInteractive(
    context,
    ['mcp'],
    [
      { wait: 'filesystem', delay: 150 },
      { send: '\x1b[D', enter: false },
      { wait: 'github', delay: 200 },
      { capture: 'global', done: true },
    ],
    context.project,
    size
  );
  frames.global = await dump('02-global', globalView.screens?.global, size);

  const projectView = await runInteractive(
    context,
    ['mcp'],
    [
      { wait: 'filesystem', delay: 150 },
      { send: '\x1b[D', enter: false },
      { delay: 120 },
      { send: '\x1b[D', enter: false },
      { wait: 'docs', delay: 250 },
      { capture: 'project', done: true },
    ],
    context.project,
    size
  );
  frames.project = await dump('03-project', projectView.screens?.project, size);
} finally {
  const { rm } = await import('node:fs/promises');
  await rm(context.root, { recursive: true, force: true });
}

for (const [name, frame] of Object.entries(frames)) {
  console.log(`\n======== ${name} ========`);
  console.log(frame);
}
console.log(`\nwrote frames to ${outDir}`);
