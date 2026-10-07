#!/usr/bin/env node
/**
 * The notices owed to the open-source software the website and the app are
 * made of: every package, its licence and its copyright line, and the text of
 * each licence once.
 *
 *   node scripts/licenses.mjs                write src/lib/licenses/web.json and app.json
 *   node scripts/licenses.mjs --check        exit 1 when either is not what would be written
 *   node scripts/licenses.mjs [--check] web  (or app) one of the two
 *
 * Read from what is installed, never from the network: each pnpm root's
 * production tree — the website's at the repository root, the app's in
 * mobile/ — walked the way Node resolves it, from the root's own
 * `dependencies` through every package's `dependencies`, `optionalDependencies`
 * and required `peerDependencies`. devDependencies never, at any depth. Not
 * `pnpm licenses list --prod`: it counts an optional peer that only a
 * devDependency satisfies (TypeScript, @types/react) as production code, and
 * its output has changed shape between pnpm versions, of which this
 * repository meets three.
 *
 * For each package: its name and version, the licence its package.json
 * declares, and the first "Copyright …" lines of its LICENSE (or LICENCE, or
 * COPYING) file — its `author` when the file has none. Then what is not a
 * package on both sides, or is one only on one side: the font, IBM Plex Sans
 * Arabic, which the website takes from Google Fonts through next/font and the
 * app from @expo-google-fonts, and the Lucide icons. Then the full text of
 * every licence used, once, as one of those packages ships it (licenceTexts
 * says which), with that package's copyright line taken off the top, since
 * every package's own line is listed beside it.
 *
 * Both files live under src/lib. The website's /licenses page lists the
 * app's packages too, and Vercel never uploads mobile/ (.vercelignore); the
 * app reads its file through `@/`, as it reads the website's other shared
 * modules.
 *
 * The same files whoever writes them, so --check can hold them to the
 * lockfiles: sorted by plain string comparison, no dates, and the same on
 * Linux and macOS. That last needs one rule. A native binary comes as one
 * package per platform (sharp's libvips, Next's and SWC's compilers,
 * lightningcss), and only the machine's own is installed: each is listed once,
 * its platform in the name replaced with `<platform>`. A platform-only
 * package with no platform in its name — fsevents, macOS's file watcher — is
 * left out, or a Mac would write a list Linux cannot reproduce.
 *
 * CI installs one root per job — web.yml the website's, mobile.yml the
 * app's — so --check checks the files whose tree is installed and names the
 * one it skipped. The website's font notice is read from the app's font
 * package (no package of the website's carries the font), or, without the
 * app installed, from the committed app.json, whose own check reads the
 * package.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = realpathSync(join(dirname(fileURLToPath(import.meta.url)), '..'));
const APP_ROOT = join(ROOT, 'mobile');
const OUT = join(ROOT, 'src', 'lib', 'licenses');

const TARGETS = {
  web: { root: ROOT, file: join(OUT, 'web.json'), install: 'pnpm install' },
  app: { root: APP_ROOT, file: join(OUT, 'app.json'), install: 'pnpm install in mobile/' },
};

const FONT = {
  name: 'IBM Plex Sans Arabic',
  /** The app's font package, the one place in either tree the font's licence is a file. */
  package: '@expo-google-fonts/ibm-plex-sans-arabic',
  file: 'LICENSE_FONT',
  /** How the website loads it: next/font fetches it from Google Fonts at build time. */
  webImport: /import\s*\{[^}]*\bIBM_Plex_Sans_Arabic\b[^}]*\}\s*from\s*['"]next\/font\/google['"]/,
};

const ICONS = { name: 'Lucide', web: 'lucide-react', app: 'lucide-react-native' };

class Refusal extends Error {}

const shown = (path) => relative(ROOT, path) || '.';
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
/** Plain code-unit order: the same on every machine, unlike localeCompare. */
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const tidy = (line) => line.replace(/\s+/g, ' ').trim();
const flat = (text) => text.replace(/\s+/g, ' ');

