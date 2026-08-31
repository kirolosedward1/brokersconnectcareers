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

process.exit(report.finish() ? 0 : 1);
