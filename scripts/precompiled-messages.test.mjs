/**
 * The catalogue formats the same compiled at build time as parsed at run time.
 *
 *   pnpm test:messages-precompiled
 *
 * next.config.ts has next-intl compile every ICU message when the site is
 * built (`experimental.messages.precompile`), and the browser and the server
 * format the compiled trees with use-intl's small formatter instead of
 * parsing the strings. That is a second implementation of every plural,
 * select, number, date and tag in ar.json and en.json, so each message is
 * formatted both ways here — with arguments chosen to reach every branch it
 * has — and the two must agree word for word.
 *
 * The two formatters cannot share a process: use-intl imports its formatter
 * as `use-intl/format-message`, which the build aliases to the format-only
 * entry. So this file runs itself twice, once as each, and compares.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire, register } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
// use-intl, icu-minify and the parser are next-intl's own dependencies.
const fromNextIntl = createRequire(`${realpathSync(fileURLToPath(new URL('node_modules/next-intl', root)))}/`);
const coreUrl = `file://${fromNextIntl.resolve('use-intl/core')}`;
const fromUseIntl = createRequire(fromNextIntl.resolve('use-intl/core'));
const fromMinify = createRequire(fromNextIntl.resolve('icu-minify/compile'));

const mode = process.argv[2];

if (mode === 'parsed' || mode === 'compiled') {
  if (mode === 'compiled') {
    const formatOnly = `file://${fromUseIntl.resolve('use-intl/format-message/format-only')}`;
    const hook = `export async function resolve(s, c, n) { return s === 'use-intl/format-message' ? { url: ${JSON.stringify(formatOnly)}, shortCircuit: true } : n(s, c); }`;
    register(`data:text/javascript,${encodeURIComponent(hook)}`);
  }
  const { createTranslator } = await import(coreUrl);
  const { default: compile } = await import(`file://${fromNextIntl.resolve('icu-minify/compile')}`);
  const { intlFormats } = await import(new URL('src/lib/format.ts', root).href);
  const cases = JSON.parse(readFileSync(0, 'utf8'));
  const out = {};
  for (const locale of ['ar', 'en']) {
    let messages = JSON.parse(readFileSync(new URL(`messages/${locale}.json`, root), 'utf8'));
    if (mode === 'compiled') messages = compileAll(messages, compile);
    const t = createTranslator({ locale, messages, formats: intlFormats, timeZone: 'Africa/Cairo', onError: () => {} });
    for (const { key, variants } of cases[locale]) {
      out[`${locale}:${key}`] = variants.map((values) => {
        try {
          return t.markup(key, revive(values));
        } catch (error) {
          return `throws ${error.message}`;
        }
      });
    }
  }
  process.stdout.write(JSON.stringify(out));
} else {
  const { parse, TYPE } = await import(`file://${fromMinify.resolve('@formatjs/icu-messageformat-parser')}`);
  const cases = {};
  for (const locale of ['ar', 'en']) {
    const messages = JSON.parse(readFileSync(new URL(`messages/${locale}.json`, root), 'utf8'));
    cases[locale] = flatten(messages).map(([key, message]) => ({ key, variants: variantsOf(parse(message), TYPE) }));
  }
  const input = JSON.stringify(cases);
  const run = (as) => {
    const result = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', fileURLToPath(import.meta.url), as], {
      input,
      maxBuffer: 256 * 1024 * 1024,
      encoding: 'utf8',
    });
    if (result.status !== 0) throw new Error(`${as} run failed:\n${result.stderr}`);
    return JSON.parse(result.stdout);
  };
  const parsed = run('parsed');
  const compiled = run('compiled');

  let checked = 0;
  const differ = [];
  for (const [id, expected] of Object.entries(parsed)) {
    expected.forEach((value, index) => {
      checked += 1;
      if (value !== compiled[id][index]) differ.push(`${id} #${index}\n    parsed:   ${value}\n    compiled: ${compiled[id][index]}`);
    });
  }
  const messages = Object.keys(parsed).length;
  if (differ.length) {
    console.log(`  FAIL  ${differ.length} of ${checked} formattings differ:\n  ${differ.slice(0, 40).join('\n  ')}`);
    process.exit(1);
  }
  console.log(`  PASS  ${messages} messages, ${checked} formattings: compiled and parsed agree`);
}

function flatten(object, prefix = '') {
  return Object.entries(object).flatMap(([key, value]) =>
    typeof value === 'string' ? [[prefix + key, value]] : flatten(value, `${prefix}${key}.`),
  );
}

function compileAll(object, compile) {
  return Object.fromEntries(
    Object.entries(object).map(([key, value]) => [key, typeof value === 'string' ? compile(value) : compileAll(value, compile)]),
  );
}

/** Tags travel as markers through JSON and become functions on the other side. */
function revive(values) {
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) =>
      value === '__tag__' ? [name, (chunks) => `<${name}>${chunks}</${name}>`]
        : value && typeof value === 'object' && '__date__' in value ? [name, new Date(value.__date__)]
          : [name, value],
    ),
  );
}

/**
 * Argument sets that between them take every branch: each number at the
 * plural boundaries Arabic has (0, 1, 2, 3–10, 11–99, 100+) and a fraction,
 * each select through each of its options, every tag as a marked wrapper.
 */
function variantsOf(ast, TYPE) {
  const args = new Map();
  const visit = (nodes) => {
    for (const node of nodes) {
      switch (node.type) {
        case TYPE.argument:
          if (!args.has(node.value)) args.set(node.value, { kind: 'string' });
          break;
        case TYPE.number:
          args.set(node.value, { kind: 'number' });
          break;
        case TYPE.date:
        case TYPE.time:
          args.set(node.value, { kind: 'date' });
          break;
        case TYPE.plural:
          args.set(node.value, { kind: 'number' });
          for (const option of Object.values(node.options)) visit(option.value);
          break;
        case TYPE.select: {
          const previous = args.get(node.value);
          const options = new Set([...(previous?.options ?? []), ...Object.keys(node.options)]);
          args.set(node.value, { kind: 'select', options: [...options] });
          for (const option of Object.values(node.options)) visit(option.value);
          break;
        }
        case TYPE.tag:
          args.set(node.value, { kind: 'tag' });
          visit(node.children);
          break;
        default:
          break;
      }
    }
  };
  visit(ast);
  if (args.size === 0) return [{}];

  const numbers = [0, 1, 2, 3, 11, 100, 1500, 2.5];
  const dates = [Date.UTC(2026, 8, 29, 9, 30), Date.UTC(2026, 0, 1, 22, 5)];
  const width = Math.max(numbers.length, ...[...args.values()].map((arg) => arg.options?.length ?? 1));
  return Array.from({ length: width }, (_, index) =>
    Object.fromEntries(
      [...args].map(([name, arg]) => {
        if (arg.kind === 'number') return [name, numbers[index % numbers.length]];
        if (arg.kind === 'date') return [name, { __date__: dates[index % dates.length] }];
        if (arg.kind === 'select') {
          const option = arg.options[index % arg.options.length];
          return [name, option === 'other' ? 'somethingElse' : option];
        }
        if (arg.kind === 'tag') return [name, '__tag__'];
        return [name, `«${name}»`];
      }),
    ),
  );
}
