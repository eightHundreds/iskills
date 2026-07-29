/**
 * Visual self-test for `?` help modal colors.
 * Opens help overlay, renders span capture to PNG.
 * Expects theme-aware solid panel (light or dark), not purple scrim.
 *
 * Run: bun ./scripts/selftest-help-modal-png.tsx
 */
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { act } from 'react';
import { testRender } from '@opentui/react/test-utils';
import {
  modalChromeByMode,
  termcnColors,
} from '../src/ui/components/colors.js';
import { ExitProvider } from '../src/ui/tui/hooks.js';
import {
  BrowserHarness,
  collectedFixture,
} from '../test/browser-harness.js';

const OUT_DIR = path.resolve('.tmp-selftest');
const CELL_W = 9;
const CELL_H = 18;

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
    }
  }
  return ~c >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crcBuf = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcBuf));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function writePng(filePath: string, width: number, height: number, rgba: Buffer): void {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  createWriteStream(filePath).end(png);
}

function rgbaHex(c: {
  buffer?: ArrayLike<number>;
  r?: number;
  g?: number;
  b?: number;
}): [number, number, number] {
  const buf = c?.buffer;
  if (buf && buf.length >= 3) {
    return [Number(buf[0]) | 0, Number(buf[1]) | 0, Number(buf[2]) | 0];
  }
  return [0, 0, 0];
}

function hexClose(
  a: [number, number, number],
  b: [number, number, number],
  tol = 24
): boolean {
  return (
    Math.abs(a[0] - b[0]) <= tol &&
    Math.abs(a[1] - b[1]) <= tol &&
    Math.abs(a[2] - b[2]) <= tol
  );
}

function parseHex(h: string): [number, number, number] {
  const s = h.replace('#', '');
  return [
    Number.parseInt(s.slice(0, 2), 16),
    Number.parseInt(s.slice(2, 4), 16),
    Number.parseInt(s.slice(4, 6), 16),
  ];
}

await mkdir(OUT_DIR, { recursive: true });

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
      collection={Array.from({ length: 8 }, (_, i) =>
        collectedFixture(`overlay-${i}`)
      )}
    />
  </ExitProvider>,
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
  await setup.mockInput.typeText('?');
  await setup.renderOnce();
});
await new Promise((r) => setTimeout(r, 80));
await act(async () => {
  await setup.renderOnce();
});

const frame = setup.captureCharFrame();
const spans = setup.captureSpans();
const rows = spans.lines.length;
const cols = Math.max(
  ...spans.lines.map((line) =>
    line.spans.reduce((n, s) => n + [...s.text].length, 0)
  ),
  1
);

const rgba = Buffer.alloc(cols * CELL_W * rows * CELL_H * 4, 255);
const bgCounts = new Map<string, number>();
let totalCells = 0;
let panelCells = 0;
let scrimCells = 0;
const lightRgb = parseHex(modalChromeByMode.light.surface);
const darkRgb = parseHex(modalChromeByMode.dark.surface);
const scrimRgb = parseHex(termcnColors.modalScrim);

for (let y = 0; y < rows; y++) {
  let x = 0;
  const line = spans.lines[y];
  if (!line) continue;
  for (const span of line.spans) {
    const bg = rgbaHex(span.bg);
    const key = `#${bg.map((n) => n.toString(16).padStart(2, '0')).join('')}`;
    const chars = [...span.text];
    for (const ch of chars) {
      totalCells++;
      bgCounts.set(key, (bgCounts.get(key) ?? 0) + 1);
      if (hexClose(bg, lightRgb, 32) || hexClose(bg, darkRgb, 32)) panelCells++;
      if (hexClose(bg, scrimRgb, 16)) scrimCells++;
      for (let dy = 0; dy < CELL_H; dy++) {
        for (let dx = 0; dx < CELL_W; dx++) {
          const px = (y * CELL_H + dy) * (cols * CELL_W) + (x * CELL_W + dx);
          const o = px * 4;
          rgba[o] = bg[0];
          rgba[o + 1] = bg[1];
          rgba[o + 2] = bg[2];
          rgba[o + 3] = 255;
        }
      }
      if (ch.trim()) {
        const fg = rgbaHex(span.fg);
        for (let dy = 4; dy < CELL_H - 4; dy++) {
          for (let dx = 2; dx < CELL_W - 2; dx++) {
            const px = (y * CELL_H + dy) * (cols * CELL_W) + (x * CELL_W + dx);
            const o = px * 4;
            rgba[o] = fg[0];
            rgba[o + 1] = fg[1];
            rgba[o + 2] = fg[2];
          }
        }
      }
      x++;
    }
  }
}

const pngPath = path.join(OUT_DIR, 'help-modal-selftest.png');
const txtPath = path.join(OUT_DIR, 'help-modal-selftest.txt');
writePng(pngPath, cols * CELL_W, rows * CELL_H, rgba);
await Bun.write(txtPath, frame);

const topBgs = [...bgCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
const scrimShare = totalCells ? scrimCells / totalCells : 1;

console.log('frame_preview\n' + frame.split('\n').slice(0, 18).join('\n'));
console.log('png', pngPath);
console.log('txt', txtPath);
console.log('bg_top', topBgs);
console.log('panelCells', panelCells, 'scrimShare', scrimShare.toFixed(3));

setup.renderer.destroy();

const ok =
  frame.includes('完整快捷键') &&
  panelCells > 0 &&
  scrimShare < 0.15;

if (!ok) {
  console.error(
    'SELFTEST_FAIL help modal needs themed solid panel without scrim wash'
  );
  process.exit(1);
}
console.log('SELFTEST_PASS help modal theme-aware solid panel');