/** 1.10.0 after 1.9.0: numeric parts as numbers, the rest as text. */
function compareVersions(a, b) {
  const left = a.split(/[.+-]/);
  const right = b.split(/[.+-]/);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const x = left[i] ?? '';
    const y = right[i] ?? '';
    const order = /^\d+$/.test(x) && /^\d+$/.test(y) ? Number(x) - Number(y) : compare(x, y);
    if (order) return Math.sign(order);
  }
  return 0;
}

// ─── The installed tree ──────────────────────────────────────────────────────

/**
 * Every `name@version` a lockfile pins, from its `packages:` section. Only to
 * notice a node_modules that no longer matches its lockfile, which would
 * otherwise write — or pass — a list of what nobody else has installed.
 */
function lockedVersions(root) {
  const locked = new Set();
  let inPackages = false;
  for (const line of readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8').split('\n')) {
    if (/^\S/.test(line)) {
      inPackages = /^packages:\s*$/.test(line);
      continue;
    }
    const key = inPackages ? /^ {2}'?([^'\s][^']*?)'?:\s*$/.exec(line) : null;
    if (key) locked.add(key[1]);
  }
  return locked;
}

/**
 * Where `name` resolves from `from`, as Node finds it: the nearest
 * node_modules on the way up, but never above the project's own root. A git
 * worktree sits inside another checkout, and that checkout's node_modules is
 * not this project's.
 */
function locate(name, from, root) {
  for (let dir = from; ; dir = dirname(dir)) {
    if (basename(dir) !== 'node_modules') {
      const candidate = join(dir, 'node_modules', name);
      if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate);
    }
    if (dir === root || dirname(dir) === dir) return null;
  }
}

/** A root's production packages, by directory, or null when it is not installed. */
function installedTree({ root, install }) {
  if (!existsSync(join(root, 'node_modules'))) return null;

  const manifest = readJson(join(root, 'package.json'));
  const found = new Map();
  const missing = new Set();
  const queue = [
    ...Object.keys(manifest.dependencies ?? {}).map((name) => [name, root, false]),
    ...Object.keys(manifest.optionalDependencies ?? {}).map((name) => [name, root, true]),
  ];

  for (let i = 0; i < queue.length; i += 1) {
    const [name, from, optional] = queue[i];
    const dir = locate(name, from, root);
    if (!dir) {
      if (!optional) missing.add(`${name} (for ${from === root ? 'package.json' : found.get(from)?.name})`);
      continue;
    }
    if (found.has(dir)) continue;

    const pkg = readJson(join(dir, 'package.json'));
    found.set(dir, pkg);
    const optionalDependencies = pkg.optionalDependencies ?? {};
    for (const dependency of Object.keys(pkg.dependencies ?? {})) {
      queue.push([dependency, dir, Object.hasOwn(optionalDependencies, dependency)]);
    }
    for (const dependency of Object.keys(optionalDependencies)) queue.push([dependency, dir, true]);
    // A peer is the consumer's to provide, so one that is missing is not this
    // walk's error. An optional peer counts only when something needs it as a
    // dependency of its own — otherwise the app's Jest suite, an optional peer
    // of react-native and expo-router, would be listed as production code.
    for (const dependency of Object.keys(pkg.peerDependencies ?? {})) {
      if (!pkg.peerDependenciesMeta?.[dependency]?.optional) queue.push([dependency, dir, true]);
    }
  }

  const locked = lockedVersions(root);
  const stale = [...found.values()]
    .map((pkg) => `${pkg.name}@${pkg.version}`)
    .filter((id) => !locked.has(id));

  if (missing.size || stale.length) {
    const lines = [
      ...[...missing].map((entry) => `not installed: ${entry}`),
      ...stale.map((entry) => `installed, but not in pnpm-lock.yaml: ${entry}`),
    ];
    throw new Refusal(
      `${shown(join(root, 'node_modules'))} does not match ${shown(join(root, 'pnpm-lock.yaml'))}:\n` +
        lines.slice(0, 8).map((line) => `  ${line}`).join('\n') +
        (lines.length > 8 ? `\n  … and ${lines.length - 8} more` : '') +
        `\nRun ${install} first.`,
    );
  }
  return found;
}

// ─── One package ─────────────────────────────────────────────────────────────

