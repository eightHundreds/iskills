// Semantic terminal palette.
//
// Main canvas: inherit terminal bg; body text without `color` uses
// RGBA.defaultForeground() (see Text adapter).
// Modal / secondary panel: solid tokens from light|dark themeMode.

export type ThemeModeName = 'light' | 'dark';

/**
 * Theme-aware panel colors (modal panels, hover wash, secondary labels).
 * Neutral surfaces — brand purple only on selection / primary accents.
 */
export const panelColorsByMode = {
  light: {
    surface: '#F8FAFC',
    body: '#1F2937',
    muted: '#6B7280',
    /** Solid hover wash (never low-alpha purple — OpenTUI blends alpha on black). */
    hover: '#EDE9FE',
  },
  dark: {
    surface: '#18181B',
    body: '#E5E7EB',
    muted: '#9CA3AF',
    hover: '#2E1065',
  },
} as const;

export type PanelColors = (typeof panelColorsByMode)[ThemeModeName];

/** Resolve panel colors; null/unknown → dark (common terminal default). */
export function panelColors(mode: ThemeModeName | null | undefined): PanelColors {
  return mode === 'light' ? panelColorsByMode.light : panelColorsByMode.dark;
}

export const termcnColors = {
  /** Brand / theme accent */
  primary: '#7C3AED',
  /**
   * @deprecated Prefer omitting color on main-canvas text (terminal default).
   */
  foreground: '#E5E7EB',
  /**
   * Secondary labels — light-theme mid gray. Prefer `panelColors(mode).muted`
   * so dark terminals get a lighter secondary.
   */
  muted: panelColorsByMode.light.muted,
  border: '#A78BFA',
  error: '#DC2626',
  /** @deprecated Do not full-paint the app. */
  surface: 'default',
  /** @deprecated Modal host does not paint full-viewport scrim. */
  modalScrim: '#EDE9FE',
  /**
   * Light modal panel fill. Prefer `panelColors(themeMode).surface`.
   */
  modalSurface: panelColorsByMode.light.surface,
  /**
   * Body text on light modalSurface. Prefer `panelColors(themeMode).body`.
   */
  panelBody: panelColorsByMode.light.body,
  /**
   * Light-theme hover wash. Prefer `panelColors(themeMode).hover` (solid).
   */
  hover: panelColorsByMode.light.hover,
  selectionBg: '#7C3AED',
  selectionFg: '#FFFFFF',
} as const;

export type TermcnColor = (typeof termcnColors)[keyof typeof termcnColors];
