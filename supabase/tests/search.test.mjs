/**
 * Search: the Arabic normalisation, the listing's search document, and who
 * may find whom. Run with:
 *
 *   pnpm test:search
 *
 * The folding exists in SQL, inside the database, and in TypeScript, on the
 * query. Neither can call the other, so the only thing keeping them honest is
 * this: one corpus through both, asserted equal. Everything after that runs
 * the real query builder against the real documents the triggers write.
 */
import { readFileSync } from 'node:fs';
import { createTestDb, reporter, runner, FIXTURES } from './setup.mjs';
import {
  buildJobQuery,
  normaliseArabic,
  queryWords,
  searchPhrases,
  searchText,
} from '../../src/lib/search/arabic.ts';

const report = reporter();
const db = await createTestDb();
const as = runner(db);

// Spelling people actually type, and what a copy-paste brings with it.
const CORPUS = [
  'استشاري عقاري',
  'استشارى عقارى',
  'مُهَنْدِس مبيعات',
  'المعادي',
  'معادي',
  'التجمع الخامس',
  'إدارة أملاك',
  'ادارة املاك',
  'شقة للبيع',
  'مـــبيعات',
  'العاصمة الإدارية',
  'وسيط عقارات ٥ سنوات',
  'وسيط عقارات ۵ سنوات',
  'Sales Consultant',
  'ال',
  'الا',
  'والي',
  'مسئول مبيعات',
  'مسؤول مبيعات',
  'رئيس قسم',
  'خبرة في المبيعات والتسويق',
  'للتطوير العقاري',
  'بالتقسيط',
  '(المعادي)',
  '«التجمع»',
  '‏التجمع‏',
  'مبي‌عات',
  'ﻻ ﻣﺒﻴﻌﺎﺕ',
  'استشاری',
  '  مدير   مبيعات  ',
  'New  Cairo',
  '6 أكتوبر',
];

report.section('the SQL and TypeScript normalisers agree');
{
  let mismatches = 0;
  for (const input of CORPUS) {
    const { rows } = await db.query('select public.ar_normalise($1) as v', [input]);
    const sql = rows[0].v;
    const ts = normaliseArabic(input);
    if (sql !== ts) {
      mismatches += 1;
      report.check(`normalise(${JSON.stringify(input)})`, false, `sql=${sql} ts=${ts}`);
    }
  }
  report.check(`normalise agrees on all ${CORPUS.length} inputs`, mismatches === 0);

  let searchMismatches = 0;
  for (const input of CORPUS) {
    const { rows } = await db.query('select public.ar_search_text($1) as v', [input]);
    const sql = rows[0].v;
    const ts = searchText(input);
    if (sql !== ts) {
      searchMismatches += 1;
      report.check(`searchText(${JSON.stringify(input)})`, false, `sql=${sql} ts=${ts}`);
    }
  }
  report.check(`searchText agrees on all ${CORPUS.length} inputs`, searchMismatches === 0);
}