const PLATFORM_PARTS = new Set([
  'aix', 'android', 'darwin', 'freebsd', 'linux', 'linuxmusl', 'netbsd', 'openbsd', 'openharmony',
  'sunos', 'win32', 'wasm32', 'wasi', 'x64', 'x86', 'ia32', 'arm', 'arm64', 'armv6', 'armv7',
  'arm64ec', 'loong64', 'mips64el', 'ppc64', 'ppc64le', 'riscv64', 's390x', 'universal', 'gnu',
  'gnux32', 'gnueabi', 'gnueabihf', 'musl', 'musleabi', 'musleabihf', 'eabi', 'eabihf', 'msvc', 'glibc',
]);

/** `@img/sharp-libvips-linux-x64` → `@img/sharp-libvips-<platform>`; null when the name names no platform. */
function platformFamily(name) {
  const slash = name.startsWith('@') ? name.indexOf('/') : -1;
  const scope = slash === -1 ? '' : name.slice(0, slash + 1);
  const parts = name.slice(slash + 1).split('-');
  let end = parts.length;
  while (end > 0 && PLATFORM_PARTS.has(parts[end - 1])) end -= 1;
  if (end === parts.length) return null;
  return `${scope}${[...parts.slice(0, end), '<platform>'].join('-')}`;
}

const LICENCE_FILE = /^(?:licen[cs]e|copying)(?:$|[-_.])/i;
const PLAIN_LICENCE_FILE = /^(?:licen[cs]e|copying)(?:\.(?:md|txt|markdown))?$/i;

/** A package's licence files, LICENSE itself before LICENSE-MIT or LICENSE_FONT. */
function licenceFiles(dir) {
  return readdirSync(dir)
    .filter((file) => LICENCE_FILE.test(file))
    .sort((a, b) => Number(!PLAIN_LICENCE_FILE.test(a)) - Number(!PLAIN_LICENCE_FILE.test(b)) || compare(a, b))
    .flatMap((file) => {
      const path = join(dir, file);
      if (!statSync(path).isFile()) return [];
      return [{ file, text: readFileSync(path, 'utf8').replace(/\r\n?/g, '\n') }];
    });
}

const COPYRIGHT = /^(?:Copyright\b|COPYRIGHT\b|copyright\s*(?:\(c\)|©|\d)|\(c\)\s*\d|©)/;
/** "Copyright notice", "Copyright and Similar Rights": the licence talking, not a holder. */
const NOT_A_NOTICE =
  /^copyright\s+(?:notices?|holders?|owners?|and|law|laws|licen[cs]es?|statements?|protection|of|to|in|or|for|the|is|are|on)\b/i;
/** A template's blanks: Apache's appendix, the GPL's "how to apply", the OFL's header. */
const PLACEHOLDER =
  /\[yyyy\]|\{yyyy\}|<year>|\[year\]|\{year\}|\[fullname\]|name of copyright owner|<copyright holders?>|<owner>|<dates>|<copyright holder>/i;

function isCopyright(line) {
  return (
    COPYRIGHT.test(line) &&
    !NOT_A_NOTICE.test(line) &&
    !PLACEHOLDER.test(line) &&
    // The FSF's notice on the text of the GPL itself.
    !/Free Software Foundation/i.test(line)
  );
}

const RESERVED = /^all rights reserved\.?$/i;

/** The first run of copyright lines in a text, with an "All rights reserved." under them. */
function copyrightBlock(text) {
  const lines = text.split('\n').map(tidy);
  const start = lines.findIndex(isCopyright);
  if (start === -1) return [];
  const block = [];
  for (const line of lines.slice(start, start + 12)) {
    if (isCopyright(line) || RESERVED.test(line)) block.push(line);
    else break;
  }
  return block;
}

/** The author's name, without the email and the URL: `Sindre Sorhus <…> (…)` → `Sindre Sorhus`. */
function authorOf(pkg) {
  const author = typeof pkg.author === 'string' ? pkg.author : pkg.author?.name;
  return typeof author === 'string' ? tidy(author.replace(/<[^>]*>|\([^)]*\)/g, '')) : '';
}

function declaredLicense(pkg) {
  let value = pkg.license;
  if (value && typeof value === 'object') value = value.type;
  if (!value && Array.isArray(pkg.licenses)) {
    value = pkg.licenses
      .map((entry) => (typeof entry === 'string' ? entry : entry?.type))
      .filter(Boolean)
      .join(' OR ');
  }
  return typeof value === 'string' ? tidy(value) : '';
}

