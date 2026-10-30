/**
 * Saved replies' words (src/lib/replies.ts, Phase B 06): only the listed
 * variables are allowed, each is filled where a value is known, and one with
 * no value is left as written rather than dropped.
 *
 * Run with: node --experimental-strip-types scripts/replies.test.mjs
 */
import { register } from 'node:module';

register('../supabase/tests/alias-hooks.mjs', import.meta.url);

const { fillReply, firstName, unknownReplyVariables } = await import('../src/lib/replies.ts');

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

check('the listed variables are allowed', unknownReplyVariables('أهلًا {first_name}، بخصوص {job} في {company} ({stage}) — {name}').length === 0);
check('anything else in braces is named', unknownReplyVariables('{phone} و{email} و{name}').join(' ') === '{phone} {email}');
check('each is filled', fillReply('أهلًا {first_name}، بخصوص {job}', { first_name: 'سارة', job: 'استشاري مبيعات' }) === 'أهلًا سارة، بخصوص استشاري مبيعات');
check('a variable with no value is left as written', fillReply('{name} — {stage}', { name: 'سارة عادل' }) === 'سارة عادل — {stage}');
check('the first name is the first word', firstName('  سارة   عادل ') === 'سارة');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