report.section('the folds people actually need');
{
  const norm = async (value) => (await db.query('select public.ar_normalise($1) as v', [value])).rows[0].v;
  const same = async (label, a, b) => {
    const [x, y] = [await norm(a), await norm(b)];
    report.check(label, x === y, `${x} / ${y}`);
  };

  report.check('harakat are dropped', (await norm('مُهَنْدِس')) === 'مهندس', await norm('مُهَنْدِس'));
  report.check('tatweel is dropped', (await norm('مـــبيعات')) === 'مبيعات', await norm('مـــبيعات'));
  report.check('every alef folds together',
    (await norm('أإآٱا')) === 'ا'.repeat(5), await norm('أإآٱا'));
  report.check('dotless ya folds to ya', (await norm('عقارى')) === 'عقاري', await norm('عقارى'));
  report.check('ta marbuta folds to ha', (await norm('شقة')) === 'شقه', await norm('شقة'));
  report.check('Arabic-Indic digits become Western', (await norm('٥ سنوات')) === '5 سنوات', await norm('٥ سنوات'));
  await same('مسئول and مسؤول are one word', 'مسئول', 'مسؤول');
  await same('a Persian yeh is a ya', 'استشاری', 'استشاري');
  await same('presentation forms pasted from a PDF are letters', 'ﻣﺒﻴﻌﺎﺕ', 'مبيعات');
  await same('a right-to-left mark is invisible, and ignored', '‏التجمع‏', 'التجمع');
  await same('a zero-width non-joiner inside a word is ignored', 'مبي‌عات', 'مبيعات');
  await same('runs of spaces are one space', '  مدير   مبيعات  ', 'مدير مبيعات');

  // What must NOT be folded away: a word that merely starts with the letters.
  const strip = async (value) =>
    (await db.query('select public.ar_strip_al($1) as v', [value])).rows[0].v;
  report.check('ال on its own stays', (await strip('ال')) === 'ال');
  report.check('الا stays — a word, not an article', (await strip('الا')) === 'الا');
  report.check('والي stays — three letters are not left behind', (await strip('والي')) === 'والي');
  report.check('والتسويق loses و and ال', (await strip('والتسويق')) === 'تسويق', await strip('والتسويق'));
  report.check('للتطوير loses لل', (await strip('للتطوير')) === 'تطوير', await strip('للتطوير'));
  report.check('(المعادي) loses its article inside the brackets',
    (await strip('(المعادي)')) === '(معادي)', await strip('(المعادي)'));
}

report.section('the query is built only from letters and digits');
{
  /*
    The words go into a to_tsquery expression and into PostgREST filters, so
    nothing that is syntax in either may survive. This used to be likeNeedle's
    job for the company search — a comma in «الرواد, للتطوير» became an extra
    OR term, and `%` a wildcard nobody typed. queryWords splits on anything
    that is not a letter or a digit, which covers both grammars at once.
  */
  const cases = [
    ['الرواد، للتطوير', ['رواد', 'تطوير']],
    ['x%),verification_status.eq.verified', ['x', 'verification', 'status', 'eq', 'verified']],
    ["sales' & !(manager:*)", ['sales', 'manager']],
    ['100% عقارات', ['100', 'عقارات']],
    ['  الرواد   ', ['رواد']],
    ['!!!', []],
  ];
  for (const [input, want] of cases) {
    const got = queryWords(input);
    report.check(`queryWords(${JSON.stringify(input)})`,
      JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));
  }

  report.check('nothing searchable is no query at all', buildJobQuery('!!! ؟') === null);
  report.check('eight words at most', queryWords('a b c d e f g h i j').length === 8);

  // Every builder output parses. A syntax error here is a 500 on the board.
  let unparsable = 0;
  for (const input of [...CORPUS, ...cases.map(([input]) => input), 'a', '5', 'New Cairo 6th']) {
    const tsq = buildJobQuery(input, [['new', 'cairo']]);
    if (!tsq) continue;
    await db.query(`select to_tsquery('simple', $1)`, [tsq]).catch(() => {
      unparsable += 1;
      report.check(`to_tsquery(${JSON.stringify(tsq)})`, false);
    });
  }
  report.check('every query the builder writes is valid tsquery syntax', unparsable === 0);
}

/*
  One listing under full control, and one decoy.

  The listing is a resale role in التجمع الخامس at the Rowad brokerage, selling
  SODIC. The decoy is in مصر الجديدة — Heliopolis, which is in Cairo — so it has
  "القاهرة" and "الجديدة" both in its document, just not next to each other.
  Superuser writes, so the triggers are what fill the documents.
*/
const ids = await db.query(`
  select
    (select id from jobs where status = 'active' order by id limit 1)            as job,
    (select id from jobs where status = 'active' order by id offset 1 limit 1)   as decoy,
    (select id from companies where slug like 'al-rowad-%')                      as rowad,
    (select id from districts where slug = 'new-cairo')                          as new_cairo,
    (select id from districts where slug = 'heliopolis')                         as heliopolis,
    (select id from developers where slug = 'sodic')                             as sodic
`);
const { job, decoy, rowad, new_cairo: newCairo, heliopolis, sodic } = ids.rows[0];

