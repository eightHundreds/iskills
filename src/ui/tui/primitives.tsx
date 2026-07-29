/**
 * Text adapter over OpenTUI `<text>` / `<span>`.
 *
 * Keeps product-facing `color` / `bold` / wrap props and fixes two OpenTUI traps:
 * - unset fg defaults to hard-coded white (use RGBA.defaultForeground)
 * - inverse is unreliable with truecolor (map to selection tokens)
 *
 * Layout uses native OpenTUI `<box>` directly — no Box wrapper.
 */
import {
  createTextAttributes,
  RGBA,
  type ColorInput,
} from '@opentui/core';
import {
  createContext,
  useContext,
  type ReactNode,
} from 'react';
import { termcnColors } from '../components/colors.js';

const TextNestingContext = createContext(false);

function setIfDefined(
  target: Record<string, unknown>,
  key: string,
  value: unknown
): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

export type TextProps = {
  children?: ReactNode;
  color?: string;
  backgroundColor?: string;
  bold?: boolean;
  dimColor?: boolean;
  inverse?: boolean;
  underline?: boolean;
  wrap?: 'wrap' | 'truncate' | 'truncate-end' | 'truncate-middle' | 'end';
};

export function Text({
  children,
  color,
  backgroundColor,
  bold = false,
  dimColor = false,
  inverse = false,
  underline = false,
  wrap,
}: TextProps): ReactNode {
  const nested = useContext(TextNestingContext);
  const resolvedFg: ColorInput | undefined = inverse
    ? (color ?? termcnColors.selectionFg)
    : color !== undefined
      ? color
      : RGBA.defaultForeground();
  const resolvedBg = inverse
    ? (backgroundColor ?? termcnColors.selectionBg)
    : backgroundColor;
  const attributes = createTextAttributes({
    bold: bold || inverse,
    dim: dimColor,
    inverse: false,
    underline,
  });
  const truncate =
    wrap === 'truncate' || wrap === 'truncate-end' || wrap === 'end';

  if (nested) {
    const spanProps: Record<string, unknown> = {
      attributes,
      children,
    };
    setIfDefined(spanProps, 'fg', resolvedFg);
    setIfDefined(spanProps, 'bg', resolvedBg);
    return <span {...(spanProps as object)} />;
  }

  const textProps: Record<string, unknown> = {
    attributes,
    truncate,
    wrapMode: wrap === 'wrap' ? 'word' : 'none',
    children,
  };
  setIfDefined(textProps, 'fg', resolvedFg);
  setIfDefined(textProps, 'bg', resolvedBg);

  return (
    <TextNestingContext.Provider value={true}>
      <text {...(textProps as object)} />
    </TextNestingContext.Provider>
  );
}
