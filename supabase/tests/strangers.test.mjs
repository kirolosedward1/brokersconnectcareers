/**
 * A stranger reaches nothing of anybody else's, table by table, for every
 * table added or changed in migrations 340–371: saved listings and their
 * notes, notifications, push devices, application notes, support requests,
 * company documents and their files, contact reveals, orders, moderation
 * notes, withdrawn applications and the companies' private columns. For each:
 * another candidate, another company and a visitor read, write and delete
 * nothing, and the owner cannot reach past their own row.
 *
 * Run with: node supabase/tests/strangers.test.mjs
 */
import { createTestDb, runner, reporter, USERS } from './setup.mjs';
const db = await createTestDb();
const as = runner(db);
const R = reporter();
const C1 = USERS.candidate1, C2 = USERS.candidate2, E1 = USERS.employer1, E2 = USERS.employer2, ADM = USERS.admin;
const one = async (s) => (await db.query(s)).rows[0];
const co1 = (await one(`select c.id from companies c join company_members m on m.company_id=c.id where m.user_id='${E1}' limit 1`)).id;
const co2 = (await one(`select c.id from companies c join company_members m on m.company_id=c.id where m.user_id='${E2}' limit 1`)).id;
const app = await one(`select a.id, a.job_id, a.candidate_id from applications a join jobs j on j.id=a.job_id where j.company_id='${co1}' and a.candidate_id='${C1}' and a.status in ('new','shortlisted') limit 1`);
const anyJob = (await one(`select id from jobs where status='active' and company_id='${co1}' limit 1`)).id;
const draftJob = (await one(`select id from jobs where status<>'active' limit 1`)).id;
// fixtures as superuser
for (const st of [
  `insert into saved_jobs (candidate_id, job_id, note) values ('${C1}', '${anyJob}', 'spoke to Mona, interview Sunday') on conflict (candidate_id, job_id) do update set note=excluded.note;`,
  `insert into notifications (id, user_id, kind, payload) values ('aaaaaaaa-0000-0000-0000-000000000001', '${C1}', 'application_moved', '{"note":"private"}');`,
  `insert into push_devices (user_id, token, platform) values ('${C1}', 'ExponentPushToken[victimtoken1234567890]', 'ios');`,
  `insert into application_notes (application_id, author_id, body) values ('${app.id}', '${E1}', 'internal: lowball offer');`,
  `insert into support_requests (reference, request_key, user_id, topic, message) values ('BC-AAAA-BBBB', gen_random_uuid(), '${C1}', 'other', 'my private complaint');`,
  `insert into company_documents (company_id, doc_type, storage_path) values ('${co1}', 'commercial_register', '${co1}/cr.pdf');`,
  `insert into orders (company_id, pack_key, credits, amount_egp, status) values ('${co1}', 'single', 1, 500, 'pending');`
]) await db.exec(st);
const agentC1 = (await one(`select id from agent_profiles where user_id='${C1}'`))?.id;
if (agentC1) await db.exec(`insert into agent_contact_reveals (agent_id, viewer_id, company_id) values ('${agentC1}', '${E1}', '${co1}')`);

const n = async (who, sql, role) => { const r = await as(who, sql, role); return r.ok ? r.rows.length : 'ERR:' + r.error; };

R.section('saved_jobs (incl. note)');
R.check('owner reads own note', (await n(C1, `select note from saved_jobs where candidate_id='${C1}' and note is not null`)) === 1);
R.check('stranger candidate reads 0', (await n(C2, `select note from saved_jobs where candidate_id='${C1}'`)) === 0);
R.check('employer of the job reads 0', (await n(E1, `select note from saved_jobs where candidate_id='${C1}'`)) === 0);
R.check('anon reads 0', (await n(null, `select note from saved_jobs`, 'anon')) === 0);
R.check('stranger update 0 rows', (await n(C2, `update saved_jobs set note='x' where candidate_id='${C1}' returning 1`)) === 0);
R.check('stranger delete 0 rows', (await n(C2, `delete from saved_jobs where candidate_id='${C1}' returning 1`)) === 0);
R.check('stranger cannot re-point own row to victim', String(await n(C2, `insert into saved_jobs (candidate_id, job_id) values ('${C1}', '${anyJob}')`)).startsWith('ERR'));

