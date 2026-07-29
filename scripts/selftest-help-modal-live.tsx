/**
 * Live visual self-test inside a real terminal (Ghostty):
 * mounts browser UI; after first paint injects `?` so the help modal opens.
 *
 *   cd repo && bun ./scripts/selftest-help-modal-live.tsx
 *   # or
 *   open -na Ghostty.app --args -e /bin/bash -lc 'cd REPO && bun ./scripts/selftest-help-modal-live.tsx'
 */
import { useEffect, type ReactNode } from 'react';
import {
  BrowserHarness,
  collectedFixture,
} from '../test/browser-harness.js';
import { runApp } from '../src/ui/shell/run.js';

function LiveHelpBrowser(): ReactNode {
  useEffect(() => {
    // Inject `?` through OpenTUI key pipeline once the browser is mounted.
    const timer = setTimeout(() => {
      if (process.stdin.isTTY) {
        process.stdin.push('?');
      }
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <BrowserHarness
      state={{
        tab: 'collection',
        query: '',
        cursor: 0,
        selected: [],
        agent: '',
        focus: 'list',
      }}
      collection={Array.from({ length: 10 }, (_, i) =>
        collectedFixture(`overlay-${i}`, {
          description: `Skill fixture ${i} for help modal live selftest`,
        })
      )}
    />
  );
}

process.chdir(new URL('..', import.meta.url).pathname);

try {
  await runApp(<LiveHelpBrowser />);
} catch (error) {
  console.error('live selftest failed:', error);
  process.exit(1);
}
