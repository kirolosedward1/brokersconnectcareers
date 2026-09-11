#!/usr/bin/env node
/**
 * The commission picture is arithmetic on two self-reported numbers, so the
 * only thing worth testing is that it never invents one. Every case here is a
 * shape the production data actually contains: percentage/split/none, a
 * consultant with both figures, with one, and with neither.
 */
import { commissionPicture } from '../src/lib/earnings.ts';

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
};
const is = (actual, expected, label) =>
  check(label, Object.is(actual, expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

const pct = (value) => ({ commission_type: 'percentage', commission_value: value });
const RECORD = { unitsClosed: 20, volumeEgp: 48_000_000 };

console.log('\n— nothing is computed without a published rate');
is(commissionPicture({ commission_type: 'split', commission_value: null }, RECORD), null, 'a split commission is not a number');
is(commissionPicture({ commission_type: 'none', commission_value: null }, RECORD), null, 'no commission is not a number');
is(commissionPicture({ commission_type: 'undisclosed', commission_value: null }, RECORD), null, 'an undisclosed commission is not a number');
is(commissionPicture({ commission_type: 'percentage', commission_value: null }, RECORD), null, 'percentage with no value is not a number');
is(commissionPicture(pct(0), RECORD), null, 'a zero rate is not a rate');
is(commissionPicture(pct(Number.NaN), RECORD), null, 'NaN never reaches the page');

console.log('\n— both figures: a commission per deal');
{
  const picture = commissionPicture(pct(2.5), RECORD);
  is(picture.kind, 'per_unit', 'the strongest form is used when both figures exist');
  is(picture.averageUnit, 2_400_000, '48m over 20 units is a 2.4m average unit');
  is(picture.perUnit, 60_000, '2.5% of 2.4m is 60,000 a deal');
  is(picture.units, 20, 'the basis carries the unit count back for the sentence');
  is(picture.volume, 48_000_000, 'and the total it came from');
}

console.log('\n— value but no unit count: the total, and only the total');
{
  const picture = commissionPicture(pct(3), { unitsClosed: null, volumeEgp: 10_000_000 });
  is(picture.kind, 'on_total', 'without units there is no average deal to price');
  is(picture.total, 300_000, '3% of 10m');
}
is(commissionPicture(pct(3), { unitsClosed: 0, volumeEgp: 10_000_000 }).kind, 'on_total', 'zero units never divides');

console.log('\n— nothing of their own yet');
is(commissionPicture(pct(2), { unitsClosed: null, volumeEgp: null }).kind, 'no_record', 'a rate with nothing to measure it against asks for the record');
is(commissionPicture(pct(2), { unitsClosed: 12, volumeEgp: null }).kind, 'no_record', 'units alone cannot price a deal');
is(commissionPicture(pct(2), { unitsClosed: 12, volumeEgp: 0 }).kind, 'no_record', 'a zero total is the same as none');

console.log('\n— rounding lands on whole pounds');
{
  const picture = commissionPicture(pct(2.75), { unitsClosed: 3, volumeEgp: 10_000_000 });
  is(picture.averageUnit, 3_333_333, 'the average unit is a whole number');
  is(picture.perUnit, 91_667, 'and so is the commission on it');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
