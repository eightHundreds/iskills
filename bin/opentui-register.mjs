/**
 * Register OpenTUI Node ESM resolve hook before loading the app.
 * Shipped next to the bin so published packages keep TUI working under Node.
 */
import { register } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, 'opentui-resolve-hook.mjs')).href);