await db.exec(`
  update jobs
     set title_ar = 'مهندسين مبيعات',
         title_en = 'Sales engineers',
         description_ar = 'خبرة في المبيعات والتسويق مطلوبة.',
         track = 'resale',
         district_id = ${newCairo},
         company_id = '${rowad}'
   where id = '${job}';
  delete from job_developers where job_id = '${job}';
  insert into job_developers (job_id, developer_id) values ('${job}', ${sodic});

  update jobs
     set title_ar = 'مسئول حسابات',
         title_en = 'Accountant',
         description_ar = 'وظيفة إدارية.',
         track = 'back_office',
         district_id = ${heliopolis}
   where id = '${decoy}';
`);

const phrases = async () => {
  const { rows } = await db.query(`
    select name_ar as n from districts union all select name_en from districts
    union all select name_ar from governorates union all select name_en from governorates
    union all select alias from search_aliases
  `);
  return searchPhrases(rows.map((row) => row.n));
};
const PHRASES = await phrases();

const matches = async (id, q) => {
  const tsq = buildJobQuery(q, PHRASES);
  if (!tsq) return false;
  const { rows } = await db.query(
    `select count(*)::int as n from job_search_documents
      where job_id = $1 and document @@ to_tsquery('simple', $2)`,
    [id, tsq],
  );
  return rows[0].n === 1;
};

report.section('a listing is found by what somebody would type');
{
  // The title, however it was spelled.
  report.check('مهندس finds مهندسين — a prefix on the title', await matches(job, 'مهندس'));
  report.check('"sales engineer" finds "Sales engineers"', await matches(job, 'sales engineer'));
  report.check('مُهندسين with harakat finds it', await matches(job, 'مُهندسين'));

  // The place — none of these words are in the title or the description.
  report.check('التجمع finds a listing in التجمع الخامس', await matches(job, 'التجمع'));
  report.check('and so does تجمع, without the article', await matches(job, 'تجمع'));
  report.check('القاهرة الجديدة finds it, through its alias', await matches(job, 'القاهرة الجديدة'));
  report.check('القاهره الجديده, typed with ه, finds it', await matches(job, 'القاهره الجديده'));
  report.check('"New Cairo" finds it', await matches(job, 'New Cairo'));
  report.check('"Fifth Settlement" finds it, through its alias', await matches(job, 'Fifth Settlement'));
  report.check('"new cairo" in lower case finds it', await matches(job, 'new cairo'));

  // Mixed: two fields, two languages, one query.
  report.check('"Sales New Cairo" finds it', await matches(job, 'Sales New Cairo'));
  report.check('مبيعات التجمع finds it', await matches(job, 'مبيعات التجمع'));
  report.check('"sales التجمع" — English and Arabic in one query — finds it',
    await matches(job, 'sales التجمع'));

  // The specialisation, the company and the developers.
  report.check('ريسيل finds a resale listing', await matches(job, 'ريسيل'));
  report.check('«إعادة بيع» finds it', await matches(job, 'إعادة بيع'));
  report.check('the company\'s Arabic name finds it', await matches(job, 'الرواد العقارية'));
  report.check('the company\'s English name finds it', await matches(job, 'Rowad'));
  report.check('a developer the role sells finds it', await matches(job, 'سوديك'));
  report.check('and in English', await matches(job, 'SODIC'));

  // The description: whole words, with the article either way round.
  report.check('تسويق finds والتسويق in the description', await matches(job, 'تسويق'));
  report.check('التسويق finds it too', await matches(job, 'التسويق'));

  // What must not match.
  report.check('a word that is not there is not found', !(await matches(job, 'محاسب')));
  report.check('every word must match, not any', !(await matches(job, 'مبيعات الزمالك')));
  report.check('a prefix does not reach into the description — مطلو finds nothing',
    !(await matches(job, 'مطلو')));
  report.check('القاهرة الجديدة does not find مصر الجديدة in القاهرة',
    !(await matches(decoy, 'القاهرة الجديدة')));
  report.check('"New Cairo" does not find Heliopolis', !(await matches(decoy, 'New Cairo')));
}

