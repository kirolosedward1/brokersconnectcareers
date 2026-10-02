/**
 * Loads src/lib/email/notify.ts under Node with the database and the outbox
 * faked, for scripts/email-retries.test.mjs: `@/` and extensionless relative
 * imports resolve into src, 'server-only' is empty, and the admin client and
 * deliver() (service.ts) are this folder's stand-ins.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
const HERE = new URL('.', import.meta.url);
const withExtension = (base) => [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find((candidate) => existsSync(candidate));

export async function resolve(specifier, context, next) {
  if (specifier === 'server-only') return { url: new URL('./empty.mjs', HERE).href, shortCircuit: true };
  if (specifier === '@/lib/supabase/admin') return { url: new URL('./fake-admin.mjs', HERE).href, shortCircuit: true };
  if (specifier === './service' && context.parentURL?.endsWith('/src/lib/email/notify.ts')) {
    return { url: new URL('./fake-service.mjs', HERE).href, shortCircuit: true };
  }
  if (specifier.startsWith('@/')) {
    const found = withExtension(SRC + specifier.slice(2));
    if (found) return next('file://' + found, context);
  }
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file://' + SRC)) {
    const base = fileURLToPath(new URL(specifier, context.parentURL));
    if (!existsSync(base) || !/\.[a-z]+$/.test(base)) {
      const found = withExtension(base);
      if (found) return next('file://' + found, context);
    }
  }
  return next(specifier, context);
}
