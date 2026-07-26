/**
 * Terminal mouse report parsing (SGR + legacy).
 * Architecture inspired by @ink-tools/ink-mouse / xterm-mouse; copy-owned.
 */

/** True when stdin chunk is (or contains) a mouse report — do not treat as key text. */
export function isMouseInput(input: string): boolean {
  // Ink useInput strips leading ESC; raw stdin keeps it.
  return (
    /(?:\u001B)?\[<\d+;\d+;\d+[Mm]/.test(input) ||
    /(?:\u001B)?\[M[\s\S]/.test(input) ||
    input.startsWith('[<') ||
    input.startsWith('[M')
  );
}

export type ParsedMousePress = {
  x: number;
  y: number;
  button: 'left' | 'middle' | 'right';
};

/**
 * SGR: CSI < button ; col ; row M/m
 * Legacy: CSI M Cg Cx Cy (coords = byte - 32)
 * Ink may strip the leading ESC before handlers see the chunk.
 */
const SGR = /(?:\u001B)?\[<(\d+);(\d+);(\d+)([Mm])/g;
const LEGACY = /(?:\u001B)?\[M([\s\S]{3})/g;

/** Left-button presses only (hover/move ignored). Coordinates 1-based. */
export function parseLeftPresses(input: string): ParsedMousePress[] {
  // Fresh /g regexes per call — avoid lastIndex races under parallel tests.
  const sgr = new RegExp(SGR.source, 'g');
  const legacy = new RegExp(LEGACY.source, 'g');
  const out: ParsedMousePress[] = [];
  for (const match of input.matchAll(sgr)) {
    const code = Number(match[1]);
    const x = Number(match[2]);
    const y = Number(match[3]);
    const press = match[4] === 'M';
    if (!press || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    // Low 2 bits = button; bit 5 (32) = motion; 64+ = wheel.
    if ((code & 32) !== 0 || (code & 64) !== 0) continue;
    const buttonBits = code & 3;
    if (buttonBits !== 0) continue;
    out.push({ x, y, button: 'left' });
  }
  for (const match of input.matchAll(legacy)) {
    const bytes = match[1];
    if (!bytes || bytes.length < 3) continue;
    const cb = bytes.charCodeAt(0) - 32;
    const x = bytes.charCodeAt(1) - 32;
    const y = bytes.charCodeAt(2) - 32;
    if ((cb & 3) !== 0 || (cb & 32) !== 0) continue;
    out.push({ x, y, button: 'left' });
  }
  return out;
}