report.section('the reverse direction migration 23 promised and did not keep');
{
  // A listing written without the article, searched for with it.
  await db.exec(`update jobs set title_ar = 'وسيط في معادي' where id = '${decoy}'`);
  report.check('المعادي finds a listing that says معادي', await matches(decoy, 'المعادي'));
  await db.exec(`update jobs set title_ar = 'مسئول حسابات' where id = '${decoy}'`);
  report.check('مسؤول finds a listing that says مسئول', await matches(decoy, 'مسؤول'));
  report.check('مسئول finds it as written', await matches(decoy, 'مسئول'));
}

report.section('the document follows what it is made from');
{
  await db.exec(`update companies set name_en = 'Pioneers Realty' where id = '${rowad}'`);
  report.check('a renamed company is found by its new name', await matches(job, 'Pioneers'));
  report.check('and no longer by its old one', !(await matches(job, 'Rowad')));

  // A new alias reaches every listing in the district without touching them.
  report.check('before the alias exists, Tagamo3 finds nothing', !(await matches(job, 'Tagamo3')));
  await db.exec(`insert into search_aliases (district_id, alias) values (${newCairo}, 'Tagamo3')`);
  report.check('after, it finds the listing', await matches(job, 'Tagamo3'));

  await db.exec(`delete from job_developers where job_id = '${job}'`);
  report.check('an untagged developer no longer finds it', !(await matches(job, 'سوديك')));

  const version = async () =>
    (await db.query(`select version from jobs where id = $1`, [job])).rows[0].version;
  const before = await version();
  await db.exec(`update companies set name_en = 'Al Rowad Real Estate' where id = '${rowad}'`);
  report.check(
    'refreshing the document does not touch the listing — nobody editing it sees a conflict',
    (await version()) === before,
  );

  const coverage = await db.query(`
    select
      (select count(*)::int from jobs j
        where j.status in ('active', 'expired', 'closed')
          and not exists (select 1 from job_search_documents s where s.job_id = j.id)) as missing,
      (select count(*)::int from job_search_documents s
         join jobs j on j.id = s.job_id
        where j.status not in ('active', 'expired', 'closed')) as extra
  `);
  report.check('every public listing has a document', coverage.rows[0].missing === 0,
    String(coverage.rows[0].missing));
  report.check('and no draft, pending or rejected one does', coverage.rows[0].extra === 0,
    String(coverage.rows[0].extra));
}

report.section('a search document is only as visible as its listing');
{
  /*
    The policy on job_search_documents is `true`, because an inherited policy
    made the index unusable (see migration 68). What makes `true` safe is that
    a document exists only while its listing is public — so that is what has
    to hold through every move a listing makes.
  */
  const hasDocument = async (id) =>
    (await db.query(`select count(*)::int as n from job_search_documents where job_id = $1`, [id]))
      .rows[0].n === 1;

  await db.exec(`update jobs set status = 'pending_review' where id = '${decoy}'`);
  report.check('a listing sent back to review loses its document', !(await hasDocument(decoy)));
  await db.exec(`update jobs set status = 'active' where id = '${decoy}'`);
  report.check('and gets it back when it is published again', await hasDocument(decoy));
  await db.exec(`update jobs set status = 'rejected' where id = '${decoy}'`);
  report.check('a rejected listing has none', !(await hasDocument(decoy)));
  await db.exec(`update jobs set status = 'closed' where id = '${decoy}'`);
  report.check('a closed one keeps its — its page is still public', await hasDocument(decoy));

  const draft = (await db.query(`select id from jobs where status = 'draft' limit 1`)).rows[0].id;
  const active = (await db.query(`select id from jobs where status = 'active' limit 1`)).rows[0].id;

  const anonDraft = await as(null, `select count(*)::int as n from job_search_documents where job_id = '${draft}'`, 'anon');
  report.check('a signed-out visitor cannot read a draft\'s document', anonDraft.ok && anonDraft.rows[0].n === 0);

  const anonActive = await as(null, `select count(*)::int as n from job_search_documents where job_id = '${active}'`, 'anon');
  report.check('but can read a live listing\'s', anonActive.ok && anonActive.rows[0].n === 1);

  const write = await as(FIXTURES.employerVerified,
    `update job_search_documents set document = to_tsvector('simple', 'spam')`);
  report.check('nobody writes a document directly', !write.ok || write.rows.length === 0);

  const rpc = await as(null, `select public.refresh_job_search(null)`, 'anon');
  report.check('the refresh function is not an API', !rpc.ok);
}