/** `(MIT OR Apache-2.0)` is `MIT OR Apache-2.0`; `MIT or Apache-2.0` too. */
function normaliseExpression(expression) {
  let text = tidy(expression).replace(/ (and|or|with) /gi, (word) => word.toUpperCase());
  const balanced = (inner) => {
    let depth = 0;
    for (const character of inner) {
      depth += character === '(' ? 1 : character === ')' ? -1 : 0;
      if (depth < 0) return false;
    }
    return depth === 0;
  };
  while (text.startsWith('(') && text.endsWith(')') && balanced(text.slice(1, -1))) text = text.slice(1, -1).trim();
  return text;
}

// ─── Licences ────────────────────────────────────────────────────────────────

/**
 * How each licence's text is recognised in a file, with whitespace collapsed.
 * Enough to tell ISC from 0BSD and BSD's two clauses from its three; a file
 * holding no licence on this list gives no text.
 */
const BSD = 'redistribution and use (?:of this software )?in source and binary forms';
const TEXTS = [
  ['0BSD', /permission to use, copy, modify, and\/or distribute this software for any purpose with or without fee is hereby granted\. the software/i],
  ['Apache-2.0', /apache license,? version 2\.0, january 2004/i],
  ['BSD-2-Clause', new RegExp(`${BSD}(?![\\s\\S]*(?:endorse or promote|advertising materials))`, 'i')],
  ['BSD-3-Clause', new RegExp(`${BSD}(?=[\\s\\S]*endorse or promote)(?![\\s\\S]*advertising materials)`, 'i')],
  ['BlueOak-1.0.0', /blue oak model license/i],
  ['CC-BY-4.0', /attribution 4\.0 international/i],
  ['CC0-1.0', /cc0 1\.0 universal/i],
  ['GPL-2.0', /gnu general public license version 2/i],
  ['GPL-3.0', /gnu general public license version 3/i],
  ['ISC', /permission to use, copy, modify, and(?:\/or)? distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies/i],
  ['LGPL-2.1', /gnu lesser general public license version 2\.1/i],
  ['LGPL-3.0', /gnu lesser general public license version 3/i],
  // "…a copy of this software": the OFL grants the same to "a copy of the Font Software".
  ['MIT', /permission is hereby granted, free of charge, to any person obtaining a copy of this software/i],
  ['MPL-2.0', /mozilla public license,? (?:version|v\.) 2\.0/i],
  ['OFL-1.1', /sil open font license,? version 1\.1/i],
  ['Python-2.0', /python software foundation license version 2/i],
  ['Unlicense', /this is free and unencumbered software released into the public domain/i],
];

/**
 * The standard wording, where one author's variant is common: most of the
 * app's BSD-2-Clause packages are one author's, and share "THIS IS PROVIDED
 * BY…", a word short. Preferred, not required.
 */
const STANDARD_WORDING = {
  'BSD-2-Clause': /this software is provided by/i,
  'BSD-3-Clause': /this software is provided by/i,
};

/** `LGPL-3.0-or-later` reads as `LGPL-3.0`'s text; so do `-only` and `+`. */
const textFamily = (id) => id.replace(/-(?:only|or-later)$|\+$/, '');
const recognised = (id) => TEXTS.some(([family]) => family === textFamily(id));
const textsIn = (text) => TEXTS.filter(([, test]) => test.test(flat(text))).map(([id]) => id);

const COPYLEFT = /^(?:A?GPL|LGPL|MPL|EPL|CDDL|EUPL|OSL|CPAL|SSPL|CC-BY-SA|CC-BY-NC|RPL|QPL|Sleepycat)/i;
const isCopyleft = (id) => COPYLEFT.test(id);

