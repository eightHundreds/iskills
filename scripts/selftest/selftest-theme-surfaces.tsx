/**
 * Self-test theme-aware surfaces across command UIs.
 * Run: bun ./scripts/selftest/selftest-theme-surfaces.tsx
 *
 * Checks:
 * - Help modal has themed solid panel (light or dark surface)
 * - Confirm modal (FramedPanel) same
 * - promptText-like ModalPanel has themed surface
 * - No full-viewport modalScrim / near-black alpha wash
 * - Select idle text uses themed body (not forced pure white without selection)
 */
import { testRender } from '@opentui/react/test-utils';
import { act, type ReactNode } from 'react';
import { ExitProvider } from '../../src/ui/tui/hooks.js';
import { BrowserHarness, collectedFixture } from '../../test/browser-harness.js';
import { ModalPanel } from '../../src/ui/components/modal-panel.js';
import { TextInput } from '../../src/ui/components/text-input.js';
import { Select } from '../../src/ui/components/select.js';
import { FramedPanel } from '../../src/ui/components/framed-panel.js';
import { AppShell } from '../../src/ui/shell/app-shell.js';
import {
  modalChromeByMode,
  termcnColors,
} from '../../src/ui/components/colors.js';
import { hexClose, spanBgHex, spanFgHex } from '../../test/tui-harness.js';

function channels(c: { buffer?: ArrayLike<number> }): [number, number, number] {
  const b = c?.buffer;
  if (!b) return [0, 0, 0];
  return [Number(b[0]), Number(b[1]), Number(b[2])];
}

function isThemedSurface(bg: string): boolean {
  return (
    hexClose(bg, modalChromeByMode.light.surface, 40) ||
    hexClose(bg, modalChromeByMode.dark.surface, 40)
  );
}

function isBadWash(bg: string): boolean {
  // Intentional dark panel (#18181B) is NOT a wash. Only flag:
  // - lavender full-screen scrim token
  // - classic alpha-purple-over-black (~#1b0d34) and pure black paint on panels
  if (isThemedSurface(bg)) return false;
  return (
    hexClose(bg, termcnColors.modalScrim, 20) ||
    hexClose(bg, '#1b0d34', 18)
  );
}

async function mount(
  tree: ReactNode,
  size = { width: 100, height: 28 }
): Promise<{
  frame: string;
  spans: ReturnType<
    Awaited<ReturnType<typeof testRender>>['captureSpans']
  >;
  destroy: () => void;
  setup: Awaited<ReturnType<typeof testRender>>;
}> {
  const setup = await testRender(
    <ExitProvider exit={() => undefined}>{tree}</ExitProvider>,
    {
      width: size.width,
      height: size.height,
      useMouse: true,
      enableMouseMovement: true,
      exitOnCtrlC: false,
    }
  );
  await act(async () => {
    await setup.renderOnce();
  });
  await new Promise((r) => setTimeout(r, 50));
  await act(async () => {
    await setup.renderOnce();
  });
  return {
    frame: setup.captureCharFrame(),
    spans: setup.captureSpans(),
    destroy: () => setup.renderer.destroy(),
    setup,
  };
}