report.section('a company is found by its name however it was typed');
{
  const hits = async (q) => {
    const words = queryWords(q);
    const where = words.map((_, i) => `search_name ilike '%' || $${i + 1} || '%'`).join(' and ');
    const { rows } = await db.query(`select slug from companies where ${where}`, words);
    return rows.map((row) => row.slug);
  };
  const rowadSlug = (await db.query(`select slug from companies where id = $1`, [rowad])).rows[0].slug;

  report.check('«الرواد العقارية» finds «شركة الرواد العقارية»',
    (await hits('الرواد العقارية')).includes(rowadSlug));
  report.check('«رواد عقاريه» — no article, ه for ة — finds it',
    (await hits('رواد عقاريه')).includes(rowadSlug));
  report.check('"rowad real estate" finds it', (await hits('rowad real estate')).includes(rowadSlug));
  report.check('«الرواد للتطوير» does not — every word must be in the name',
    !(await hits('الرواد للتطوير')).includes(rowadSlug));
}

report.section('the agent directory searches only what the card shows');
{
  const search = (user, q, role = 'authenticated') =>
    as(user, `select slug, full_name from search_agents(null,null,null,null,60,0,${q === null ? 'null' : `'${q}'`})`, role);
  const slugs = (result) => result.rows.map((row) => row.slug);

  /*
    The directory answers approved employers and admins and nobody else
    (migration 322, `the_directory_is_for_employers`): a signed-out visitor is
    refused the function outright, and a candidate is answered with nothing.
    So the headline searches below run as an employer whose company is not
    verified — the reader with the least the directory will show.
  */
  const stranger = await search(null, 'إيجارات', 'anon');
  report.check('a signed-out visitor cannot search the directory at all',
    !stranger.ok && /permission denied/.test(stranger.error ?? ''), stranger.ok ? 'call was allowed' : stranger.error);

  const candidate = await search(FIXTURES.candidate, 'إيجارات');
  report.check('nor can a candidate find anybody', candidate.ok && candidate.rows.length === 0, candidate.error);

  // The headline is on every card the directory shows, so every reader may search it.
  const headline = await search(FIXTURES.employerUnverified, 'إيجارات');
  report.check('an unverified employer finds a consultant by headline',
    headline.ok && slugs(headline).includes('consultant-90952122'), headline.error);

  const english = await search(FIXTURES.employerUnverified, 'lettings Maadi');
  report.check('in English too', slugs(english).includes('consultant-90952122'));

  // A public profile shows its name, so its name is searchable.
  const publicName = await search(FIXTURES.employerUnverified, 'منة الله');
  report.check('a public consultant is found by name', slugs(publicName).includes('consultant-90952122'));

  /*
    The gate within the gate. «أحمد محمود» is verified-employers-only: an
    unverified employer sees the card without the name. Were the name
    searchable, the result count would answer "is Ahmed Mahmoud in this
    directory" for anyone who asked.
  */
  const gatedUnverified = await search(FIXTURES.employerUnverified, 'أحمد محمود');
  report.check('a gated name finds nothing for an unverified employer',
    gatedUnverified.ok && gatedUnverified.rows.length === 0, JSON.stringify(gatedUnverified.rows));

  const gatedVerified = await search(FIXTURES.employerVerified, 'احمد محمود');
  report.check('a verified employer finds them by name, typed without the hamza',
    slugs(gatedVerified).includes('consultant-81880411'));

  // Hidden means hidden, name or headline, to everyone short of admin.
  const hidden = await search(FIXTURES.employerVerified, 'عقارات تجارية');
  report.check('a hidden profile is not found even by its headline',
    !slugs(hidden).includes('consultant-33912555'));

  const unfiltered = await search(FIXTURES.employerVerified, null);
  const everyone = await as(FIXTURES.employerVerified, 'select slug from search_agents(null,null,null,null,60,0)');
  report.check('no keyword is the directory as it was',
    unfiltered.ok && slugs(unfiltered).length === slugs(everyone).length && slugs(everyone).length > 0);

  const injected = await search(FIXTURES.employerVerified, "x'' or true --");
  report.check('a keyword is data, not SQL', injected.ok && injected.rows.length === 0, injected.error);
}