/** An SPDX expression as a tree: `{ id }`, `{ all: [...] }` for AND, `{ any: [...] }` for OR. */
function parseExpression(expression) {
  const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? [];
  let at = 0;
  const operator = (word) => tokens[at]?.toUpperCase() === word;
  const primary = () => {
    if (tokens[at] === '(') {
      at += 1;
      const node = anyOf();
      if (tokens[at] === ')') at += 1;
      return node;
    }
    const id = tokens[at] ?? '';
    at += 1;
    // `GPL-2.0 WITH Classpath-exception-2.0`: the exception belongs to the licence.
    if (operator('WITH')) at += 2;
    return { id };
  };
  const allOf = () => {
    const parts = [primary()];
    while (operator('AND')) {
      at += 1;
      parts.push(primary());
    }
    return parts.length === 1 ? parts[0] : { all: parts };
  };
  const anyOf = () => {
    const parts = [allOf()];
    while (operator('OR')) {
      at += 1;
      parts.push(allOf());
    }
    return parts.length === 1 ? parts[0] : { any: parts };
  };
  return anyOf();
}

/** Every licence an expression names. */
function idsOf(expression) {
  const walk = (node) => (node.id !== undefined ? [node.id] : (node.all ?? node.any).flatMap(walk));
  return [...new Set(walk(parseExpression(expression)))];
}

/**
 * The licences a package is used under: all of an AND, and of an OR the first
 * choice that is not copyleft — `BSD-3-Clause OR GPL-2.0` is used as BSD.
 */
function termsOf(expression) {
  const walk = (node) => {
    if (node.id !== undefined) return [node.id];
    if (node.all) return node.all.flatMap(walk);
    const choice = node.any.find((option) => walk(option).every((id) => !isCopyleft(id))) ?? node.any[0];
    return walk(choice);
  };
  return [...new Set(walk(parseExpression(expression)))];
}

/**
 * A licence file's text without the copyright lines at its head, which belong
 * to the package it came from. Only the head: the licence proper starts at its
 * first long line, and nothing after that is touched — the FSF's own notice on
 * the GPL's text, Apache's appendix and the PSF's clauses all stay.
 */
