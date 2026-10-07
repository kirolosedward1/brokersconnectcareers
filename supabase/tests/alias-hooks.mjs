/**
 * The app's `@/` import alias, for a test that loads a src module under Node.
 *
 * tsconfig maps `@/*` to `src/*` for the bundler; Node knows nothing of it,
 * so a module that reaches for a sibling that way (phone.ts → search/arabic)
 * cannot be imported by a test directly. Registered from the test with
 * node:module's register(), it resolves that one prefix and passes everything
 * else through. Every src module is TypeScript, so the extension is `.ts`.
 */
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) {
    const target = new URL(`../../src/${specifier.slice(2)}.ts`, import.meta.url);
    return next(target.href, context);
  }
  // A server module's guard against reaching a browser bundle. Next supplies
  // the package; under Node a test is the server, so it is nothing.
  if (specifier === 'server-only') return { url: 'data:text/javascript,export {};', shortCircuit: true };
  return next(specifier, context);
}
