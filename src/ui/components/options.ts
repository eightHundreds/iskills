import { useReducer } from 'react';

export interface Option<T> {
  value: T;
  label: string;
  hint?: string;
}

export interface InternalOption {
  value: string;
  label: string;
}

interface WindowState {
  focus: number;
  from: number;
}

type WindowAction = { type: 'next' | 'previous'; length: number; count: number };

export function visibleOptionCount(rows: number, label?: string): number {
  return Math.max(3, rows - (label ? 5 : 4));
}

/** Map product options to string-indexed list rows for MultiSelect. */
export function toListOptions<T>(options: Option<T>[], numbered = false): InternalOption[] {
  return options.map((option, index) => ({
    value: String(index),
    label: `${numbered ? `${index + 1}. ` : ''}${option.label}${option.hint ? ` — ${option.hint}` : ''}`,
  }));
}

export function resolveOptionValues<T>(options: Option<T>[], values: string[]): T[] {
  return values.flatMap((value) => {
    const index = Number(value);
    const option = options[index];
    return option ? [option.value] : [];
  });
}

/** Circular list index; works for negative deltas. */
export function wrapListIndex(index: number, length: number, delta: number): number {
  if (length <= 0) return 0;
  return ((index + delta) % length + length) % length;
}

export function resolveOptionValue<T>(options: Option<T>[], value: string): T | undefined {
  const index = Number(value);
  return options[index]?.value;
}

function windowReducer(state: WindowState, action: WindowAction): WindowState {
  const focus = Math.min(state.focus, Math.max(0, action.length - 1));
  if (action.type === 'next') {
    const next = Math.min(action.length - 1, focus + 1);
    const from = next >= state.from + action.count ? next - action.count + 1 : state.from;
    return { focus: next, from };
  }
  const previous = Math.max(0, focus - 1);
  const from = previous < state.from ? previous : state.from;
  return { focus: previous, from };
}

// A reducer keeps quick successive keypresses from reading a stale focus value.
/** Toggle membership of `value` in a selection set (Space multi-select). */
export function toggleSelection(previous: Set<string>, value: string): Set<string> {
  const next = new Set(previous);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export function useScrollWindow(length: number, visibleCount: number): {
  count: number;
  focus: number;
  from: number;
  focusNext: () => void;
  focusPrevious: () => void;
} {
  const count = Math.max(1, Math.min(visibleCount, Math.max(1, length)));
  const [state, dispatch] = useReducer(windowReducer, { focus: 0, from: 0 });
  const focus = Math.min(state.focus, Math.max(0, length - 1));
  const from = Math.max(0, Math.min(state.from, Math.max(0, length - count)));
  return {
    count,
    focus,
    from,
    focusNext: () => dispatch({ type: 'next', length, count }),
    focusPrevious: () => dispatch({ type: 'previous', length, count }),
  };
}
