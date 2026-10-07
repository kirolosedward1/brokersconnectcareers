/**
 * What a person agreed to, and who they chose to be seen by (migration 336),
 * against the real migrations.
 * Run with: pnpm test:consent  (also part of pnpm test:db)
 *
 * What is pinned: an acceptance is written only through the function, as the
 * caller, on the database's clock, once per pair of versions; nobody reads or
 * writes anybody else's; it goes with the account. A new directory card is
 * hidden unless its owner says otherwise; the owner choosing is stamped with
 * the database's time, and nobody else changing the card counts as a choice.
 */
import { readFileSync } from 'node:fs';
import { createTestDb, runner, reporter, FIXTURES, USERS } from './setup.mjs';

const report = reporter();
const db = await createTestDb();
const as = runner(db);

const { candidate, publicAgent, admin } = FIXTURES;

const one = async (sql) => (await db.query(sql)).rows[0];
const count = async (sql) => Number((await db.query(sql)).rows[0].n);

/** Runs statements as somebody, and keeps what they wrote (`as` rolls back). */
async function committedAs(userId, sql) {
  await db.exec('begin');
  await db.exec('set local role authenticated;');
  await db.exec(`set local request.jwt.claim.sub = '${userId}';`);
  await db.exec(`set local request.jwt.claims = '${JSON.stringify({ role: 'authenticated', sub: userId })}';`);
  try {
    await db.query(sql);
    await db.exec('commit');
    return { ok: true };
  } catch (error) {
    await db.exec('rollback');
    return { ok: false, error: error.message };
  }
}

report.section('agreeing');
{
  const first = await committedAs(candidate, `select public.record_policy_acceptance('2026-10-01', '2026-10-01')`);
  report.check('a person records their own agreement', first.ok, first.error);

  const row = await one(`select terms_version, privacy_version, accepted_at from policy_acceptances where user_id = '${candidate}'`);
  report.check('with the versions they agreed to', row?.terms_version === '2026-10-01' && row?.privacy_version === '2026-10-01');
  report.check('dated by the database', row && Math.abs(Date.now() - new Date(row.accepted_at).getTime()) < 60_000, String(row?.accepted_at));

  await committedAs(candidate, `select public.record_policy_acceptance('2026-10-01', '2026-10-01')`);
  report.check('the same pair twice is one record',
    (await count(`select count(*)::int as n from policy_acceptances where user_id = '${candidate}'`)) === 1);

  await committedAs(candidate, `select public.record_policy_acceptance('2026-12-01', '2026-10-01')`);
  report.check('a new version is a new record',
    (await count(`select count(*)::int as n from policy_acceptances where user_id = '${candidate}'`)) === 2);

  const malformed = await as(candidate, `select public.record_policy_acceptance('latest', '2026-10-01')`);
  report.check('a version is a date, nothing else', !malformed.ok, malformed.error);

  const anon = await as(null, `select public.record_policy_acceptance('2026-10-01', '2026-10-01')`, 'anon');
  report.check('nobody signed out can record one', !anon.ok, anon.error);
}

report.section('whose record');
{
  const insert = await as(candidate, `insert into policy_acceptances (user_id, terms_version, privacy_version, accepted_at)
                                      values ('${candidate}', '2026-10-01', '2026-10-01', '2020-01-01')`);
  report.check('nobody writes a record directly, dated as they like', !insert.ok, insert.error);

  const edit = await as(candidate, `update policy_acceptances set accepted_at = '2020-01-01' where user_id = '${candidate}' returning id`);
  report.check('nor edits one', !edit.ok || edit.rows.length === 0, edit.error);

  const remove = await as(candidate, `delete from policy_acceptances where user_id = '${candidate}' returning id`);
  report.check('nor deletes one', !remove.ok || remove.rows.length === 0, remove.error);

  const own = await as(candidate, `select count(*)::int as n from policy_acceptances`);
  report.check('a person reads their own', own.ok && own.rows[0].n === 2, own.error);

  const other = await as(publicAgent, `select count(*)::int as n from policy_acceptances where user_id = '${candidate}'`);
  report.check('and nobody else’s', other.ok && other.rows[0].n === 0, other.error);

  const reviewer = await as(admin, `select count(*)::int as n from policy_acceptances where user_id = '${candidate}'`, 'authenticated', { aal: 'aal2' });
  report.check('an admin can read one, for a dispute', reviewer.ok && reviewer.rows[0].n === 2, reviewer.error);
}

