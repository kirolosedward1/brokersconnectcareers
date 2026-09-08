/**
 * Arabic search, and the two copies of its normalisation.
 *
 * The folding exists in SQL, inside a generated column, and in TypeScript, on
 * the query. Neither can call the other, so the only thing keeping them
 * honest is this: one corpus through both, asserted equal. Run with:
 * pnpm test:search
 */
import { createTestDb, reporter } from './setup.mjs';
import { normaliseArabic, searchText } from '../../src/lib/search/arabic.ts';

const report = reporter();
const db = await createTestDb();

// Spelling people actually type, not synthetic cases.
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
  'Sales Consultant',
  'ال',
  'الا',
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
      report.check(`normalise("${input}")`, false, `sql=${sql} ts=${ts}`);
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
      report.check(`searchText("${input}")`, false, `sql=${sql} ts=${ts}`);
    }
  }
  report.check(`searchText agrees on all ${CORPUS.length} inputs`, searchMismatches === 0);
}

report.section('the folds people actually need');
{
  const norm = async (value) => (await db.query('select public.ar_normalise($1) as v', [value])).rows[0].v;

  report.check('harakat are dropped', (await norm('مُهَنْدِس')) === 'مهندس', await norm('مُهَنْدِس'));
  report.check('tatweel is dropped', (await norm('مـــبيعات')) === 'مبيعات', await norm('مـــبيعات'));
  report.check('every alef folds together',
    (await norm('أإآٱا')) === 'ا'.repeat(5), await norm('أإآٱا'));
  report.check('dotless ya folds to ya', (await norm('عقارى')) === 'عقاري', await norm('عقارى'));
  report.check('ta marbuta folds to ha', (await norm('شقة')) === 'شقه', await norm('شقة'));
  report.check('Arabic-Indic digits become Western', (await norm('٥ سنوات')) === '5 سنوات', await norm('٥ سنوات'));
}

report.section('a listing is found by what somebody would type');
{
  const job = (await db.query("select id from jobs where status='active' limit 1")).rows[0].id;
  await db.exec(`
    update jobs
       set title_ar = 'استشاري مبيعات في المعادي',
           description_ar = 'وسيط عقارى بخبرة'
     where id = '${job}'
  `);

  const finds = async (q) => {
    const { rows } = await db.query(
      `select count(*)::int as n from jobs
        where id = '${job}'
          and search_vector @@ websearch_to_tsquery('simple', public.ar_search_text($1))`,
      [q],
    );
    return rows[0].n === 1;
  };

  report.check('المعادي finds it', await finds('المعادي'));
  report.check('and so does معادي, without the article', await finds('معادي'));
  report.check('استشارى with a dotless ya finds استشاري', await finds('استشارى'));
  report.check('عقاري finds عقارى in the description', await finds('عقاري'));
  report.check('مُبيعات with harakat finds مبيعات', await finds('مُبيعات'));
  report.check('a word that is not there is not found', !(await finds('محاسب')));
}

process.exit(report.finish() ? 0 : 1);