function withoutCopyright(text) {
  const kept = [];
  let head = true;
  let afterCopyright = false;
  for (const line of text.split('\n')) {
    const tidied = tidy(line);
    if (head) {
      if (isCopyright(tidied) || (afterCopyright && RESERVED.test(tidied))) {
        afterCopyright = true;
        continue;
      }
      afterCopyright = false;
      if (tidied.length > 60) head = false;
    }
    kept.push(line.replace(/\s+$/, ''));
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** A licence id as SPDX writes one; not UNKNOWN, nor the words of `SEE LICENSE IN …`. */
const SPDX_ID = /^[A-Za-z0-9][\w.+-]*$/;

/**
 * The text of every licence the packages are used under, once each, as one
 * of them ships it. The font's is fixed: its own file's. For the rest, of the
 * files carrying it, preferred in turn: one holding that licence alone (not
 * bundled with others); one with no package's copyright left in it (Apache's
 * appendix as a template, not filled in); the licence's standard wording; the
 * wording most packages share; and then the first package by name. A licence
 * no file carries gets an empty text, and the pages link to SPDX's copy
 * instead.
 */
function licenceTexts(candidates, assets, fixed) {
  const needed = new Set(
    [...candidates, ...assets]
      .flatMap((entry) => termsOf(entry.license))
      .filter((id) => id !== 'UNKNOWN' && SPDX_ID.test(id)),
  );
  return [...needed].sort(compare).map((id) => {
    const given = fixed.find((entry) => entry.id === id);
    if (given) return given;
    const votes = new Map();
    const counted = new Set();
    for (const candidate of candidates) {
      if (!idsOf(candidate.license).includes(id)) continue;
      for (const { text } of candidate.files) {
        const found = textsIn(text);
        if (!found.includes(textFamily(id))) continue;
        const body = withoutCopyright(text);
        const key = flat(body);
        const vote = votes.get(key) ?? {
          count: 0,
          body,
          source: candidate.source,
          pure: found.length === 1,
          clean: !body.split('\n').some((line) => isCopyright(tidy(line))),
          standard: STANDARD_WORDING[textFamily(id)]?.test(flat(body)) ?? true,
        };
        // A package counts once, however many of its files (or its notices) carry the text.
        if (!counted.has(`${key}\n${candidate.source}`)) vote.count += 1;
        counted.add(`${key}\n${candidate.source}`);
        // Named after a package everyone installs, not one platform's build of it.
        if (vote.source.includes('<platform>') && !candidate.source.includes('<platform>')) vote.source = candidate.source;
        votes.set(key, vote);
      }
    }
    const best = [...votes.values()].sort(
      (a, b) =>
        Number(b.pure) - Number(a.pure) ||
        Number(b.clean) - Number(a.clean) ||
        Number(b.standard) - Number(a.standard) ||
        b.count - a.count ||
        compare(a.source, b.source),
    )[0];
    return best ? { id, source: best.source, text: best.body } : { id, source: '', text: '' };
  });
}

// ─── A whole list ────────────────────────────────────────────────────────────

/** The packages of one installed tree, sorted, with the files their licence texts are read from. */
function packagesOf(tree) {
  const byId = new Map();
  const leftOut = [];
  for (const [dir, pkg] of tree) {
    let name = pkg.name ?? basename(dir);
    if (pkg.os || pkg.cpu || pkg.libc) {
      const family = platformFamily(name);
      if (!family) {
        leftOut.push(`${name}@${pkg.version}`);
        continue;
      }
      name = family;
    }
    const key = `${name}@${pkg.version}`;
    if (byId.has(key)) continue;

    const files = licenceFiles(dir);
    // `SEE LICENSE IN <file>` names a file, not a licence: read as undeclared.
    const declared = declaredLicense(pkg).replace(/^SEE LICEN[CS]E IN\b.*$/i, '');
    // No licence declared: what the file says, if it says one thing.
    const inFiles = [...new Set(files.flatMap(({ text }) => textsIn(text)))];
    const license = declared ? normaliseExpression(declared) : inFiles.length === 1 ? inFiles[0] : 'UNKNOWN';
    const copyright =
      files.map(({ text }) => copyrightBlock(text)).find((block) => block.length)?.join('\n') ?? authorOf(pkg);

    byId.set(key, {
      name,
      version: pkg.version,
      license,
      copyright,
      files,
      source: `${name}@${pkg.version}`,
      inferred: !declared && license !== 'UNKNOWN',
    });
  }
  const packages = [...byId.values()].sort(
    (a, b) => compare(a.name, b.name) || compareVersions(a.version, b.version),
  );
  return { packages, leftOut: leftOut.sort(compare) };
}

/** Every copyright line in a file, for the icons: Lucide's own and Feather's, under whose licence some of them are. */
function allCopyright(text) {
  return [...new Set(text.split('\n').map(tidy).filter(isCopyright))].join('\n');
}

/**
 * The font's notice and its licence's text, from the app's font package's
 * own licence file — the text named after the font rather than the package,
 * so the website's file does not change when the app's font package does.
 * Null when the app is not installed.
 */
function fontFromPackage() {
  if (!existsSync(join(APP_ROOT, 'node_modules'))) return null;
  const dir = locate(FONT.package, APP_ROOT, APP_ROOT);
  if (!dir) throw new Refusal(`${FONT.package} is not installed in mobile/: run pnpm install in mobile/ first.`);
  const version = readJson(join(dir, 'package.json')).version;
  const text = readFileSync(join(dir, FONT.file), 'utf8').replace(/\r\n?/g, '\n');
  const ids = textsIn(text);
  if (ids.length !== 1) throw new Refusal(`${FONT.package}/${FONT.file} is not one licence's text (${ids.join(', ') || 'none'}).`);
  return {
    license: ids[0],
    copyright: copyrightBlock(text).join('\n'),
    version,
    text: { id: ids[0], source: FONT.name, text: withoutCopyright(text) },
  };
}

/** The same, as the committed app.json holds it, for a run without the app installed. */
function fontFromCommittedApp() {
  if (!existsSync(TARGETS.app.file)) return null;
  const app = readJson(TARGETS.app.file);
  const asset = app.assets?.find((entry) => entry.name === FONT.name);
  const text = asset && app.licenses?.find((entry) => entry.id === asset.license && entry.source === FONT.name);
  if (!asset || !text) return null;
  return { license: asset.license, copyright: asset.copyright, text };
}

/** Whether the website's code loads the font through next/font. */
function websiteUsesFont() {
  const files = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name)) files.push(path);
    }
  })(join(ROOT, 'src', 'app'));
  return files.some((file) => FONT.webImport.test(readFileSync(file, 'utf8')));
}

