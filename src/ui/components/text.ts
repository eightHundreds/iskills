const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function graphemes(value: string): string[] {
  return [...segmenter.segment(value)].map((part) => part.segment);
}

export function isReturn(input: string, keyReturn: boolean): boolean {
  return keyReturn || input.includes('\r') || input.includes('\n');
}