R.section('notifications');
R.check('stranger reads 0', (await n(C2, `select * from notifications where user_id='${C1}'`)) === 0);
R.check('employer reads 0', (await n(E1, `select * from notifications where user_id='${C1}'`)) === 0);
R.check('stranger update 0', (await n(C2, `update notifications set read_at=now() where user_id='${C1}' returning 1`)) === 0);
R.check('stranger delete 0', (await n(C2, `delete from notifications where user_id='${C1}' returning 1`)) === 0);
R.check('stranger insert refused', String(await n(C2, `insert into notifications (user_id, kind) values ('${C1}', 'application_moved')`)).startsWith('ERR'));
R.check('owner cannot rewrite payload', String(await n(C1, `update notifications set payload='{}' where id='aaaaaaaa-0000-0000-0000-000000000001'`)).startsWith('ERR'));
R.check('owner cannot hand row to someone else', String(await n(C1, `update notifications set user_id='${C2}' where id='aaaaaaaa-0000-0000-0000-000000000001'`)).startsWith('ERR'));

R.section('push_devices');
R.check('stranger reads 0', (await n(C2, `select * from push_devices where user_id='${C1}'`)) === 0);
R.check('stranger direct insert refused', String(await n(C2, `insert into push_devices (user_id, token, platform) values ('${C2}','ExponentPushToken[abcdefgh1234]','ios')`)).startsWith('ERR'));
R.check('stranger unregister of victim token deletes nothing', (await (async()=>{await as(C2, `select public.unregister_push_device('ExponentPushToken[victimtoken1234567890]')`); return (await one(`select count(*)::int c from push_devices where user_id='${C1}'`)).c;})()) === 1);

R.section('application_notes');
R.check('owner employer reads note', (await n(E1, `select * from application_notes where application_id='${app.id}'`)) === 1);
R.check('other employer reads 0', (await n(E2, `select * from application_notes where application_id='${app.id}'`)) === 0);
R.check('applicant reads 0', (await n(C1, `select * from application_notes where application_id='${app.id}'`)) === 0);
R.check('other employer insert refused', String(await n(E2, `insert into application_notes (application_id, author_id, body) values ('${app.id}','${E2}','x')`)).startsWith('ERR'));
R.check('other employer delete 0', (await n(E2, `delete from application_notes where application_id='${app.id}' returning 1`)) === 0);
R.check('owner cannot update (no policy)', (await n(E1, `update application_notes set body='y' where application_id='${app.id}' returning 1`)) === 0);
R.check('owner employer cannot forge author', String(await n(E1, `insert into application_notes (application_id, author_id, body) values ('${app.id}','${ADM}','x')`)).startsWith('ERR'));

R.section('support_requests');
R.check('stranger reads 0', (await n(C2, `select * from support_requests where user_id='${C1}'`)) === 0);
R.check('anon reads 0', (await n(null, `select * from support_requests`, 'anon')) === 0);
R.check('stranger direct insert refused', String(await n(C2, `insert into support_requests (reference, request_key, user_id, topic, message) values ('X', gen_random_uuid(), '${C1}', 'other', 'x')`)).startsWith('ERR'));
R.check('owner cannot update reply', (await n(C1, `update support_requests set reply='x', status='closed' where user_id='${C1}' returning 1`)) === 0);

R.section('company_documents');
R.check('owner company reads', (await n(E1, `select * from company_documents where company_id='${co1}'`)) === 1);
R.check('other employer reads 0', (await n(E2, `select * from company_documents where company_id='${co1}'`)) === 0);
R.check('candidate reads 0', (await n(C1, `select * from company_documents where company_id='${co1}'`)) === 0);
R.check('other employer insert refused', String(await n(E2, `insert into company_documents (company_id, doc_type, storage_path) values ('${co1}','commercial_register','${co1}/x.pdf')`)).startsWith('ERR'));
R.check('owner cannot self-verify doc', (await n(E1, `update company_documents set status='verified' where company_id='${co1}' returning 1`)) === 0);
// Supabase grants these on storage.objects; the harness does not, so the
// policies, not a missing grant, are what is tested below.
await db.exec(`grant usage on schema storage to authenticated; grant select, insert, update, delete on storage.objects to authenticated;
  insert into storage.objects (bucket_id, name) values ('company-documents', '${co1}/cr.pdf')`);
R.check('the owner company reads its paper', (await n(E1, `select * from storage.objects where bucket_id='company-documents'`)) === 1);
R.check('other employer reads no paper', (await n(E2, `select * from storage.objects where bucket_id='company-documents'`)) === 0);
R.check('nor puts a file in that company\'s folder', String(await n(E2, `insert into storage.objects (bucket_id, name) values ('company-documents', '${co1}/evil.pdf')`)).startsWith('ERR'));
R.check('nor deletes one', (await n(E2, `delete from storage.objects where bucket_id='company-documents' returning 1`)) === 0);