/** The notices that are not a line in the package list: the font and the icons. */
function assetsOf(key) {
  const manifest = readJson(join(TARGETS[key].root, 'package.json'));
  const dependencies = manifest.dependencies ?? {};
  const assets = [];
  const candidates = [];
  const fixed = [];

  const usesFont = key === 'web' ? websiteUsesFont() : Object.hasOwn(dependencies, FONT.package);
  if (usesFont) {
    const font = fontFromPackage() ?? (key === 'web' ? fontFromCommittedApp() : null);
    if (!font) {
      throw new Refusal(
        `The font's licence is read from mobile/node_modules/${FONT.package}, which is not installed, ` +
          `and ${shown(TARGETS.app.file)} has no copy of it: run pnpm install in mobile/ first.`,
      );
    }
    const source = key === 'web' ? 'next/font/google' : `${FONT.package} ${font.version}`;
    assets.push({ name: FONT.name, license: font.license, copyright: font.copyright, source });
    fixed.push(font.text);
  }

  const iconPackage = ICONS[key];
  if (Object.hasOwn(dependencies, iconPackage)) {
    const dir = locate(iconPackage, TARGETS[key].root, TARGETS[key].root);
    const pkg = readJson(join(dir, 'package.json'));
    const files = licenceFiles(dir);
    const text = files[0]?.text ?? '';
    // Lucide's own licence first, then any other its file carries (Feather's MIT, for the icons drawn from it).
    const declared = normaliseExpression(declaredLicense(pkg));
    const others = textsIn(text).filter((id) => !idsOf(declared).includes(id));
    const license = [declared, ...others].join(' AND ');
    assets.push({ name: ICONS.name, license, copyright: allCopyright(text), source: `${iconPackage} ${pkg.version}` });
    candidates.push({ license, files, source: `${pkg.name}@${pkg.version}` });
  }

  return { assets, candidates, fixed };
}

/** One file's contents, and what in it needs a person to look. */
function build(key) {
  const tree = installedTree(TARGETS[key]);
  if (!tree) return null;

  const { packages, leftOut } = packagesOf(tree);
  const { assets, candidates, fixed } = assetsOf(key);
  const licenses = licenceTexts([...packages, ...candidates], assets, fixed);

  const notices = {
    packages: packages.map(({ name, version, license, copyright }) => ({ name, version, license, copyright })),
    assets,
    licenses,
  };

  const attention = [];
  for (const entry of [...packages, ...assets]) {
    const label = entry.version ? `${entry.name} ${entry.version}` : `${entry.name} (${entry.source})`;
    const ids = idsOf(entry.license);
    if (entry.license === 'UNKNOWN') attention.push(`${label}: no licence declared or recognised`);
    else if (entry.inferred) attention.push(`${label}: no licence declared; its file reads as ${entry.license}`);
    const unrecognised = ids.filter((id) => !recognised(id));
    if (entry.license !== 'UNKNOWN' && unrecognised.length) {
      attention.push(`${label}: ${entry.license} — not a licence this script recognises (${unrecognised.join(', ')})`);
    }
    const terms = termsOf(entry.license);
    const copyleft = terms.filter(isCopyleft);
    if (copyleft.length) attention.push(`${label}: ${entry.license} — copyleft (${copyleft.join(', ')})`);
    else if (ids.some(isCopyleft)) attention.push(`${label}: ${entry.license} — used under ${terms.join(' AND ')}`);
  }
  for (const { id } of licenses.filter((entry) => !entry.text)) {
    attention.push(`${id}: no installed package ships its text; the pages link to SPDX's`);
  }

  return { notices, attention, leftOut };
}

/** One entry per line, so a dependency bump is a one-line diff. */
function serialise(notices) {
  const list = (name, entries, last = false) =>
    entries.length
      ? [`  "${name}": [`, entries.map((entry) => `    ${JSON.stringify(entry)}`).join(',\n'), `  ]${last ? '' : ','}`]
      : [`  "${name}": []${last ? '' : ','}`];
  return [
    '{',
    ...list('packages', notices.packages),
    ...list('assets', notices.assets),
    ...list('licenses', notices.licenses, true),
    '}',
    '',
  ].join('\n');
}

