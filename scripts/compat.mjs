/**
 * Browser APIs that are newer than the browsers this market actually uses.
 *
 *   node scripts/compat.mjs
 *
 * Next transpiles syntax, and polyfills a short list of globals for legacy
 * builds. It does not polyfill these, so a component reaching for one throws
 * on the phone it was meant to serve — and inside a transition, where the
 * failure is nothing happening rather than an error anybody sees.
 *
 * Traffic here arrives from Facebook and Instagram ads, which open the site in
 * an in-app WebView rather than in the phone's own browser. Those lag well
 * behind Chrome's release notes, and `crypto.randomUUID` also needs a secure
 * context, so it is simply absent on any http:// origin.
 *
 * Each rule names the replacement, because a rule that only forbids gets
 * worked around.
 */
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0;
let fail = 0;

function check(label, ok, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

const RULES = [
  {
    pattern: /\bcrypto\.randomUUID\s*\(/,
    label: 'crypto.randomUUID',
    instead: "uuid() from '@/lib/utils'",
    // The fallback itself has to call it.
    allow: ['src/lib/utils.ts'],
  },
  {
    pattern: /\.at\(\s*-/,
    label: 'Array.prototype.at with a negative index',
    instead: 'items[items.length - 1]',
    allow: [],
  },
  {
    pattern: /\bstructuredClone\s*\(/,
    label: 'structuredClone',
    instead: 'an explicit copy',
    allow: [],
  },
  {
    pattern: /\bObject\.hasOwn\s*\(/,
    label: 'Object.hasOwn',
    instead: 'Object.prototype.hasOwnProperty.call',
    allow: [],
  },
  {
    // Fine inside a try/catch — formatList does exactly that — so the rule is
    // "not bare", and the allowlist carries the file that guards it.
    pattern: /new Intl\.(ListFormat|Segmenter|DurationFormat)\b/,
    label: 'a 2019-or-later Intl constructor',
    instead: 'a plain string join, or a try/catch around it',
    allow: [],
  },
];

const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.tsx?$/.test(entry)) files.push(full);
  }
})(join(ROOT, 'src'));

console.log(`— APIs the target browsers may not have (${files.length} files)`);

for (const rule of RULES) {
  const offenders = [];

  for (const file of files) {
    const relative = file.replace(ROOT + '/', '');
    if (rule.allow.includes(relative)) continue;

    // Comments blanked in place, so prose about a rule is not read as a
    // breach of it and the line numbers still point at the source.
    const code = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
      .replace(/^(\s*)\/\/.*$/gm, '$1');

    code.split('\n').forEach((line, index) => {
      if (rule.pattern.test(line)) offenders.push(`${relative}:${index + 1}`);
    });
  }

  check(
    `${rule.label} — use ${rule.instead}`,
    offenders.length === 0,
    offenders.slice(0, 5).join('; '),
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