R.section('agent_contact_reveals');
R.check('subject reads', (await n(C1, `select * from agent_contact_reveals`)) >= (agentC1 ? 1 : 0));
R.check('stranger candidate reads 0', (await n(C2, `select * from agent_contact_reveals where agent_id='${agentC1}'`)) === 0);
R.check('other employer reads 0', (await n(E2, `select * from agent_contact_reveals`)) === 0);
R.check('revealing employer itself reads 0 (subject+admin only)', (await n(E1, `select * from agent_contact_reveals`)) === 0);
R.check('direct insert refused', String(await n(E2, `insert into agent_contact_reveals (agent_id, viewer_id, company_id) values ('${agentC1}','${E2}','${co2}')`)).startsWith('ERR'));

R.section('orders');
R.check('other employer reads 0', (await n(E2, `select * from orders where company_id='${co1}'`)) === 0);
R.check('owner cannot mark paid', (await n(E1, `update orders set status='paid' where company_id='${co1}' returning 1`)) === 0);
R.check('owner cannot insert order', String(await n(E1, `insert into orders (company_id, pack_key, credits, amount_egp, status) values ('${co1}','p',100,1,'paid')`)).startsWith('ERR'));
R.check('authenticated cannot call settle_order', String(await n(E1, `select public.settle_order(gen_random_uuid(),'x',true)`)).startsWith('ERR'));
R.check('owner cannot set post_credits', String(await n(E1, `update companies set post_credits=999 where id='${co1}'`)).startsWith('ERR'));

R.section('job_moderation');
await db.exec(`insert into job_moderation (job_id, rejection_note) values ('${anyJob}', 'secret moderator note') on conflict do nothing`);
R.check('other employer reads 0', (await n(E2, `select * from job_moderation where job_id='${anyJob}'`)) === 0);
R.check('candidate reads 0', (await n(C1, `select * from job_moderation`)) === 0);
R.check('anon reads 0', (await n(null, `select * from job_moderation`, 'anon')) === 0);

R.section('withdrawn (361-363)');
R.check('stranger withdraw_application returns nothing', (await n(C2, `select * from public.withdraw_application('${app.id}')`)) === 0);
R.check('employer withdraw_application returns nothing', (await n(E1, `select * from public.withdraw_application('${app.id}')`)) === 0);
R.check('employer cannot set withdrawn', String(await n(E1, `update applications set status='withdrawn', withdrawn_at=now(), cv_path=null where id='${app.id}'`)).startsWith('ERR'));
R.check('candidate cannot delete (363)', (await n(C1, `delete from applications where id='${app.id}' returning 1`)) === 0);
R.check('candidate cannot insert pre-withdrawn row', String(await n(C1, `insert into applications (job_id, candidate_id, status, withdrawn_at) values ('${anyJob}','${C1}','withdrawn',now())`)).startsWith('ERR'));
{
  // withdraw for real, then probe in same txn
  await db.exec('begin'); await db.exec(`set local role authenticated; set local request.jwt.claim.sub='${C1}'; set local request.jwt.claims='{"role":"authenticated","sub":"${C1}"}'`);
  const w = await db.query(`select * from public.withdraw_application('${app.id}')`);
  await db.exec(`set local request.jwt.claim.sub='${E1}'; set local request.jwt.claims='{"role":"authenticated","sub":"${E1}"}'`);
  const seen = await db.query(`select id, status, cv_path, note from applications where id='${app.id}'`);
  const prof = await db.query(`select whatsapp_phone from profiles where id='${C1}'`);
  let mv; await db.exec('savepoint s'); try { await db.query(`update applications set status='shortlisted' where id='${app.id}'`); mv='allowed'; } catch(e) { mv='ERR '+e.message; await db.exec('rollback to savepoint s'); }
  await db.exec('rollback');
  R.check('withdrawn: the candidate withdrew it', w.rows.length === 1, JSON.stringify(w.rows));
  R.check('withdrawn: the employer keeps the record, without the CV', seen.rows.length === 1 && seen.rows[0].status === 'withdrawn' && seen.rows[0].cv_path === null, JSON.stringify(seen.rows));
  R.check('withdrawn: the employer no longer reads the profile or number (366)', prof.rows.length === 0, JSON.stringify(prof.rows));
  R.check('withdrawn: the employer cannot reopen it', mv.startsWith('ERR'), mv);
}

R.section('companies_select_public (371)');
const anonCo = await as(null, `select owner_id, post_credits from companies limit 2`, 'anon');
R.check('anon is refused owner_id and post_credits', !anonCo.ok && /permission denied/.test(anonCo.error ?? ''), anonCo.error ?? JSON.stringify(anonCo.rows));
const strangerCo = await as(C2, `select suspension_reason from companies limit 1`);
R.check('so is a signed-in stranger, for the suspension reason', !strangerCo.ok, strangerCo.error ?? JSON.stringify(strangerCo.rows));
process.exitCode = R.finish() ? 0 : 1;
