#!/usr/bin/env node
/**
 * The app bundles some of the website's own code — the pure modules under
 * ../src/lib and the catalogues in ../messages. This walks every import the
 * app can reach and fails if any of them would bring in something that cannot
 * run on a phone, or that must not leave the server:
 *
 *   - anything outside ../src/lib and ../messages (Metro watches only those);
 *   - `server-only`, Next (`next`, `next/*`), next-intl, react-dom;
 *   - the server-side Supabase clients (server, admin, public) and the
 *     query modules built on them;
 *   - Node built-ins;
 *   - a package the app does not itself depend on — a builder installs only
 *     the app's dependencies, so the website's copy is never there.
 *
 * Type-only imports are skipped: they are erased before bundling, so the app
 * may name the website's types wherever they live.
 *
 * Usage: node scripts/check-shared.mjs   (exit 1 with the chains on failure)
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = resolve(appRoot, '..');
const webSrc = join(webRoot, 'src');
const allowedWebDirs = [join(webSrc, 'lib'), join(webRoot, 'messages')];

const FORBIDDEN = [
  [/^server-only$/, 'server-only'],
  [/^next($|\/)/, 'Next.js'],
  [/^next-intl($|\/)/, 'next-intl (the app uses use-intl)'],
  [/^react-dom($|\/)/, 'react-dom'],
  [/^(node:)?(fs|path|crypto|os|child_process|net|tls|http|https|stream|zlib|async_hooks|worker_threads)($|\/)/, 'a Node built-in'],
  [/^@\/lib\/supabase\/(server|admin|public)$/, 'a server-side Supabase client'],
  [/^@\/lib\/queries\//, 'a server query module'],
  [/^@\/lib\/actions\//, 'a server action'],
];

const EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.json'];

const appPackage = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'));
const appDependencies = new Set(Object.keys(appPackage.dependencies ?? {}));
const packageName = (specifier) =>
  specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
const isPackage = (specifier) => !/^(\.|\/|@\/|~\/)/.test(specifier);

function listSources(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSources(path));
    else if (['.ts', '.tsx'].includes(extname(entry.name)) && !entry.name.endsWith('.d.ts')) out.push(path);
  }
  return out;
}

/** Every module specifier a file imports for its value, with the line it is on. */
function valueImports(source) {
  const found = [];
  const statement = /(^|[;\n])\s*(import|export)\s+(type\s+)?([^;'"]*?)\s*from\s*['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(statement)) {
    const [, , , typeOnly, clause, specifier] = match;
    if (typeOnly) continue;
    // `import { type A, type B } from` — every name a type — is erased too.
    const braces = /^\{([\s\S]*)\}$/.exec(clause.trim());
    if (braces) {
      const names = braces[1].split(',').map((name) => name.trim()).filter(Boolean);
      if (names.length && names.every((name) => name.startsWith('type '))) continue;
    }
    found.push(specifier);
  }
  for (const match of source.matchAll(/(^|[;\n])\s*import\s*['"]([^'"]+)['"]/g)) found.push(match[2]);
  for (const match of source.matchAll(/\b(?:require|import)\(\s*['"]([^'"]+)['"]\s*\)/g)) found.push(match[1]);
  return found;
}

function resolveFile(base) {
  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const ext of EXTENSIONS) if (existsSync(base + ext)) return base + ext;
  for (const ext of EXTENSIONS) if (existsSync(join(base, `index${ext}`))) return join(base, `index${ext}`);
  return null;
}

function resolveSpecifier(specifier, from) {
  if (specifier.startsWith('@/')) return resolveFile(join(webSrc, specifier.slice(2)));
  if (specifier.startsWith('~/')) return resolveFile(join(appRoot, 'src', specifier.slice(2)));
  if (specifier.startsWith('.')) return resolveFile(resolve(dirname(from), specifier));
  return null; // a package
}

const isWebsite = (file) => !file.startsWith(appRoot + sep);
const shown = (file) => relative(webRoot, file);

const problems = [];
const seen = new Set();
const queue = listSources(join(appRoot, 'src')).map((file) => ({ file, chain: [file] }));

while (queue.length) {
  const { file, chain } = queue.shift();
  if (seen.has(file)) continue;
  seen.add(file);

  if (isWebsite(file) && !allowedWebDirs.some((dir) => file.startsWith(dir + sep))) {
    problems.push(`${shown(file)} is outside src/lib and messages\n    via ${chain.map(shown).join('\n     -> ')}`);
    continue;
  }
  if (file.endsWith('.json')) continue;

  const source = readFileSync(file, 'utf8');
  for (const specifier of valueImports(source)) {
    // Only the website's code is policed for packages; the app's own imports
    // are its business (react-native, expo-*).
    const rule = FORBIDDEN.find(([pattern]) => pattern.test(specifier));
    if (rule && (isWebsite(file) || specifier.startsWith('@/'))) {
      problems.push(`${shown(file)} imports ${specifier} — ${rule[1]}\n    via ${chain.map(shown).join('\n     -> ')}`);
      continue;
    }
    if (isWebsite(file) && isPackage(specifier) && !appDependencies.has(packageName(specifier))) {
      problems.push(
        `${shown(file)} imports ${specifier}, which the app does not depend on\n    via ${chain.map(shown).join('\n     -> ')}`,
      );
      continue;
    }
    const target = resolveSpecifier(specifier, file);
    if (specifier.startsWith('@/') && !target) {
      problems.push(`${shown(file)} imports ${specifier}, which does not exist`);
      continue;
    }
    if (target) queue.push({ file: target, chain: [...chain, target] });
  }
}

const shared = [...seen].filter(isWebsite).sort();
if (problems.length) {
  console.error(`check-shared: ${problems.length} problem(s)\n`);
  for (const problem of problems) console.error(`  ${problem}\n`);
  process.exit(1);
}
console.log(`check-shared: the app bundles ${shared.length} of the website's files, all safe:`);
for (const file of shared) console.log(`  ${shown(file)}`);
