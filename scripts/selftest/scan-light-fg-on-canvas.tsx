/**
 * Scan for unreadable light-on-light (or forced light body) on main canvas.
 * Light fg on dark selection/modal panel is OK.
 *
 * Run: bun ./scripts/selftest/scan-light-fg-on-canvas.tsx
 */
import { testRender } from '@opentui/react/test-utils';
import { act, type ReactNode } from 'react';
import { ExitProvider } from '../../src/ui/tui/hooks.js';
import {
  BrowserHarness,
  collectedFixture,
  skillFixture,
} from '../../test/helpers/browser-harness.js';
import { SkillMultiSelect } from '../../src/ui/import/skill-select.js';
import { MultiSelect } from '../../src/ui/components/multi-select.js';
import { Select } from '../../src/ui/components/select.js';
import { InstallReview } from '../../src/ui/install/index.js';
import { termcnColors } from '../../src/ui/components/colors.js';

function channels(c: { buffer?: ArrayLike<number> }): [number, number, number] {
  const b = c?.buffer;
  if (!b) return [0, 0, 0];
  return [Number(b[0]), Number(b[1]), Number(b[2])];
}

function hex(c: { buffer?: ArrayLike<number> }): string {
  const [r, g, b] = channels(c);
  return (
    '#' +
    [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')
  );
}

/** Relative luminance 0–1 (sRGB). */
function lum(c: { buffer?: ArrayLike<number> }): number {
  const [R, G, B] = channels(c).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrast(a: { buffer?: ArrayLike<number> }, b: { buffer?: ArrayLike<number> }): number {
  const L1 = lum(a);
  const L2 = lum(b);
  const hi = Math.max(L1, L2);
  const lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
}

async function scan(label: string, tree: ReactNode): Promise<string[]> {
  const setup = await testRender(
    <ExitProvider exit={() => undefined}>{tree}</ExitProvider>,
    {
      width: 100,
      height: 28,
      useMouse: true,
      enableMouseMovement: true,
      exitOnCtrlC: false,
    }
  );
  await act(async () => {
    await setup.renderOnce();
  });
  await new Promise((r) => setTimeout(r, 60));
  await act(async () => {
    await setup.renderOnce();
  });
  const issues: string[] = [];
  const spans = setup.captureSpans();
  for (const line of spans.lines) {
    for (const s of line.spans) {
      const t = s.text.trim();
      if (!t || t.length < 2) continue;
      if (/^[│─┬┴╭╮╰╯\s·]+$/.test(t)) continue;
      const ratio = contrast(s.fg, s.bg);
      // WCAG-ish: flag very weak contrast on non-empty text
      if (ratio < 2.2) {
        issues.push(
          `${label}: low contrast ${ratio.toFixed(2)} fg=${hex(s.fg)} bg=${hex(s.bg)} text=${JSON.stringify(t.slice(0, 36))}`
        );
      }
      // Forced light body on near-black-only when not selection (legacy bug pattern)
      const fgL = lum(s.fg);
      const bgL = lum(s.bg);
      if (fgL > 0.85 && bgL > 0.75) {
        issues.push(
          `${label}: light-on-light fg=${hex(s.fg)} bg=${hex(s.bg)} text=${JSON.stringify(t.slice(0, 36))}`
        );
      }
    }
  }
  setup.renderer.destroy();
  return issues;
}

const collection = [
  collectedFixture('alpha-skill', { description: 'Alpha description' }),
  collectedFixture('beta-skill', { description: 'Beta description' }),
];

const all: string[] = [];
all.push(
  ...(await scan(
    'browser',
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
  ))
);
all.push(
  ...(await scan(
    'multi-select',
    <MultiSelect
      label="选择多个"
      options={[
        { label: '第一项', value: 'a' },
        { label: '第二项', value: 'b' },
      ]}
      onSubmit={() => {}}
    />
  ))
);
all.push(
  ...(await scan(
    'select',
    <Select
      label="选择一个"
      options={[
        { label: '第一项', value: 'a' },
        { label: '第二项', value: 'b' },
      ]}
      onSubmit={() => {}}
    />
  ))
);
all.push(
  ...(await scan(
    'skill-multi',
    <SkillMultiSelect
      groups={[
        {
          agent: '本地',
          options: [
            {
              skill: skillFixture('import-skill', {
                description: 'Import desc',
              }),
              agent: '本地',
            },
          ],
        },
      ]}
      onCancel={() => {}}
      onSubmit={() => {}}
    />
  ))
);
all.push(
  ...(await scan(
    'install',
    <InstallReview
      skills={[skillFixture('entry-skill')]}
      targets={[
        {
          value: 'agents',
          projectLabel: '标准 Agent Skills (.agents/skills)',
          globalLabel: '标准 Agent Skills (~/.agents/skills)',
        },
      ]}
      defaultProjectAgents={['agents']}
      defaultGlobalAgents={[]}
      onSubmit={() => {}}
    />
  ))
);

// Static source scan for forbidden patterns on main canvas
const { execSync } = await import('node:child_process');
const staticHits = execSync(
  `grep -rn "termcnColors\\.foreground\\|colors\\.foreground" src --include='*.tsx' --include='*.ts' || true`,
  { encoding: 'utf8' }
)
  .trim()
  .split('\n')
  .filter((line) => line && !line.includes('colors.ts') && !line.includes('deprecated'));

if (staticHits.length) {
  for (const h of staticHits) all.push(`static: ${h}`);
}

if (all.length) {
  console.error('FOUND_ISSUES', all.length);
  for (const i of all.slice(0, 50)) console.error(i);
  process.exit(1);
}
console.log('SCAN_PASS: no light-on-light / forced foreground on main surfaces');
console.log('selection/modal panels may still use light text on dark solid bg');
void termcnColors;
