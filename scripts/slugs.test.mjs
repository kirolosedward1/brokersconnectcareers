/**
 * The public addresses of listings, companies and consultants (slug.ts).
 *
 *   pnpm test:slugs
 *
 * A slug is in every shared link and every search result, and two of its
 * rules are promises rather than style: a consultant's address never carries
 * their name (one who chose "verified employers only" is anonymous to
 * everybody else, and the URL used to say who they were), and the random id
 * is not a counter anyone can walk or read the directory's size from.
 */
import { transliterate, slugify, slugId, buildJobSlug, buildCompanySlug, buildAgentSlug } from '../src/lib/slug.ts';

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

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

console.log('\n— words into a slug');
{
  check('English', slugify('Senior Property Consultant — New Cairo') === 'senior-property-consultant-new-cairo', slugify('Senior Property Consultant — New Cairo'));
  const arabic = slugify('استشاري مبيعات');
  check('Arabic becomes readable ASCII, never percent-encoded script', SLUG.test(arabic) && arabic === 'astshary-mbyaat', arabic);
  check('harakat and tatweel carry nothing', transliterate('مُـــدِير') === transliterate('مدير'), transliterate('مُـــدِير'));
  check('Arabic-Indic digits become Western ones', slugify('برج ٢٠٢٦') === 'brg-2026', slugify('برج ٢٠٢٦'));
  check('Latin accents are folded', slugify('Café Résidence') === 'cafe-residence');
  check('runs of punctuation are one hyphen, none at the ends', slugify('  --Hello!!!  World--  ') === 'hello-world');
  check('nothing usable is an empty slug', slugify('!!! ؟؟ ***') === '');

  // Eight nine-character words: the 72nd character is a hyphen.
  const long = slugify('abcdefgh '.repeat(12));
  check('bounded at 72 characters', long.length <= 72, String(long.length));
  check('and never left ending on a hyphen by the cut', !long.endsWith('-'), long);

  for (const input of ['مدير مبيعات – التجمع الخامس', 'Sales/Leasing (Sheikh Zayed)', 'ألف باء', '<script>x</script>', '../../etc']) {
    const s = slugify(input);
    check(`${JSON.stringify(input)} → ${JSON.stringify(s)} is a clean slug`, SLUG.test(s));
  }
}

console.log('\n— the random id');
{
  const ids = Array.from({ length: 4000 }, () => slugId());
  check('six digits by default', ids.every((id) => /^\d{6}$/.test(id)), ids.find((id) => !/^\d{6}$/.test(id)));
  check('never a leading zero', ids.every((id) => id[0] !== '0'));
  check('4000 ids, almost all distinct (not a counter)', new Set(ids).size > 3950, String(new Set(ids).size));
  check('the length asked for', /^\d{8}$/.test(slugId(8)) && /^\d{3}$/.test(slugId(3)));

  // Rejection sampling is what keeps 0–5 from turning up more than 6–9. Over
  // the last five digits of 4000 ids — 20 000 draws — each digit is expected
  // 2000 times; a plain `byte % 10` skews 0–5 up by ~2.3%, under the noise at
  // this size, so this guards against something far worse: a constant digit,
  // a digit that never appears, a range off by one.
  const counts = Array(10).fill(0);
  for (const id of ids) for (const d of id.slice(1)) counts[d] += 1;
  check('every digit turns up, about as often as every other',
    counts.every((n) => n > 1700 && n < 2300), counts.join(' '));
}

console.log('\n— whole slugs');
{
  const job = buildJobSlug('استشاري مبيعات', 'new-cairo');
  check('a listing is <title>-<district>-<id>', /^astshary-mbyaat-new-cairo-[1-9]\d{5}$/.test(job), job);
  check('a listing with an unusable title is still a slug', /^job-maadi-\d{6}$/.test(buildJobSlug('؟؟؟', 'maadi')), buildJobSlug('؟؟؟', 'maadi'));

  const company = buildCompanySlug('Palm Hills Developments');
  check('a company is <name>-<id>', /^palm-hills-developments-[1-9]\d{5}$/.test(company), company);
  check('a company with an unusable name is still a slug', /^company-\d{6}$/.test(buildCompanySlug('***')));

  const agents = Array.from({ length: 200 }, () => buildAgentSlug());
  check('a consultant is consultant-<eight digits>, no name in it', agents.every((s) => /^consultant-[1-9]\d{7}$/.test(s)), agents[0]);
  check('and takes no argument a name could be passed in', buildAgentSlug.length === 0);
  check('200 consultants, 200 addresses', new Set(agents).size === 200);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
