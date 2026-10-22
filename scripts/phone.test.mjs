/**
 * Which WhatsApp numbers are kept, and that every form asks the same rule.
 *
 *   node --experimental-strip-types scripts/phone.test.mjs
 *
 * Onboarding checked only the international shape, so "0100 123 456" — an
 * Egyptian mobile one digit short — was stored as +20100123456: a number that
 * reaches nobody, handed to every employer who revealed the contact, and
 * refused by the apply form when it came back pre-filled.
 */
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('../supabase/tests/alias-hooks.mjs', import.meta.url);

const { isValidPhone, normalisePhone } = await import('../src/lib/phone.ts');

let pass = 0;
let fail = 0;
function is(label, got, want) {
  if (got === want) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

console.log('— numbers');
is('an Egyptian mobile as typed', isValidPhone('0100 123 4567'), true);
is('in Arabic-Indic digits', isValidPhone('٠١٠٠١٢٣٤٥٦٧'), true);
is('stored in E.164', normalisePhone('0100 123 4567'), '+201001234567');
is('every network: 010', isValidPhone('01001234567'), true);
is('every network: 011', isValidPhone('01101234567'), true);
is('every network: 012', isValidPhone('01201234567'), true);
is('every network: 015', isValidPhone('01501234567'), true);
is('no network: 013', isValidPhone('01301234567'), false);
is('no network: 014', isValidPhone('+201401234567'), false);
is('no network: 019', isValidPhone('01901234567'), false);
is('one digit short is refused', isValidPhone('0100 123 456'), false);
is('in Arabic-Indic digits too', isValidPhone('٠١٠٠١٢٣٤٥٦'), false);
is('an Egyptian landline is not a WhatsApp number', isValidPhone('+20 2 2345 6789'), false);
is('a foreign mobile in full international form is kept', isValidPhone('+971 50 123 4567'), true);

console.log('\n— every action that takes a number asks the same rule');
for (const file of ['onboarding', 'applications', 'agent-profile']) {
  const source = readFileSync(new URL(`../src/lib/actions/${file}.ts`, import.meta.url), 'utf8');
  is(`${file}.ts validates with isValidPhone`, /normalisePhone\(/.test(source) && /isValidPhone\(/.test(source), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
