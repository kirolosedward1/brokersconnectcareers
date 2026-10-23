/**
 * Module resolution for a website script that loads one of the app's own
 * modules under Node (scripts/route-parity.test.mjs → mobile/src/lib/links.ts).
 *
 * supabase/tests/alias-hooks.mjs knows the website's `@/` alone. The app's
 * code also uses `~/` for its own src, and imports a sibling without its
 * extension (`./tabs`), which Metro and tsc resolve and Node's loader does not.
 * This adds those two: `~/` is mobile/src, and a relative or aliased path that
 * names no file is tried as .ts and .tsx. Everything else passes through.
 */
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = new URL('../', import.meta.url);
const webSrc = new URL('src/', repo);
const appSrc = new URL('mobile/src/', repo);

function withExtension(url) {
  const path = fileURLToPath(url);
  if (existsSync(path) && statSync(path).isFile()) return url;
  for (const ext of ['.ts', '.tsx']) if (existsSync(path + ext)) return pathToFileURL(path + ext).href;
  for (const ext of ['.ts', '.tsx']) if (existsSync(`${path}/index${ext}`)) return pathToFileURL(`${path}/index${ext}`).href;
  return url;
}

export async function resolve(specifier, context, next) {
  if (specifier === 'server-only') return { url: 'data:text/javascript,export {};', shortCircuit: true };
  if (specifier.startsWith('@/')) return next(withExtension(new URL(specifier.slice(2), webSrc).href), context);
  if (specifier.startsWith('~/')) return next(withExtension(new URL(specifier.slice(2), appSrc).href), context);
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
    return next(withExtension(new URL(specifier, context.parentURL).href), context);
  }
  return next(specifier, context);
}
