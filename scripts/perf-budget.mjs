#!/usr/bin/env node
/**
 * Performance budget, checked against a production build.
 *
 *   pnpm build && pnpm perf:budget
 *
 * Reads what `next build` wrote to .next and measures what a first visit to
 * each route downloads before it can run: the route's JavaScript and the
 * shared framework chunks (gzipped, the way they travel), the stylesheet, and
 * the font files next/font preloads. Fails, listing every overrun, when any of
 * them is over the numbers in perf-budget.json.
 *
 * The budgets are regression targets, not aspirations: each sits a little
 * above what the site measured when it was set (see perf-budget.json), so a
 * change that makes a page heavier has to say so by moving a number here —
 * which is a line in a diff somebody reads — rather than arriving unnoticed.
 *
 * What it cannot see: images and video (they depend on data and on the
 * viewer's screen), the HTML itself, and anything measured in time. Those
 * budgets live beside these in perf-budget.json and are checked by hand
 * against Lighthouse; this checks the ones a build can prove.
 */
import { readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const dist = process.env.NEXT_DIST_DIR || '.next';
const budget = JSON.parse(readFileSync('perf-budget.json', 'utf8'));

if (!existsSync(join(dist, 'app-build-manifest.json'))) {
  console.error(`perf-budget: no build in ${dist}/ — run \`pnpm build\` first.`);
  process.exit(2);
}

const appManifest = JSON.parse(readFileSync(join(dist, 'app-build-manifest.json'), 'utf8'));
const buildManifest = JSON.parse(readFileSync(join(dist, 'build-manifest.json'), 'utf8'));
const fontManifest = JSON.parse(readFileSync(join(dist, 'server/next-font-manifest.json'), 'utf8'));

const gz = new Map();
const gzipped = (file) => {
  if (!gz.has(file)) gz.set(file, gzipSync(readFileSync(join(dist, file))).length);
  return gz.get(file);
};
const raw = (file) => readFileSync(join(dist, file)).length;
const kb = (bytes) => Math.round((bytes / 1024) * 10) / 10;

const shared = buildManifest.rootMainFiles.filter((f) => f.endsWith('.js'));
const sharedKb = kb(shared.reduce((sum, f) => sum + gzipped(f), 0));

const failures = [];
const rows = [];

function check(label, measured, limit) {
  const ok = measured <= limit;
  rows.push({ check: label, measured_kb: measured, budget_kb: limit, ok: ok ? 'yes' : 'OVER' });
  if (!ok) failures.push(`${label}: ${measured} KB > ${limit} KB`);
}

check('shared framework JS (gzip)', sharedKb, budget.javascript.sharedKb);

for (const [group, spec] of Object.entries(budget.javascript.firstLoad)) {
  for (const route of spec.routes) {
    const files = appManifest.pages[route];
    if (!files) {
      failures.push(`${route}: not in this build — renamed? update perf-budget.json`);
      continue;
    }
    // The page's own entry plus every layout above it, the way Next counts
    // "First Load JS": /[locale]/layout, then (site)/layout, and so on down.
    const segments = route.split('/').slice(1, -1);
    const layouts = segments.map((_, i) => `/${segments.slice(0, i + 1).join('/')}/layout`);
    const entries = [...layouts.filter((key) => appManifest.pages[key]), route];
    const js = [...new Set([...shared, ...entries.flatMap((key) => appManifest.pages[key]).filter((f) => f.endsWith('.js'))])];
    check(`${group}: ${route.replace('/[locale]', '')} first-load JS`, kb(js.reduce((s, f) => s + gzipped(f), 0)), spec.kb);
  }
}

const css = new Set();
for (const files of Object.values(appManifest.pages)) for (const f of files) if (f.endsWith('.css')) css.add(f);
check('stylesheets, all routes (gzip)', kb([...css].reduce((s, f) => s + gzipped(f), 0)), budget.css.totalKb);

// Fonts are already compressed (woff2); what is preloaded is what every visit pays.
const preloaded = new Set();
for (const files of Object.values(fontManifest.app ?? {})) for (const f of files) preloaded.add(f);
check('preloaded fonts per page (woff2)', kb([...preloaded].reduce((s, f) => s + raw(join('static/media', f.split('/').pop())), 0)), budget.fonts.preloadedKb);

console.table(rows);
if (failures.length) {
  console.error(`\nperf-budget: ${failures.length} over budget\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(`\nperf-budget: all ${rows.length} checks within budget`);
