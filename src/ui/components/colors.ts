// Semantic terminal palette.
//
// Main canvas: inherit terminal bg; body text without `color` uses
// RGBA.defaultForeground() (see Text adapter).
// Modal / secondary chrome: solid tokens from light|dark themeMode.

export type ThemeModeName = 'light' | 'dark';

/**
 * Theme-aware UI chrome (modal panels, hover wash, secondary labels).
 * Neutral surfaces — brand purple only on selection / primary accents.
 */
export const modalChromeByMode = {
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

export type ModalChrome = (typeof modalChromeByMode)[ThemeModeName];

/** Resolve chrome; null/unknown → dark (common terminal default). */
export function modalChrome(mode: ThemeModeName | null | undefined): ModalChrome {
  return mode === 'light' ? modalChromeByMode.light : modalChromeByMode.dark;
}

export const termcnColors = {
  /** Brand / theme accent */
  primary: '#7C3AED',
  /**
   * @deprecated Prefer omitting color on main-canvas text (terminal default).
   */
  foreground: '#E5E7EB',
  /**
   * Secondary labels — light-theme mid gray. Prefer `modalChrome(mode).muted`
   * so dark terminals get a lighter secondary.
   */
  muted: modalChromeByMode.light.muted,
  border: '#A78BFA',
  error: '#DC2626',
  /** @deprecated Do not full-paint the app. */
  surface: 'default',
  /** @deprecated Modal host does not paint full-viewport scrim. */
  modalScrim: '#EDE9FE',
  /**
   * Light modal panel fill. Prefer `modalChrome(themeMode).surface`.
   */
  modalSurface: modalChromeByMode.light.surface,
  /**
   * Body text on light modalSurface. Prefer `modalChrome(themeMode).body`.
   */
  panelBody: modalChromeByMode.light.body,
  /**
   * Light-theme hover wash. Prefer `modalChrome(themeMode).hover` (solid).
   */
  hover: modalChromeByMode.light.hover,
  selectionBg: '#7C3AED',
  selectionFg: '#FFFFFF',
} as const;

export type TermcnColor = (typeof termcnColors)[keyof typeof termcnColors];
