/**
 * Views, day by day (migration 382): each counted view is also a Cairo
 * day's, the total counted as before, and only the listing's company reads
 * the days.
 *
 * Run with: node supabase/tests/job-view-days.test.mjs
 */
import { createTestDb, reporter, runner } from './setup.mjs';

const db = await createTestDb();
const report = reporter();
const as = runner(db);
const one = async (sql) => (await db.query(sql)).rows[0];

const OWNER = 'bcbcbcbc-1111-0000-0000-000000000001';
const STRANGER = 'bcbcbcbc-1111-0000-0000-000000000002';
const COMPANY = 'bcbcbcbc-3333-0000-0000-000000000001';

await db.exec(`
  insert into auth.users (id, email, email_confirmed_at, created_at, updated_at) values
    ('${OWNER}', 'owner-d@demo.test', now(), now(), now()),
    ('${STRANGER}', 'stranger-d@demo.test', now(), now(), now());
  insert into profiles (id, role, full_name, whatsapp_phone, approval_status) values
    ('${OWNER}', 'employer', 'المالك', '+201044420001', 'approved'),
    ('${STRANGER}', 'employer', 'غريب', '+201044420002', 'approved')
  on conflict (id) do update set role = excluded.role, full_name = excluded.full_name;
  update profiles set approval_status = 'approved' where id in ('${OWNER}', '${STRANGER}');
  insert into companies (id, owner_id, name_ar, slug, verification_status) values ('${COMPANY}', '${OWNER}', 'شركة المشاهدات', 'views-co', 'verified');
`);
const job = (await one(`
  insert into jobs (company_id, title_ar, slug, track, employment_type, experience_band,
                    district_id, commission_type, leads_source, description_ar, status, published_at, expires_at)
  values ('${COMPANY}', 'مستشار', 'views-job', 'primary', 'full_time', 'junior_1_3',
          (select id from districts limit 1), 'none', 'company_provided', 'وصف', 'active', now(), now() + interval '30 days')
  returning id, version`));

await db.exec(`select public.increment_job_view('views-job'); select public.increment_job_view('views-job'); select public.increment_job_view('views-job');`);
const after = await one(`select view_count, version from jobs where id = '${job.id}'`);
report.check('the total is counted as before', after.view_count === 3);
report.check('and a view is still not an edit', after.version === job.version);
const today = await one(`select views from job_view_days where job_id = '${job.id}' and day = (now() at time zone 'Africa/Cairo')::date`);
report.check("and today's row holds the three", today?.views === 3);

await db.exec(`update jobs set status = 'closed' where id = '${job.id}'`);
await db.exec(`select public.increment_job_view('views-job')`);
report.check('a closed listing counts nothing, on either', (await one(`select views from job_view_days where job_id = '${job.id}'`)).views === 3);

const owner = await as(OWNER, `select views from job_view_days where job_id = '${job.id}'`);
report.check('the company reads its days', owner.rows.length === 1, owner.error);
const stranger = await as(STRANGER, `select views from job_view_days`);
report.check('nobody else does', stranger.ok && stranger.rows.length === 0);
const direct = await as(OWNER, `insert into job_view_days (job_id, day, views) values ('${job.id}', current_date - 1, 500)`);
report.check('and nobody writes them by hand', !direct.ok);
const call = await as(OWNER, `select public.increment_job_view('views-job')`);
report.check('nor counts a view themselves', !call.ok);

process.exit(report.finish() ? 0 : 1);
