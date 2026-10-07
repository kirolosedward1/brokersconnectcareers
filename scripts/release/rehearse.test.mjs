#!/usr/bin/env node
/**
 * The rehearsal, on production's ledger as it reads today.
 *
 *   node scripts/release/rehearse.test.mjs
 *
 * Since the release of 2026-09-29, production's ledger records the files that
 * release ran under their own versions, and Supabase lists a ledger by version:
 * those files come first, ahead of everything they ran after. Replayed in that
 * order, 068 met a database with no tables, and `pnpm db:rehearse:ledger` could
 * not rebuild production at all. It replays in the order production ran them
 * (replayOrder in migrations.mjs), and this checks that against production
 * itself: the rebuild has production's fingerprint, read 2026-10-02 per kind,
 * and what production is missing applies on top of it and ends where main does.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../env.mjs';
import { reporter } from '../../supabase/tests/setup.mjs';
import { buildFromLedger, fingerprint, migrationFiles, rehearse } from './rehearse.mjs';
import { replayOrder } from './migrations.mjs';

const fixture = (name) => JSON.parse(readFileSync(join(ROOT, 'scripts', 'release', 'fixtures', name), 'utf8'));
const ledger = fixture('production-ledger-2026-10-02.json').migrations;
const production = fixture('production-fingerprint-2026-10-02.json').kinds;
const t = reporter();

t.section('the order production ran its ledger in');
const order = replayOrder(ledger, migrationFiles()).map((row) => row.version);
const at = (version) => order.indexOf(version);
const released = ledger.map((row) => row.version).filter((version) => version.startsWith('20260101'));
const timed = ledger.map((row) => row.version).filter((version) => !version.startsWith('20260101'));
t.check('Supabase lists the files of the release of 2026-09-29 first', ledger[0].version === '20260101000068', ledger[0].version);
t.check('they ran after the files of 2026-09-27', at('20260101000068') > at('20260927171005'));
t.check('and before 331, applied on 2026-09-30', at('20260101000330') < at('20260930190621'));
t.check(
  'together, in file order',
  released.every((version, i) => at(version) === at(released[0]) + i),
  released.map(at).join(' '),
);
t.check(
  'and every other row keeps the order of its time',
  timed.every((version, i) => i === 0 || at(version) > at(timed[i - 1])),
);
t.check('nothing is lost or added', order.length === ledger.length && new Set(order).size === ledger.length);

t.section('the rebuild is production');
const { db } = await buildFromLedger({ ledgerRows: ledger });
const print = await fingerprint(db);
await db.close();
for (const { kind, n, h } of production) {
  // As read on production: md5 of name=hash, joined with commas in name order.
  const entries = [...print]
    .filter(([key]) => key.startsWith(`${kind} `))
    .map(([key, hash]) => [key.slice(kind.length + 1), hash])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const digest = createHash('md5')
    .update(entries.map(([name, hash]) => `${name}=${hash}`).join(','))
    .digest('hex');
  t.check(`${kind}: ${n}, each as on production`, entries.length === n && digest === h, `${entries.length} ${digest}`);
}

t.section('what production is missing applies on top of it');
const result = await rehearse({ ledgerRows: ledger, log: () => {} });
t.check('every pending file applies', result.failures.length === 0, JSON.stringify(result.failures));
t.check(
  'from 332, the first file production was missing on the day',
  result.pending[0]?.startsWith('20260101000332_') && result.pending.some((stem) => stem.startsWith('20260101000343_')),
  result.pending.join(', '),
);
t.check(
  'ending where main does, object for object',
  result.diff.same,
  [...result.diff.onlyLeft, ...result.diff.onlyRight, ...result.diff.changed].slice(0, 10).join(', '),
);
t.check('and the seed and the demo data load', result.seeded);

process.exit(t.finish() ? 0 : 1);
