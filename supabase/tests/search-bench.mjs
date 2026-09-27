/**
 * Search at scale: query plans, measured rather than guessed.
 *
 *   pnpm bench:search            (20,000 listings)
 *   BENCH_JOBS=50000 pnpm bench:search
 *
 * Loads the real migrations into PGlite, adds a synthetic board far larger
 * than production, and prints EXPLAIN ANALYZE for the query shapes PostgREST
 * sends for the board, the company directory and the agent directory — run as
 * `anon`, so row-level security is in every plan, as it is in production.
 *
 * Not part of `pnpm check`: it takes a minute, and it asserts nothing about
 * correctness. PGlite is Postgres compiled to WebAssembly and runs single
 * threaded, so absolute times are pessimistic next to a Supabase instance —
 * what transfers is the plan shape and the ratio between shapes.
 */
import { createTestDb } from './setup.mjs';
import { buildJobQuery, searchPhrases } from '../../src/lib/search/arabic.ts';

const JOBS = Number(process.env.BENCH_JOBS ?? 20000);
const COMPANIES = 2000;
const AGENTS = 5000;

const db = await createTestDb();
const t0 = Date.now();

// Words the board actually uses, so selectivity is realistic: a few very
// common (مبيعات, sales), most rare.
await db.exec(`
  create temp table vocab_title(w text);
  insert into vocab_title values
    ('استشاري مبيعات'),('مدير مبيعات'),('مسئول مبيعات'),('Sales Consultant'),('Sales Manager'),
    ('تيم ليدر مبيعات'),('محاسب'),('خدمة عملاء'),('مسوق عقاري'),('Property Advisor'),
    ('مهندس موقع'),('أخصائي إيجارات'),('مدير فرع'),('Leasing Consultant'),('سكرتارية'),
    ('مسؤول تسويق إلكتروني'),('Broker'),('مندوب مبيعات'),('Team Leader'),('مدير إدارة أملاك');

  create temp table vocab_body(w text);
  insert into vocab_body values
    ('خبرة'),('في'),('المبيعات'),('العقارية'),('مطلوب'),('للعمل'),('بشركة'),('كبرى'),('عمولة'),
    ('مجزية'),('راتب'),('أساسي'),('تأمينات'),('مشروعات'),('التجمع'),('العاصمة'),('الإدارية'),
    ('الساحل'),('الشمالي'),('إجادة'),('اللغة'),('الإنجليزية'),('رخصة'),('قيادة'),('تارجت'),
    ('شهري'),('فريق'),('عمل'),('بيئة'),('تدريب'),('مستمر'),('والتسويق'),('بالتقسيط');
`);

// Triggers off for the load, then one refresh — which is also the measurement
// of what an alias or district edit costs at this size.
await db.exec(`set session_replication_role = replica;`);

await db.exec(`
  insert into companies (id, owner_id, name_ar, name_en, slug, verification_status, company_type)
  select gen_random_uuid(), gen_random_uuid(),
         (array['شركة','مجموعة','بيت','دار'])[1 + i % 4] || ' ' ||
         (array['الأهرام','النيل','الرواد','المستقبل','الصفوة','الريادة','إعمار','الدلتا'])[1 + i % 8] || ' ' || i,
         (array['Pyramids','Nile','Pioneers','Future','Elite','Leaders','Emaar','Delta'])[1 + i % 8] || ' Realty ' || i,
         'bench-co-' || i,
         (array['verified','unverified'])[1 + i % 2]::verification_status,
         (array['brokerage','developer',null])[1 + i % 3]
    from generate_series(1, ${COMPANIES}) as i;
`);