report.section('a database seeded before the aliases gets them from migration 342');
{
  // Production's taxonomy was seeded before migration 68 and seed.sql did not
  // run there again: no aliases at all. 342 carries the seed's rows to it.
  const aliasSet = async () =>
    (
      await db.query(`
        select coalesce(d.slug, a.track::text) || ' ' || a.alias as row
          from search_aliases a
          left join districts d on d.id = a.district_id
         where a.alias <> 'Tagamo3'
         order by 1`)
    ).rows.map((r) => r.row);
  const seeded = await aliasSet();

  await db.exec(`delete from search_aliases`);
  report.check('without them, القاهرة الجديدة finds nothing', !(await matches(job, 'القاهرة الجديدة')));
  report.check('nor does ريسيل', !(await matches(job, 'ريسيل')));

  const migration = readFileSync(
    new URL('../migrations/20260101000342_the_names_people_search_by.sql', import.meta.url),
    'utf8',
  );
  await db.exec(migration);
  const restored = await aliasSet();
  report.check(
    `342 puts back the seed's ${seeded.length} aliases, and only those`,
    seeded.length === 25 && JSON.stringify(restored) === JSON.stringify(seeded),
    JSON.stringify({
      missing: seeded.filter((row) => !restored.includes(row)),
      extra: restored.filter((row) => !seeded.includes(row)),
    }),
  );
  report.check(
    'and the listing is found by them again, without anybody touching it',
    (await matches(job, 'القاهرة الجديدة')) && (await matches(job, 'ريسيل')),
  );

  await db.exec(migration);
  report.check('run twice, it adds nothing', (await aliasSet()).length === seeded.length);
}

report.section('the console finds a name however it is spelled');
{
  const { looseArabicNeedle } = await import('../../src/lib/search/needle.ts');
  report.check('«احمد» leaves the alef open', looseArabicNeedle('احمد') === '_حمد', looseArabicNeedle('احمد'));
  report.check('a final ى and ة are open too', looseArabicNeedle('مصطفي فاطمه') === 'مصطف_ ف_طم_', looseArabicNeedle('مصطفي فاطمه'));
  report.check('a wildcard the reader typed is still taken out', looseArabicNeedle('a_b%c') === 'a b c', looseArabicNeedle('a_b%c'));
  report.check('a term of nothing but open letters is left as typed', looseArabicNeedle('ا') === 'ا');
  const names = async (needle) =>
    (await db.query(`select full_name from profiles where full_name ilike $1 order by full_name`, [`%${needle}%`])).rows.map((row) => row.full_name);
  const found = await names(looseArabicNeedle('احمد محمود'));
  report.check('and the pattern finds «أحمد محمود» in the database', found.includes('أحمد محمود'), JSON.stringify(found));
}

process.exit(report.finish() ? 0 : 1);
