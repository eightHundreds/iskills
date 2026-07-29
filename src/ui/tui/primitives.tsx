/**
 * Ink-shaped Box/Text adapters over OpenTUI intrinsics.
 * Product UI keeps familiar props; layout/chrome may diverge from the Ink era.
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

export type BoxProps = {
  children?: ReactNode;
  flexDirection?: 'row' | 'column' | 'row-reverse' | 'column-reverse';
  display?: 'flex' | 'none';
  gap?: number;
  rowGap?: number;
  columnGap?: number;
  padding?: number;
  paddingX?: number;
  paddingY?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  margin?: number;
  marginX?: number;
  marginY?: number;
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  marginLeft?: number;
  width?: number | string;
  height?: number | string;
  minHeight?: number | string;
  maxHeight?: number | string;
  minWidth?: number | string;
  maxWidth?: number | string;
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: number | 'auto';
  alignItems?: 'flex-start' | 'flex-end' | 'center' | 'stretch' | 'baseline';
  justifyContent?:
    | 'flex-start'
    | 'flex-end'
    | 'center'
    | 'space-between'
    | 'space-around'
    | 'space-evenly';
  overflow?: 'visible' | 'hidden' | 'scroll';
  borderStyle?: 'single' | 'double' | 'round' | 'bold' | 'rounded' | 'heavy';
  borderColor?: string;
  /** OpenTUI box fill (selection rows, modal panels, etc.). */
  backgroundColor?: ColorInput;
  position?: 'relative' | 'absolute';
  top?: number | string;
  left?: number | string;
  right?: number | string;
  bottom?: number | string;
  zIndex?: number;
  opacity?: number;
  onMouseDown?: (event: unknown) => void;
  onMouseUp?: (event: unknown) => void;
  onMouseOver?: (event: unknown) => void;
  onMouseOut?: (event: unknown) => void;
  onMouseMove?: (event: unknown) => void;
  onMouseScroll?: (event: unknown) => void;
};

function mapBorderStyle(
  style: BoxProps['borderStyle']
): 'single' | 'double' | 'rounded' | 'heavy' | undefined {
  if (!style) return undefined;
  if (style === 'round') return 'rounded';
  if (style === 'bold') return 'heavy';
  if (style === 'rounded' || style === 'heavy' || style === 'single' || style === 'double') {
    return style;
  }
  return 'single';
}

function asDim(value: number | string | undefined): number | `${number}%` | 'auto' | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number') return value;
  if (value === 'auto' || value === '100%' || /^\d+%$/.test(value)) {
    return value as number | `${number}%` | 'auto';
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function setIfDefined<T extends object, K extends string>(
  target: T,
  key: K,
  value: unknown
): void {
  if (value !== undefined) {
    (target as Record<string, unknown>)[key] = value;
  }
}

export function Box(props: BoxProps): ReactNode {
  const {
    children,
    display,
    borderStyle,
    borderColor,
    backgroundColor,
    onMouseDown,
    onMouseUp,
    onMouseOver,
    onMouseOut,
    onMouseMove,
    onMouseScroll,
    opacity,
    flexDirection,
    ...rest
  } = props;

  const mappedBorder = mapBorderStyle(borderStyle);
  // Build OpenTUI props without undefined values (exactOptionalPropertyTypes).
  // Ink's <Box> defaults to row; OpenTUI/Yoga defaults to column — match Ink so
  // product layouts (tabs · separators, list rows) stay horizontal without
  // re-annotating every call site.
  const boxProps: Record<string, unknown> = {
    visible: display !== 'none',
    flexDirection: flexDirection ?? 'row',
    children,
  };

  for (const [key, value] of Object.entries(rest)) {
    if (key === 'width' || key === 'height' || key === 'minHeight' || key === 'maxHeight'
      || key === 'minWidth' || key === 'maxWidth' || key === 'top' || key === 'left'
      || key === 'right' || key === 'bottom') {
      setIfDefined(boxProps, key, asDim(value as number | string | undefined));
    } else {
      setIfDefined(boxProps, key, value);
    }
  }

  if (mappedBorder !== undefined) {
    boxProps.border = true;
    boxProps.borderStyle = mappedBorder;
  }
  setIfDefined(boxProps, 'borderColor', borderColor);
  setIfDefined(boxProps, 'backgroundColor', backgroundColor);
  setIfDefined(boxProps, 'onMouseDown', onMouseDown);
  setIfDefined(boxProps, 'onMouseUp', onMouseUp);
  setIfDefined(boxProps, 'onMouseOver', onMouseOver);
  setIfDefined(boxProps, 'onMouseOut', onMouseOut);
  setIfDefined(boxProps, 'onMouseMove', onMouseMove);
  setIfDefined(boxProps, 'onMouseScroll', onMouseScroll);
  setIfDefined(boxProps, 'opacity', opacity);

  return <box {...(boxProps as object)} />;
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
  // OpenTUI `inverse` is unreliable with truecolor (white-on-white). Map product
  // "inverse" to explicit selection tokens.
  //
  // When no `color` is passed: use RGBA.defaultForeground() (intent=default) so
  // the terminal's own fg is used — OpenTUI's *unset* fg defaults to hard-coded
  // white [255,255,255], which is unreadable on light terminal themes.
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
  const truncate = wrap === 'truncate' || wrap === 'truncate-end' || wrap === 'end';

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
