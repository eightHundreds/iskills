/**
 * Node ESM resolve hook: OpenTUI imports extensionless react-reconciler subpaths.
 */
export async function resolve(specifier, context, nextResolve) {
  if (
    specifier === 'react-reconciler/constants' ||
    specifier === 'react-reconciler/reflection'
  ) {
    return nextResolve(`${specifier}.js`, context);
  }
  return nextResolve(specifier, context);
}
