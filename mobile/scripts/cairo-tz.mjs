/**
 * Writes src/lib/cairo-tz.json: the formatjs time-zone data for Cairo alone.
 *
 * Every date the app writes is in Cairo's calendar — src/lib/format.ts, and
 * the catalogue's dates through TIME_ZONE in src/i18n/provider.tsx. The
 * polyfill's "golden" set carries 246 zones: 800 KB of the bundle, unpacked at
 * every launch. This keeps its shared tables and its Cairo entry, exactly as
 * the package ships them.
 *
 * Run it after upgrading @formatjs/intl-datetimeformat:
 *
 *   node scripts/cairo-tz.mjs
 *
 * tests/intl.test.ts fails while the file differs from the package's data.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const source = readFileSync(require.resolve('@formatjs/intl-datetimeformat/add-golden-tz.js'), 'utf8');
const call = '__addTZData(';
const golden = JSON.parse(source.slice(source.indexOf(call) + call.length, source.lastIndexOf('})') + 1));
const zones = golden.zones.filter((zone) => zone.startsWith('Africa/Cairo|'));
if (zones.length !== 1) throw new Error(`Expected one Africa/Cairo entry in the golden data, found ${zones.length}`);

const out = new URL('../src/lib/cairo-tz.json', import.meta.url);
writeFileSync(out, `${JSON.stringify({ ...golden, zones }, null, 2)}\n`);
console.log(`Wrote ${out.pathname}`);
