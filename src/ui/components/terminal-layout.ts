import stringWidth from 'string-width';
import { graphemes } from './text.js';

export function textWidth(value: string): number {
  return stringWidth(value);
}

export function sliceColumns(value: string, start: number, end: number): string {
  let column = 0;
  let result = '';
  for (const grapheme of graphemes(value)) {
    const width = textWidth(grapheme);
    const next = column + width;
    if (next > start && column < end) result += grapheme;
    column = next;
    if (column >= end) break;
  }
  return result;
}

export function padColumns(value: string, width: number): string {
  return `${value}${' '.repeat(Math.max(0, width - textWidth(value)))}`;
}

export function wrapColumns(value: string, width: number): string[] {
  if (!value) return [''];
  const lines: string[] = [];
  let line = '';
  let columns = 0;
  for (const grapheme of graphemes(value)) {
    const graphemeColumns = textWidth(grapheme);
    if (line && columns + graphemeColumns > width) {
      lines.push(line);
      line = '';
      columns = 0;
    }
    line += grapheme;
    columns += graphemeColumns;
  }
  if (line) lines.push(line);
  return lines;
}
