/**
 * Does the schema apply at all, and do the triggers do their job on seed data?
 * Run with: pnpm test:db
 */
import { createTestDb, reporter } from './setup.mjs';

const report = reporter();
const db = await createTestDb();

report.section('the schema applies and the taxonomies land');
for (const [label, sql, expected] of [
  ['governorates', 'select count(*)::int as n from governorates', 7],
  ['districts', 'select count(*)::int as n from districts', 21],
  ['developers', 'select count(*)::int as n from developers', 17],
]) {
  const { n } = (await db.query(sql)).rows[0];
  report.check(`${label}: ${n}`, n === expected, `expected ${expected}`);
}

report.section('publishing stamps the 30-day window');
{
  const rows = (
    await db.query(`
      select slug,
             expires_at is not null as stamped,
             (expires_at::date - published_at::date) as days
        from jobs where status = 'active'`)
  ).rows;

  report.check('every live listing has an expiry', rows.length > 0 && rows.every((r) => r.stamped));
  report.check('and it is exactly 30 days out', rows.every((r) => Number(r.days) === 30),
    JSON.stringify(rows.map((r) => r.days)));
}

report.section('a commission value is required only where it means something');
{
  const bad = await db
    .query(`insert into jobs (company_id, title_ar, slug, track, employment_type, experience_band,
              district_id, commission_type, commission_value, leads_source, description_ar)
            select id, 'x', 'x-1', 'primary', 'full_time', 'junior_1_3', 1, 'none', 2.5,
                   'company_provided', 'x' from companies limit 1`)
    .then(() => null)
    .catch((error) => error.message);
  report.check('a percentage on a "none" commission is rejected', bad !== null, 'insert succeeded');

  const missing = await db
    .query(`insert into jobs (company_id, title_ar, slug, track, employment_type, experience_band,
              district_id, commission_type, leads_source, description_ar)
            select id, 'x', 'x-2', 'primary', 'full_time', 'junior_1_3', 1, 'percentage',
                   'company_provided', 'x' from companies limit 1`)
    .then(() => null)
    .catch((error) => error.message);
  report.check('a percentage with no value is rejected', missing !== null, 'insert succeeded');
}

report.section('Arabic full-text search');
{
  const { rows } = await db.query(
    `select count(*)::int as n from jobs where search_vector @@ to_tsquery('simple', 'عقاري')`,
  );
  report.check(`matches Arabic terms (${rows[0].n} hits)`, rows[0].n > 0);
}

report.section('WhatsApp numbers are stored in E.164');
{
  const bad = await db
    .query(`update profiles set whatsapp_phone = '01001234567' where role = 'candidate'`)
    .then(() => null)
    .catch((error) => error.message);
  report.check('a local-format number is rejected at the column', bad !== null, 'update succeeded');
}

report.section('a report is always about a listing');
{
  /*
    The moderation queue groups open reports by job_id and offers one takedown
    per group. A report with no listing attached would be a card with nothing
    to act on and no way to leave the queue — so the column carries the rule
    rather than the page carrying a fallback for a row that cannot exist.
  */
  const orphan = await db
    .query(`insert into reports (job_id, reason) values (null, 'spam')`)
    .then(() => null)
    .catch((error) => error.message);
  report.check('a report with no job is rejected at the column', orphan !== null, 'insert succeeded');

  // And the pairing the grouped count depends on: one report per person per
  // listing, so a group of five is five people rather than one loud one.
  const job = (await db.query(`select id from jobs where status = 'active' limit 1`)).rows[0];
  const reporter_ = (await db.query(`select id from profiles where role = 'candidate' limit 1`)).rows[0];
  await db.query(`insert into reports (job_id, reporter_id, reason) values ($1, $2, 'spam')`, [
    job.id,
    reporter_.id,
  ]);
  const twice = await db
    .query(`insert into reports (job_id, reporter_id, reason) values ($1, $2, 'duplicate')`, [
      job.id,
      reporter_.id,
    ])
    .then(() => null)
    .catch((error) => error.message);
  report.check('the same person cannot report the same listing twice', twice !== null, 'insert succeeded');
}

report.section('every trigger function is hardened the same way');
{
  /*
    Migration 07 set a fixed search_path on the trigger functions and revoked
    EXECUTE from public, anon and authenticated, and every migration since has
    been expected to do the same for anything it adds. Two slipped: migration
    42 added record_application_event without the revoke, and migration 46
    restated stamp_job_publication without repeating its SET clause — which
    CREATE OR REPLACE treats as "remove it".

    Asked of the catalogue rather than of the migration files, because the
    catalogue is what is actually running.
  */
  const loose = await db.query(`
    select p.proname,
           (p.proconfig is null or not (array_to_string(p.proconfig, ',') like '%search_path%')) as no_search_path,
           (p.proacl is null or array_to_string(p.proacl::text[], ' ') like '=X/%')              as public_execute
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and pg_get_function_result(p.oid) = 'trigger'
  `);

  report.check('found the trigger functions', loose.rows.length > 15, String(loose.rows.length));

  const mutable = loose.rows.filter((row) => row.no_search_path).map((row) => row.proname);
  report.check(
    'each one pins its search_path',
    mutable.length === 0,
    mutable.join(', ') || 'none',
  );

  const callable = loose.rows.filter((row) => row.public_execute).map((row) => row.proname);
  report.check(
    'and none is executable by public',
    callable.length === 0,
    callable.join(', ') || 'none',
  );

  /*
    The same for the definer functions the API can call: a SECURITY DEFINER
    function without a pinned search_path runs whatever the caller's path
    resolves, which is the one shape of this mistake that is genuinely
    exploitable.
  */
  const definers = await db.query(`
    select p.proname from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and (p.proconfig is null or not (array_to_string(p.proconfig, ',') like '%search_path%'))
  `);
  report.check(
    'no security definer function has a mutable search_path',
    definers.rows.length === 0,
    definers.rows.map((row) => row.proname).join(', ') || 'none',
  );
}

process.exit(report.finish() ? 0 : 1);