await db.exec(`
  insert into jobs (company_id, title_ar, title_en, slug, track, employment_type, experience_band,
                    district_id, basic_salary_min, basic_salary_max, commission_type, commission_value,
                    leads_source, description_ar, status, is_featured, published_at, expires_at)
  select c.id,
         (select w from vocab_title offset (i * 7) % 20 limit 1),
         case when i % 3 = 0 then 'Sales role ' || i end,
         'bench-job-' || i,
         (enum_range(null::job_track))[1 + i % 6],
         (enum_range(null::employment_type))[1 + i % 3],
         (enum_range(null::experience_band))[1 + i % 4],
         d.id,
         case when i % 4 = 0 then null else 4000 + (i % 8) * 1000 end,
         case when i % 4 = 0 then null else 6000 + (i % 8) * 1000 + (i % 5) * 1000 end,
         (array['percentage','split','undisclosed','none'])[1 + i % 4]::commission_type,
         case when i % 4 = 0 then 2.5 end,
         (enum_range(null::leads_source))[1 + i % 3],
         (select string_agg(w, ' ') from (
            select w from vocab_body order by md5(w || i) limit 12) s),
         -- Not i % 10: the title is chosen by i too, and the two moduli would
         -- line up so that every listing with one title had one status.
         case when (i / 7) % 10 < 8 then 'active' when (i / 7) % 10 = 8 then 'expired' else 'draft' end::job_status,
         i % 50 = 0,
         now() - ((i % 30) || ' days')::interval - ((i % 1440) || ' minutes')::interval,
         now() + ((30 - i % 30) || ' days')::interval
    from generate_series(1, ${JOBS}) as i
    join lateral (select id from companies order by md5(id::text || i) limit 1) c on true
    join lateral (select id from districts order by md5(id::text || i) limit 1) d on true;
`);

await db.exec(`
  insert into auth.users (id, email) select gen_random_uuid(), 'bench' || i || '@x.test' from generate_series(1, ${AGENTS}) i;
  insert into profiles (id, role, full_name, whatsapp_phone)
  select u.id, 'candidate', 'مستشار ' || row_number() over (), '+201000000000'
    from auth.users u where u.email like 'bench%';
  insert into agent_profiles (user_id, slug, headline_ar, headline_en, years_experience, tracks, district_ids, visibility)
  select p.id, 'bench-agent-' || p.n,
         (select w from vocab_title offset p.n % 20 limit 1) || ' - التجمع',
         'Consultant', p.n % 15,
         array[(enum_range(null::job_track))[1 + p.n % 6]],
         array[(select id from districts limit 1)],
         (array['public','verified_employers_only','hidden'])[1 + p.n % 3]::agent_visibility
    from (select id, (row_number() over ())::int as n from profiles
           where full_name like 'مستشار %') p;
`);

await db.exec(`set session_replication_role = origin;`);

const load = Date.now() - t0;
const r0 = Date.now();
await db.query(`select public.refresh_job_search(null)`);
const refresh = Date.now() - r0;

await db.exec(`analyze;`);

const counts = (await db.query(`
  select (select count(*) from jobs) jobs,
         (select count(*) from jobs where status = 'active' and expires_at > now()) live,
         (select count(*) from job_search_documents) documents,
         (select count(*) from companies) companies,
         (select count(*) from agent_profiles) agents
`)).rows[0];

console.log(`loaded in ${load} ms:`, counts);
console.log(`refresh_job_search(null) — every public document rebuilt: ${refresh} ms`);

// What an admin adding one alias costs: only that district's listings.
const a0 = Date.now();
await db.query(`insert into search_aliases (district_id, alias)
                select id, 'Bench alias' from districts where slug = 'new-cairo'`);
console.log(`one district alias added — its listings rebuilt: ${Date.now() - a0} ms\n`);

const phrases = searchPhrases(
  (await db.query(`
    select name_ar n from districts union all select name_en from districts
    union all select name_ar from governorates union all select name_en from governorates
    union all select alias from search_aliases`)).rows.map((row) => row.n),
);

/** Roughly the SQL PostgREST writes for the board, with or without the search embed. */
function boardSql({ tsquery = null, where = '', count = false }) {
  const search = tsquery
    ? `join lateral (select 1 from job_search_documents s
                      where s.job_id = j.id and s.document @@ to_tsquery('simple', '${tsquery}')) s on true`
    : '';
  const from = `
    from jobs j
    join lateral (select c.id, c.name_ar, c.name_en, c.slug, c.logo_url, c.verification_status, c.company_type
                    from companies c where c.id = j.company_id) co on true
    join lateral (select d.* from districts d where d.id = j.district_id) di on true
    ${search}
   where j.status = 'active' and j.expires_at > now() ${where}`;
  return count
    ? `select count(*) ${from}`
    : `select j.*, row_to_json(co) as company, row_to_json(di) as district ${from}
        order by j.is_featured desc, j.published_at desc, j.id desc limit 20 offset 0`;
}

