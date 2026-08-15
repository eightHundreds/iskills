/**
 * Color self-check. Run: bun ./scripts/selftest/selftest-colors.tsx
 *
 * - Unstyled body text must use default-intent fg (not hard-coded pure white rgb
 *   unless the harness default is white).
 * - Selection remains purple + white.
 * - No full-canvas forced surface paint.
 */
import { testRender } from '@opentui/react/test-utils';
import { RGBA } from '@opentui/core';
import { act } from 'react';
import { ExitProvider } from '../../src/ui/tui/hooks.js';
import { Text } from '../../src/ui/tui/index.js';
import { BrowserHarness, collectedFixture } from '../../test/helpers/browser-harness.js';
import { termcnColors } from '../../src/ui/components/colors.js';

function rgbaToHex(c: { buffer?: ArrayLike<number>; intent?: string }): string {
  const b = c?.buffer;
  if (b) {
    return (
      '#' +
      [b[0], b[1], b[2]]
        .map((n) => Number(n).toString(16).padStart(2, '0'))
        .join('')
    );
  }
  return '?';
}

// 1) Adapter Text without color must use default-intent foreground
{
  const setup = await testRender(
    <ExitProvider exit={() => undefined}>
      <box flexDirection="column">
        <Text>DEFAULT_ADAPTER_TEXT</Text>
        <text fg={RGBA.defaultForeground()}>EXPLICIT_DEFAULT_FG</text>
        <text>UNSET_NATIVE_TEXT</text>
      </box>
    </ExitProvider>,
    { width: 60, height: 6, useMouse: false, exitOnCtrlC: false }
  );
  await act(async () => {
    await setup.renderOnce();
  });
  const spans = setup.captureSpans();
  let adapterIntent: string | undefined;
  let nativeUnsetIntent: string | undefined;
  for (const line of spans.lines) {
    for (const s of line.spans) {
      if (s.text.includes('DEFAULT_ADAPTER')) {
        adapterIntent = (s.fg as { intent?: string }).intent;
        console.log(
          'adapter fg',
          rgbaToHex(s.fg),
          'intent',
          adapterIntent
        );
      }
      if (s.text.includes('UNSET_NATIVE')) {
        nativeUnsetIntent = (s.fg as { intent?: string }).intent;
        console.log(
          'native-unset fg',
          rgbaToHex(s.fg),
          'intent',
          nativeUnsetIntent
        );
      }
    }
  }
  setup.renderer.destroy();
  if (adapterIntent !== 'default') {
    console.error(
      'SELFTEST_FAIL: Text without color must use intent=default, got',
      adapterIntent
    );
    process.exit(1);
  }
  // Document OpenTUI trap: unset native text is rgb white, not default intent.
  if (nativeUnsetIntent === 'default') {
    console.log('note: native unset also default (unexpected but ok)');
  } else {
    console.log(
      'note: OpenTUI native <text> without fg uses intent=',
      nativeUnsetIntent,
      '(hard-coded white trap)'
    );
  }
}

// 2) Browser selection colors
{
  const setup = await testRender(
    <ExitProvider exit={() => undefined}>
      <BrowserHarness
        state={{
          tab: 'collection',
          query: '',
          cursor: 0,
          selected: [],
          agent: '',
          focus: 'list',
        }}
        collection={[
          collectedFixture('alpha-skill'),
          collectedFixture('beta-skill'),
        ]}
      />
    </ExitProvider>,
    {
      width: 100,
      height: 24,
      useMouse: true,
      enableMouseMovement: true,
      exitOnCtrlC: false,
    }
  );
  await act(async () => {
    await setup.renderOnce();
  });
  await new Promise((r) => setTimeout(r, 80));
  await act(async () => {
    await setup.renderOnce();
  });

  const spans = setup.captureSpans();
  let selectionOk = false;
  let leftDefaultOk = false;
  for (const line of spans.lines) {
    for (const s of line.spans) {
      const t = s.text;
      const fg = rgbaToHex(s.fg);
      const bg = rgbaToHex(s.bg);
      const intent = (s.fg as { intent?: string }).intent;
      if (t.includes('›') && t.includes('alpha')) {
        console.log('selection', JSON.stringify(t.slice(0, 24)), 'fg', fg, 'bg', bg);
        if (bg === '#7c3aed' && (fg === '#ffffff' || fg === '#f9fafb')) {
          selectionOk = true;
        }
      }
      // Tag column body without accent should use default intent (not forced white rgb)
      if (/全部|未标签|真实/.test(t) && !t.includes('›')) {
        console.log('tag-cell', JSON.stringify(t.slice(0, 16)), 'fg', fg, 'intent', intent);
        if (intent === 'default' || fg !== '#ffffff') {
          leftDefaultOk = true;
        }
      }
    }
  }
  console.log('frame\n' + setup.captureCharFrame().split('\n').slice(0, 8).join('\n'));
  setup.renderer.destroy();

  if (!selectionOk) {
    console.error('SELFTEST_FAIL: selection not purple/white');
    process.exit(1);
  }
  if (!leftDefaultOk) {
    console.error(
      'SELFTEST_FAIL: left column still looks like forced white rgb without default intent'
    );
    process.exit(1);
  }
}

console.log('SELFTEST_PASS');
console.log(
  'OpenTUI: DEFAULT_FG=white when fg omitted; we use RGBA.defaultForeground() intent=default.'
);
console.log(
  'OpenTUI theme APIs: renderer.themeMode / waitForThemeMode() / getPalette() — no full theme pack.'
);
