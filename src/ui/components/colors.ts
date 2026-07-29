// Semantic terminal palette.
//
// Main canvas: inherit terminal bg; body text without `color` uses
// RGBA.defaultForeground() (see Text adapter).
// Modal panels: solid fill that follows terminal light/dark themeMode.

export type ThemeModeName = 'light' | 'dark';

/** Solid modal panel tokens per terminal theme. Neutral (not purple wash). */
export const modalChromeByMode = {
  light: {
    surface: '#F8FAFC',
    body: '#1F2937',
    muted: '#6B7280',
  },
  dark: {
    surface: '#18181B',
    body: '#E5E7EB',
    muted: '#9CA3AF',
  },
} as const;

export type ModalChrome = (typeof modalChromeByMode)[ThemeModeName];

/** Resolve modal panel colors; null/unknown → dark (common terminal default). */
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
  /** Secondary labels — mid gray on light panels and terminal */
  muted: '#6B7280',
  border: '#A78BFA',
  error: '#DC2626',
  /** @deprecated Do not full-paint the app. */
  surface: 'default',
  /** @deprecated Modal host does not paint full-viewport scrim. */
  modalScrim: '#EDE9FE',
  /**
   * Light modal panel fill. Prefer `modalChrome(themeMode).surface` so dark
   * terminals get a dark panel.
   */
  modalSurface: modalChromeByMode.light.surface,
  /**
   * Body text on light modalSurface. Prefer `modalChrome(themeMode).body`.
   */
  panelBody: modalChromeByMode.light.body,
  hover: '#EDE9FE',
  selectionBg: '#7C3AED',
  selectionFg: '#FFFFFF',
} as const;

export type TermcnColor = (typeof termcnColors)[keyof typeof termcnColors];
