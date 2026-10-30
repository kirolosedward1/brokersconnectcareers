/**
 * The spreadsheet file (src/lib/csv.ts, Phase B 04): Excel reads it as UTF-8,
 * a comma or a quote stays inside its cell, and nothing typed by a person
 * runs as a formula.
 *
 * Run with: node --experimental-strip-types scripts/csv.test.mjs
 */
import { register } from 'node:module';

register('../supabase/tests/alias-hooks.mjs', import.meta.url);

const { CSV_BOM, csvCell, toCsv } = await import('../src/lib/csv.ts');

let pass = 0;
let fail = 0;
function check(label, condition) {
  if (condition) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}`);
  }
}

const file = toCsv([
  ['الوقت', 'العضو'],
  ['2026-10-30 10:00', 'منى، المجنّدة'],
]);
check('starts with the byte-order mark', file.startsWith(CSV_BOM));
check('rows end in CRLF', file.endsWith('\r\n') && file.split('\r\n').length === 3);
check('an Arabic comma needs no quotes', file.includes('\r\n2026-10-30 10:00,منى، المجنّدة\r\n'));
check('a comma keeps its cell', csvCell('a,b') === '"a,b"');
check('a quote is doubled', csvCell('say "hi"') === '"say ""hi"""');
check('a line break is quoted', csvCell('one\ntwo') === '"one\ntwo"');
check('a formula is defused', csvCell('=HYPERLINK("x")') === `"'=HYPERLINK(""x"")"`);
check('so are + - @', csvCell('+20100') === "'+20100" && csvCell('-1') === "'-1" && csvCell('@me') === "'@me");
check('a number is written as it is', csvCell(-3) === '-3' && csvCell(5) === '5');
check('nothing is an empty cell', csvCell(null) === '' && csvCell(undefined) === '');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
