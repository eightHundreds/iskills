/**
 * Terminal mouse report parsing (SGR + legacy).
 * Mouse SGR parse; copy-owned.
 */

/** True when stdin chunk is (or contains) a mouse report — do not treat as key text. */
export function isMouseInput(input: string): boolean {
  // Some consumers strip leading ESC; raw stdin keeps it.
  return (
    /(?:\u001B)?\[<\d+;\d+;\d+[Mm]/.test(input) ||
    /(?:\u001B)?\[M[\s\S]/.test(input) ||
    input.startsWith('[<') ||
    input.startsWith('[M')
  );
}

