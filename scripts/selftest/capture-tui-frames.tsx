/**
 * Dev-only: capture OpenTUI frames for browser surfaces and print issues.
 * Run: bun ./scripts/selftest/capture-tui-frames.tsx
 */
import { testRender } from '@opentui/react/test-utils';
import { act, type ReactNode } from 'react';
import { writeFileSync } from 'node:fs';
import { ExitProvider } from '../../src/ui/tui/hooks.js';
import {
  BrowserHarness,
  collectedFixture,
  skillFixture,
} from '../../test/helpers/browser-harness.js';

const SCRATCH =
  process.env.SCRATCH ||
  '/var/folders/0h/hrn9lk3s4ws_8r3h_z5_czyw0000gn/T/grok-goal-73ae6498e768/implementer';

async function capture(
  label: string,
  tree: ReactNode,
  keys: string[] = []
): Promise<{ label: string; frame: string }> {
  const setup = await testRender(
    <ExitProvider exit={() => undefined}>{tree}</ExitProvider>,
    { width: 100, height: 24, useMouse: false, exitOnCtrlC: false }
  );
  await act(async () => {
    await setup.renderOnce();
  });
  await new Promise((r) => setTimeout(r, 80));
  await act(async () => {
    await setup.renderOnce();
  });

  for (const key of keys) {
    await act(async () => {
      if (key === 'enter') setup.mockInput.pressEnter();
      else if (key === 'escape') setup.mockInput.pressEscape();
      else if (key === 'up') setup.mockInput.pressArrow('up');
      else if (key === 'down') setup.mockInput.pressArrow('down');
      else if (key === 'left') setup.mockInput.pressArrow('left');
      else if (key === 'right') setup.mockInput.pressArrow('right');
      else await setup.mockInput.typeText(key);
      await setup.renderOnce();
    });
    await new Promise((r) => setTimeout(r, 40));
  }
  await act(async () => {
    await setup.renderOnce();
  });
  const frame = setup.captureCharFrame();
  setup.renderer.destroy();
  return { label, frame };
}

const collection = [
  collectedFixture('alpha-skill', { description: 'Alpha description for browser' }),
  collectedFixture('beta-helper', { description: 'Beta helper tool' }),
  collectedFixture('gamma-long-name-skill-for-layout', {
    description: 'Long name layout probe',
  }),
];

const results = [];
results.push(
  await capture(
    'browser-default',
    <BrowserHarness
      state={{
        tab: 'collection',
        query: '',
        cursor: 0,
        selected: [],
        agent: '',
        focus: 'list',
      }}
      collection={collection}
    />
  )
);

results.push(
  await capture(
    'browser-filter',
    <BrowserHarness
      state={{
        tab: 'collection',
        query: '',
        cursor: 0,
        selected: [],
        agent: '',
        focus: 'list',
      }}
      collection={collection}
    />,
    ['/', 'a', 'l', 'p']
  )
);

results.push(
  await capture(
    'browser-help',
    <BrowserHarness
      state={{
        tab: 'collection',
        query: '',
        cursor: 0,
        selected: [],
        agent: '',
        focus: 'list',
      }}
      collection={collection}
    />,
    ['?']
  )
);

results.push(
  await capture(
    'browser-enter-detail',
    <BrowserHarness
      state={{
        tab: 'collection',
        query: '',
        cursor: 0,
        selected: [],
        agent: '',
        focus: 'list',
      }}
      collection={collection}
    />,
    ['enter']
  )
);

results.push(
  await capture(
    'browser-project',
    <BrowserHarness
      state={{
        tab: 'project',
        query: '',
        cursor: 0,
        selected: [],
        agent: '',
        focus: 'list',
      }}
      projectGroups={[
        {
          agent: '本地',
          skills: [skillFixture('proj-skill', { description: 'Project skill' })],
        },
      ]}
      collection={collection}
    />
  )
);

let report = '';
const allIssues: string[] = [];
for (const r of results) {
  report += `\n======== ${r.label} ========\n`;
  report += r.frame;
  report += '\n';
  const lines = r.frame.split('\n');
  report += `--- stats: lines=${lines.length} nonEmpty=${lines.filter((l) => l.trim()).length} width=${Math.max(...lines.map((l) => l.length), 0)}\n`;
  const issues: string[] = [];
  if (!/收藏夹|当前项目|全局|加载/.test(r.frame)) issues.push('missing tab bar');
  if (
    r.label === 'browser-default' &&
    !/alpha-skill|beta-helper|gamma/.test(r.frame)
  ) {
    issues.push('missing skill names');
  }
  if (r.label === 'browser-filter' && !/筛选/.test(r.frame)) {
    issues.push('filter bar missing after /');
  }
  if (r.label === 'browser-help' && !/快捷键|帮助/.test(r.frame)) {
    issues.push('help overlay missing after ?');
  }
  if (
    r.label === 'browser-enter-detail' &&
    !/备注|来源|‹|alpha-skill/.test(r.frame)
  ) {
    issues.push('detail view weak/missing');
  }
  if (r.frame.includes('\uFFFD')) issues.push('replacement chars (encoding)');
  if (
    /lpha-skill|eta-helper|amma-long/.test(r.frame) &&
    !/alpha-skill|beta-helper|gamma-long/.test(r.frame)
  ) {
    issues.push('leading character clip on skill names');
  }
  // Blank-heavy frame
  const nonEmpty = lines.filter((l) => l.trim()).length;
  if (nonEmpty < 3) issues.push('almost blank frame');
  report += `ISSUES: ${issues.length ? issues.join('; ') : 'none detected'}\n`;
  for (const i of issues) allIssues.push(`${r.label}: ${i}`);
}

report += `\n======== SUMMARY ========\n`;
report += allIssues.length
  ? allIssues.map((i) => `- ${i}`).join('\n')
  : 'No automated issues detected\n';

writeFileSync(`${SCRATCH}/tui-browser.log`, report);
writeFileSync(
  `${SCRATCH}/tui-secondary.log`,
  results
    .filter((r) => r.label !== 'browser-default')
    .map((r) => `======== ${r.label} ========\n${r.frame}\n`)
    .join('\n')
);
console.log(report);
console.log('WROTE', `${SCRATCH}/tui-browser.log`);