async function explain(label, sql) {
  await db.exec('begin; set local role anon;');
  try {
    // Twice, and the second timed: the first warms PGlite's buffer cache.
    await db.query(sql);
    const { rows } = await db.query(`explain (analyze, buffers off) ${sql}`);
    const plan = rows.map((row) => row['QUERY PLAN']);
    const total = plan.find((line) => line.startsWith('Execution Time'));
    console.log(`── ${label} — ${total}`);
    for (const line of plan.filter((l) => !l.startsWith('Planning') && !l.startsWith('Execution'))) {
      if (/Scan|Join|Sort|Limit|Aggregate|Loop|Filter:|Index Cond|Recheck/.test(line)) {
        console.log(`   ${line}`);
      }
    }
    console.log();
  } finally {
    await db.exec('rollback;');
  }
}

const q = (text) => buildJobQuery(text, phrases).replaceAll("'", "''");

// How selective each keyword is, so the plans below can be read against it.
for (const keyword of ['مبيعات', 'محاسب', 'Sales New Cairo', 'القاهرة الجديدة', 'مدير', 'النيل 17']) {
  const { rows } = await db.query(
    `select count(*)::int as n from job_search_documents where document @@ to_tsquery('simple', $1)`,
    [buildJobQuery(keyword, phrases)],
  );
  console.log(`matches ${String(rows[0].n).padStart(6)}  ${keyword}  →  ${buildJobQuery(keyword, phrases)}`);
}
console.log();

await explain('board, no keyword (the landing view)', boardSql({}));
await explain('board, count, no keyword', boardSql({ count: true }));
await explain('keyword: مبيعات (matches most listings)', boardSql({ tsquery: q('مبيعات') }));
await explain('keyword: مبيعات, count', boardSql({ tsquery: q('مبيعات'), count: true }));
await explain('keyword: محاسب (one listing in twenty)', boardSql({ tsquery: q('محاسب') }));
await explain('keyword: one company by name (a handful of listings)', boardSql({ tsquery: q('النيل 17') }));
await explain('keyword that matches nothing', boardSql({ tsquery: q('غواصة') }));
await explain('keyword: "Sales New Cairo" (mixed, phrase)', boardSql({ tsquery: q('Sales New Cairo') }));
await explain('keyword: القاهرة الجديدة, count', boardSql({ tsquery: q('القاهرة الجديدة'), count: true }));
await explain('keyword + track + district',
  boardSql({ tsquery: q('مدير'), where: `and j.track = 'resale' and j.district_id in (1,2,3)` }));
await explain('posted within 7 days + commission',
  boardSql({ where: `and j.published_at >= now() - interval '7 days' and j.commission_type in ('percentage','split')` }));
await explain('min salary 15000',
  boardSql({ where: `and (j.basic_salary_max >= 15000 or (j.basic_salary_max is null and j.basic_salary_min >= 15000))` }));
await explain('company type = developer',
  boardSql({ where: `and co.company_type = 'developer'` }));
await explain('deep page: keyword, offset 2000',
  boardSql({ tsquery: q('مبيعات') }).replace('offset 0', 'offset 2000'));

await explain('companies: الاهرام ريادة', `
  select c.* from companies c
   where c.search_name ilike '%اهرام%' and c.search_name ilike '%ريادة%'
   order by c.verification_status, c.name_ar, c.id limit 24`);

await explain('agents: search_agents(q = مدير التجمع)',
  `select * from search_agents(null, null, null, null, 24, 0, 'مدير التجمع')`);
await explain('agents: search_agents, no keyword',
  `select * from search_agents(null, null, null, null, 24, 0)`);
