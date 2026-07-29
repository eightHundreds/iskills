/*
 * Hyperlink helper: prefer OpenTUI `<a href>` when label is plain text;
 * fall back to terminal-link for custom fallback formatters.
 */
import type { ReactNode } from 'react';
import terminalLink from 'terminal-link';

export type LinkFallback = boolean | ((text: string, url: string) => string);

export function Link({
  children,
  url,
  fallback = true,
}: {
  children: ReactNode;
  url: string;
  fallback?: LinkFallback;
}): ReactNode {
  const label =
    typeof children === 'string' || typeof children === 'number'
      ? String(children)
      : '';

  // Custom fallback fn → keep terminal-link formatting for non-OSC8 terminals.
  if (typeof fallback === 'function') {
    const text = label || url;
    return (
      <text>
        <span>{terminalLink(text, url, { fallback })}</span>
      </text>
    );
  }

  if (label) {
    return (
      <text>
        <a href={url}>{label}</a>
      </text>
    );
  }

  return (
    <text>
      <a href={url}>{url}</a>
    </text>
  );
}