/** What changed between the committed file and what would be written, for a person to read. */
function differences(before, after) {
  const lines = [];
  const index = (entries, id) => new Map((entries ?? []).map((entry) => [id(entry), JSON.stringify(entry)]));
  const sections = [
    ['packages', (entry) => `${entry.name} ${entry.version}`],
    ['assets', (entry) => entry.name],
    ['licenses', (entry) => `licence text ${entry.id}`],
  ];
  for (const [section, id] of sections) {
    const old = index(before?.[section], id);
    const now = index(after[section], id);
    for (const [key, value] of now) {
      if (!old.has(key)) lines.push(`+ ${key}`);
      else if (old.get(key) !== value) lines.push(`~ ${key}`);
    }
    for (const key of old.keys()) if (!now.has(key)) lines.push(`- ${key}`);
  }
  return lines;
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const checking = args.includes('--check');
  const named = args.filter((arg) => !arg.startsWith('--'));
  const unknown = [...named, ...args.filter((arg) => arg.startsWith('--') && arg !== '--check')].filter(
    (arg) => !Object.hasOwn(TARGETS, arg) && arg !== '--check',
  );
  if (unknown.length) throw new Refusal(`Unknown argument: ${unknown.join(' ')}. Usage: node scripts/licenses.mjs [--check] [web|app]`);
  const keys = named.length ? named : Object.keys(TARGETS);

  // Everything is built before anything is written: a run that cannot read
  // one tree leaves both files as they were.
  const results = keys.map((key) => [key, build(key)]);
  const absent = results.filter(([, result]) => !result).map(([key]) => TARGETS[key]);
  if (!checking && absent.length) {
    throw new Refusal(
      absent.map((target) => `${shown(join(target.root, 'node_modules'))} is not installed: run ${target.install} first.`).join('\n'),
    );
  }

  let failed = false;
  const checked = [];
  for (const [key, result] of results) {
    const target = TARGETS[key];
    if (!result) {
      console.log(
        `licenses: skipped ${shown(target.file)} — ${shown(join(target.root, 'node_modules'))} is not installed (${target.install} to check it).`,
      );
      continue;
    }

    const contents = serialise(result.notices);
    const counts = `${result.notices.packages.length} packages, ${result.notices.licenses.length} licence texts`;
    if (checking) {
      const committed = existsSync(target.file) ? readFileSync(target.file, 'utf8') : null;
      if (committed === contents) {
        checked.push(`${shown(target.file)} (${counts})`);
        continue;
      }
      failed = true;
      let before = null;
      try {
        before = committed === null ? null : JSON.parse(committed);
      } catch {
        // Unreadable: every entry shows as new.
      }
      const changes = differences(before, result.notices);
      console.error(
        `licenses: ${shown(target.file)} ${committed === null ? 'is missing' : 'is out of date'}` +
          (changes.length ? `:\n${changes.slice(0, 20).map((line) => `  ${line}`).join('\n')}` : ' (formatting only).') +
          (changes.length > 20 ? `\n  … and ${changes.length - 20} more` : ''),
      );
    } else {
      mkdirSync(dirname(target.file), { recursive: true });
      writeFileSync(target.file, contents);
      console.log(`licenses: wrote ${shown(target.file)} (${counts}, ${result.notices.assets.length} other notices)`);
      if (result.leftOut.length) console.log(`  left out, platform-only: ${result.leftOut.join(', ')}`);
      if (result.attention.length) {
        console.log('  worth a look:');
        for (const line of result.attention) console.log(`    ${line}`);
      }
    }
  }

  if (checking) {
    if (failed) {
      console.error('\nRun `node scripts/licenses.mjs` and commit what it writes.');
      process.exit(1);
    }
    if (!checked.length) throw new Refusal('Nothing to check: neither tree is installed.');
    console.log(`licenses: up to date — ${checked.join('; ')}`);
  }
}

try {
  main();
} catch (error) {
  if (!(error instanceof Refusal)) throw error;
  console.error(`licenses: ${error.message}`);
  process.exit(1);
}