report.section('being listed');
{
  const column = await one(`select column_default from information_schema.columns
                             where table_name = 'agent_profiles' and column_name = 'visibility'`);
  report.check('a new card is hidden unless its owner says otherwise', /'hidden'/.test(column?.column_default ?? ''), column?.column_default);

  // An owner's first choice, from onboarding: the client marks it, the
  // database dates it.
  const fresh = USERS.candidate7;
  await db.exec(`delete from agent_profiles where user_id = '${fresh}'`);
  const made = await committedAs(fresh, `insert into agent_profiles (user_id, slug, visibility, visibility_chosen_at)
                                         values ('${fresh}', 'consent-test-card', 'public', '2001-01-01')`);
  report.check('an owner makes their card with a choice', made.ok, made.error);
  const card = await one(`select visibility, visibility_chosen_at from agent_profiles where user_id = '${fresh}'`);
  report.check('the choice is dated by the database, not the client',
    card?.visibility === 'public' && Math.abs(Date.now() - new Date(card.visibility_chosen_at).getTime()) < 60_000,
    String(card?.visibility_chosen_at));

  // A card made with no choice at all keeps no date.
  await db.exec(`delete from agent_profiles where user_id = '${fresh}'`);
  await committedAs(fresh, `insert into agent_profiles (user_id, slug) values ('${fresh}', 'consent-test-card-2')`);
  const unasked = await one(`select visibility, visibility_chosen_at from agent_profiles where user_id = '${fresh}'`);
  report.check('a card made without asking is hidden and undated', unasked?.visibility === 'hidden' && unasked.visibility_chosen_at === null,
    JSON.stringify(unasked));

  // The owner changing their mind.
  await committedAs(fresh, `update agent_profiles set visibility = 'verified_employers_only' where user_id = '${fresh}'`);
  const changed = await one(`select visibility_chosen_at from agent_profiles where user_id = '${fresh}'`);
  report.check('the owner changing it is a choice', changed?.visibility_chosen_at !== null);

  // Somebody else changing it is not: the service role here, an admin's lever
  // in production.
  await db.exec(`update agent_profiles set visibility_chosen_at = '2001-01-01' where user_id = '${fresh}'`);
  const before = await one(`select visibility_chosen_at from agent_profiles where user_id = '${fresh}'`);
  await db.exec(`update agent_profiles set visibility = 'hidden' where user_id = '${fresh}'`);
  const after = await one(`select visibility, visibility_chosen_at from agent_profiles where user_id = '${fresh}'`);
  report.check('somebody else hiding a card is not its owner choosing',
    after.visibility === 'hidden' && new Date(after.visibility_chosen_at).getTime() === new Date(before.visibility_chosen_at).getTime(),
    `${before.visibility_chosen_at} → ${after.visibility_chosen_at}`);

  // Saving the profile form, which always asks, counts even when the answer
  // is the same: the form sends a value, the database dates it.
  await committedAs(fresh, `update agent_profiles set visibility = 'hidden', visibility_chosen_at = now() - interval '5 years' where user_id = '${fresh}'`);
  const resaved = await one(`select visibility_chosen_at from agent_profiles where user_id = '${fresh}'`);
  report.check('the profile form’s save counts, dated now',
    Math.abs(Date.now() - new Date(resaved.visibility_chosen_at).getTime()) < 60_000, String(resaved.visibility_chosen_at));
}

report.section('a photo somebody uploaded (migration 339)');
{
  // A Google photo copied in before onboarding stopped doing it, and a photo
  // uploaded the ordinary way; then the migration's own statement.
  await db.exec(`update profiles set avatar_url = 'https://lh3.googleusercontent.com/a/legacy-photo=s96-c' where id = '${publicAgent}'`);
  const uploaded = `https://example.supabase.co/storage/v1/object/public/avatars/${candidate}/photo.webp`;
  await db.exec(`update profiles set avatar_url = '${uploaded}' where id = '${candidate}'`);
  await db.exec(readFileSync(new URL('../migrations/20260101000339_a_photo_somebody_uploaded.sql', import.meta.url), 'utf8'));

  const google = await one(`select avatar_url from profiles where id = '${publicAgent}'`);
  report.check('a photo that is not one of our files is cleared', google.avatar_url === null, String(google.avatar_url));
  const own = await one(`select avatar_url from profiles where id = '${candidate}'`);
  report.check('an uploaded photo stays', own.avatar_url === uploaded, String(own.avatar_url));
  const queued = await count(`select count(*)::int as n from storage_gc_queue where path like '%legacy-photo%'`);
  report.check('and nothing that is not ours is queued for deletion', queued === 0);
}

report.section('it goes with the account');
{
  await db.exec(`delete from profiles where id = '${candidate}'`);
  report.check('deleting the profile deletes what it agreed to',
    (await count(`select count(*)::int as n from policy_acceptances where user_id = '${candidate}'`)) === 0);
}

process.exit(report.finish() ? 0 : 1);
