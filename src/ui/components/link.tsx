/*
 * Forked from ink-link 5.0.0.
 * Copyright (c) Sindre Sorhus <sindresorhus@gmail.com>
 * Licensed under the MIT License; see THIRD_PARTY_NOTICES.md.
 */
import { Text, Transform } from 'ink';
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
  return (
    <Transform transform={(text) => terminalLink(text, url, { fallback })}>
      <Text>{children}</Text>
    </Transform>
  );
}
