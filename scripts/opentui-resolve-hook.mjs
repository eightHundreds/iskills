/**
 * Node ESM resolve hook: OpenTUI imports extensionless react-reconciler subpaths.
 * Maps them to the package's .js files so Node 24 can load the reconciler.
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
