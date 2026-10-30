/**
 * How soon a company answers (migration 370): the share of applications it
 * opened and the median wait for a first answer, from the rows it already
 * keeps — nothing under five applications, no median under three answers,
 * and never a candidate's own withdrawal counted as an answer.
 *
 * Run with: node supabase/tests/response-stats.test.mjs
 */
import { createTestDb, reporter } from './setup.mjs';

const db = await createTestDb();
const report = reporter();
const one = async (sql) => (await db.query(sql)).rows[0];

const EMP = 'cccccccc-1111-0000-0000-000000000001';
const COMPANY = 'cccccccc-3333-0000-0000-000000000001';

await db.exec(`
  insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
    values ('${EMP}', 'emp@demo.test', now(), now(), now());
  insert into profiles (id, role, full_name, whatsapp_phone, approval_status)
    values ('${EMP}', 'employer', 'صاحب الشركة', '+201099900101', 'approved');
  insert into companies (id, owner_id, name_ar, slug, verification_status)
    values ('${COMPANY}', '${EMP}', 'شركة الردود', 'response-test-co', 'verified');
`);
const job = await one(`
  insert into jobs (company_id, title_ar, slug, track, employment_type, experience_band,
                    district_id, commission_type, leads_source, description_ar, status,
                    published_at, expires_at)
  values ('${COMPANY}', 'وظيفة', 'response-test-job', 'primary', 'full_time', 'junior_1_3',
          (select id from districts limit 1), 'none', 'company_provided', 'وصف', 'active',
          now(), now() + interval '30 days')
  returning id`);

/** A candidate's application, made `days` ago, opened or not, and how it moved after (days after it was made). */
async function application(index, { days, opened = false, moves = [] }) {
  const id = `cccccccc-2222-0000-0000-${String(index).padStart(12, '0')}`;
  await db.exec(`
    insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
      values ('${id}', 'cand${index}@demo.test', now(), now(), now());
    insert into profiles (id, role, full_name, whatsapp_phone, approval_status)
      values ('${id}', 'candidate', 'مرشح ${index}', '+2010999${String(index).padStart(5, '0')}', 'approved');
  `);
  const row = await one(`
    insert into applications (job_id, candidate_id, experience_band, created_at, employer_viewed_at)
    values ('${job.id}', '${id}', 'junior_1_3', now() - interval '${days} days',
            ${opened ? `now() - interval '${days - 0.5} days'` : 'null'})
    returning id`);
  for (const move of moves) {
    await db.exec(`
      insert into application_events (application_id, from_status, to_status, actor_id, created_at)
      values ('${row.id}', '${move.from}', '${move.to}', ${move.byCandidate ? `'${id}'` : `'${EMP}'`},
              now() - interval '${days - move.after} days')`);
  }
}

const stats = () => one(`select * from public.company_response_stats('${COMPANY}')`);

report.section('a company with too few applications says nothing');
await application(1, { days: 20, opened: true, moves: [{ from: 'new', to: 'shortlisted', after: 2 }] });
await application(2, { days: 18, opened: true, moves: [{ from: 'new', to: 'rejected', after: 1 }] });
await application(3, { days: 16 });
await application(4, { days: 14, opened: true, moves: [{ from: 'new', to: 'withdrawn', after: 3, byCandidate: true }] });
report.check('four applications: no row at all', (await stats()) === undefined);

report.section('five or more: the share opened, and the median wait for a first answer');
await application(5, { days: 12, opened: true, moves: [{ from: 'new', to: 'interview', after: 4 }] });
const five = await stats();
report.check('five counted', five?.sample === 5);
report.check('four of five opened: 0.8', Number(five?.open_rate) === 0.8);
// Answers after 2, 1 and 4 days; the withdrawal and the unanswered one are no answer.
report.check('the median of 1, 2 and 4 days is 2', Number(five?.median_days) === 2);

report.section('fewer than three answers: no median');
const other = 'cccccccc-3333-0000-0000-000000000002';
const OWNER = 'cccccccc-1111-0000-0000-000000000002';
await db.exec(`
  insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
    values ('${OWNER}', 'emp2@demo.test', now(), now(), now());
  insert into profiles (id, role, full_name, whatsapp_phone, approval_status)
    values ('${OWNER}', 'employer', 'صاحب شركة أخرى', '+201099900102', 'approved');
  insert into companies (id, owner_id, name_ar, slug) values ('${other}', '${OWNER}', 'شركة ثانية', 'response-test-co-2');
`);
report.check('a company with no applications says nothing', (await one(`select * from public.company_response_stats('${other}')`)) === undefined);

report.section('anybody may ask, as the listing is public');
await db.exec('begin; set local role anon;');
const asAnon = await one(`select * from public.company_response_stats('${COMPANY}')`).catch((error) => ({ error: error.message }));
await db.exec('rollback');
report.check('anon reads the three numbers', asAnon?.sample === 5);

process.exit(report.finish() ? 0 : 1);
