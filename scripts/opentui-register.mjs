/**
 * Register OpenTUI Node ESM resolve hook before app or tests load React/OpenTUI.
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, 'opentui-resolve-hook.mjs')).href);