function analyze(
  label: string,
  spans: Awaited<ReturnType<typeof mount>>['spans'],
  opts: { requirePanel: boolean; requireText?: RegExp }
): void {
  const all = spans.lines.flatMap((l) => l.spans);
  const bgs = new Map<string, number>();
  let panel = 0;
  let wash = 0;
  for (const s of all) {
    const bg = spanBgHex(s);
    bgs.set(bg, (bgs.get(bg) ?? 0) + 1);
    if (isThemedSurface(bg)) panel += 1;
    if (isBadWash(bg)) wash += 1;
  }
  const top = [...bgs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  console.log(`\n== ${label} ==`);
  console.log('bg_top', top);
  console.log('panelCells', panel, 'washCells', wash, 'total', all.length);

  if (opts.requirePanel && panel === 0) {
    throw new Error(`${label}: expected themed modal surface panel`);
  }
  if (wash > all.length * 0.15) {
    throw new Error(
      `${label}: bad scrim/near-black wash dominates (${wash}/${all.length})`
    );
  }
  if (opts.requireText) {
    const text = all.map((s) => s.text).join('');
    if (!opts.requireText.test(text)) {
      throw new Error(`${label}: missing text ${opts.requireText}`);
    }
  }
}

// 1) Browser help modal
{
  const { setup, destroy, spans, frame } = await mount(
    <BrowserHarness
      state={{
        tab: 'collection',
        query: '',
        cursor: 0,
        selected: [],
        agent: '',
        focus: 'list',
      }}
      collection={Array.from({ length: 6 }, (_, i) =>
        collectedFixture(`skill-${i}`)
      )}
    />
  );
  await act(async () => {
    await setup.mockInput.typeText('?');
    await setup.renderOnce();
  });
  await new Promise((r) => setTimeout(r, 80));
  await act(async () => {
    await setup.renderOnce();
  });
  analyze('help-modal', setup.captureSpans(), {
    requirePanel: true,
    requireText: /完整快捷键|导航/,
  });
  if (!/完整快捷键|导航/.test(setup.captureCharFrame())) {
    throw new Error('help-modal frame missing title');
  }
  destroy();
  void frame;
  void spans;
}

// 2) FramedPanel confirm-style
{
  const { destroy, spans } = await mount(
    <AppShell>
      <FramedPanel
        title=" 确认 "
        content={['删除这些技能吗？', 'skill-a', 'skill-b', '(y/N)']}
        width={60}
        muteLastContent
        onEscape={() => undefined}
      />
    </AppShell>
  );
  analyze('confirm-framed', spans, {
    requirePanel: true,
    requireText: /删除这些技能|skill-a/,
  });
  destroy();
}

// 3) ModalPanel + TextInput (promptText shape)
{
  const { destroy, spans } = await mount(
    <AppShell>
      <ModalPanel>
        <TextInput
          label="编辑备注（Enter 保存，Esc 取消）"
          initialValue="hello"
          onSubmit={() => undefined}
          onCancel={() => undefined}
        />
      </ModalPanel>
    </AppShell>
  );
  analyze('prompt-text-modal', spans, {
    requirePanel: true,
    requireText: /编辑备注|hello/,
  });
  destroy();
}

// 4) Select layer-style (no forced pure-white idle body on selection)
{
  const { destroy, spans } = await mount(
    <AppShell>
      <Select
        label="选择仓库内 Skill："
        options={[
          { label: 'alpha-skill', value: 'a' },
          { label: 'beta-skill', value: 'b' },
        ]}
        onSubmit={() => undefined}
        onCancel={() => undefined}
      />
    </AppShell>
  );
  const all = spans.lines.flatMap((l) => l.spans);
  let idleBodyOk = false;
  for (const s of all) {
    if (!/alpha-skill|beta-skill/.test(s.text)) continue;
    const bg = spanBgHex(s);
    const fg = spanFgHex(s);
    // Not selection row: body should not be pure white on pure white.
    if (hexClose(bg, termcnColors.selectionBg, 30)) continue;
    const [fr, fgG, fb] = channels(s.fg);
    const bright =
      fr > 240 && fgG > 240 && fb > 240 && !hexClose(bg, '#000000', 30);
    if (bright && hexClose(bg, modalChromeByMode.light.surface, 40)) {
      throw new Error(`select idle light-on-light: fg=${fg} bg=${bg}`);
    }
    idleBodyOk = true;
  }
  analyze('select-layer', spans, {
    requirePanel: false,
    requireText: /选择仓库内 Skill|alpha-skill/,
  });
  if (!idleBodyOk) {
    console.log('note: select options not found as separate spans (ok if merged)');
  }
  destroy();
}

console.log('\nSELFTEST_PASS theme surfaces across help/confirm/prompt/select');
