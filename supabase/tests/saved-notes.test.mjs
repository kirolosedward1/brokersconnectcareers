/**
 * A note and a reminder on a bookmark (migration 356): the columns' shape, and
 * that only the candidate whose bookmark it is reads or changes them — and
 * only them. Run with: pnpm test:db
 */
import { createTestDb, runner, reporter, FIXTURES } from './setup.mjs';

const report = reporter();
const db = await createTestDb();
const as = runner(db);

const { candidate, publicAgent, employerVerified, admin } = FIXTURES;

const [liveJob, otherJob] = (
  await db.query("select id from jobs where status = 'active' order by slug limit 2")
).rows.map((row) => row.id);

await db.exec(`
  delete from saved_jobs where candidate_id in ('${candidate}', '${publicAgent}');
  insert into saved_jobs (candidate_id, job_id) values ('${candidate}', '${liveJob}'), ('${publicAgent}', '${liveJob}');
`);

report.section('the columns');
{
  const columns = (
    await db.query(`
      select column_name, data_type, is_nullable
        from information_schema.columns
       where table_schema = 'public' and table_name = 'saved_jobs' and column_name in ('note', 'remind_at')
       order by column_name`)
  ).rows;
  const note = columns.find((column) => column.column_name === 'note');
  const remindAt = columns.find((column) => column.column_name === 'remind_at');
  report.check('saved_jobs.note is nullable text', note?.data_type === 'text' && note?.is_nullable === 'YES', JSON.stringify(note));
  report.check('saved_jobs.remind_at is a nullable timestamptz',
    remindAt?.data_type === 'timestamp with time zone' && remindAt?.is_nullable === 'YES', JSON.stringify(remindAt));

  const fresh = (await db.query(`select note, remind_at from saved_jobs where candidate_id = '${candidate}' and job_id = '${liveJob}'`)).rows[0];
  report.check('a bookmark starts with neither', fresh.note === null && fresh.remind_at === null, JSON.stringify(fresh));
}

report.section('a note is a line, not a document');
{
  const fits = await as(candidate, `
    update saved_jobs set note = '${'م'.repeat(300)}' where candidate_id = '${candidate}' and job_id = '${liveJob}' returning note`);
  report.check('300 characters fit (counted as characters, not bytes)', fits.ok && fits.rows.length === 1, fits.error);

  const long = await as(candidate, `
    update saved_jobs set note = '${'م'.repeat(301)}' where candidate_id = '${candidate}' and job_id = '${liveJob}' returning note`);
  report.check('301 do not', !long.ok && /saved_jobs_note_shape/.test(long.error ?? ''), long.ok ? 'update was allowed' : long.error);

  const blank = await as(candidate, `
    update saved_jobs set note = '   ' where candidate_id = '${candidate}' and job_id = '${liveJob}' returning note`);
  report.check('nor only blanks: no note is null', !blank.ok && /saved_jobs_note_shape/.test(blank.error ?? ''), blank.ok ? 'update was allowed' : blank.error);
}

report.section('the bookmark\'s owner writes them');
{
  const both = await as(candidate, `
    update saved_jobs set note = 'كلّمت منى، مقابلة الأحد', remind_at = now() + interval '2 days'
     where candidate_id = '${candidate}' and job_id = '${liveJob}' returning note, remind_at`);
  report.check('the candidate sets a note and a reminder on their own bookmark',
    both.ok && both.rows.length === 1 && both.rows[0].note === 'كلّمت منى، مقابلة الأحد' && both.rows[0].remind_at !== null, both.error);

  const cleared = await as(candidate, `
    update saved_jobs set note = null, remind_at = null
     where candidate_id = '${candidate}' and job_id = '${liveJob}' returning note, remind_at`);
  report.check('and clears them', cleared.ok && cleared.rows.length === 1 && cleared.rows[0].note === null, cleared.error);

  await db.exec(`update saved_jobs set note = 'رقم منى' where candidate_id = '${publicAgent}' and job_id = '${liveJob}'`);
  const read = await as(candidate, `select note from saved_jobs where candidate_id = '${publicAgent}'`);
  report.check('another candidate\'s note is not read', read.ok && read.rows.length === 0, read.error ?? JSON.stringify(read.rows));

  const write = await as(candidate, `
    update saved_jobs set note = 'x' where candidate_id = '${publicAgent}' and job_id = '${liveJob}' returning note`);
  report.check('nor written', write.ok && write.rows.length === 0, write.error ?? JSON.stringify(write.rows));

  for (const [who, id] of [['an employer', employerVerified], ['an admin, through the API', admin]]) {
    const r = await as(id, `update saved_jobs set note = 'x' where job_id = '${liveJob}' returning candidate_id`);
    report.check(`${who} changes nobody's note`, r.ok && r.rows.length === 0, r.error ?? JSON.stringify(r.rows));
  }

  const anon = await as(null, `update saved_jobs set note = 'x' returning candidate_id`, 'anon');
  report.check('nor does somebody signed out', !anon.ok || anon.rows.length === 0, anon.ok ? JSON.stringify(anon.rows) : '');
}

report.section('an update changes the note and the reminder, nothing else');
{
  const moved = await as(candidate, `
    update saved_jobs set job_id = '${otherJob}' where candidate_id = '${candidate}' and job_id = '${liveJob}' returning job_id`);
  report.check('a bookmark is not moved to another listing',
    !moved.ok && /do not change/.test(moved.error ?? ''), moved.ok ? 'update was allowed' : moved.error);

  const given = await as(candidate, `
    update saved_jobs set candidate_id = '${publicAgent}' where candidate_id = '${candidate}' and job_id = '${liveJob}' returning job_id`);
  report.check('nor handed to somebody else', !given.ok, given.ok ? 'update was allowed' : undefined);

  const redated = await as(candidate, `
    update saved_jobs set created_at = now() + interval '1 year' where candidate_id = '${candidate}' and job_id = '${liveJob}' returning job_id`);
  report.check('nor re-dated to the top of the list',
    !redated.ok && /do not change/.test(redated.error ?? ''), redated.ok ? 'update was allowed' : redated.error);
}

report.section('taking the bookmark off takes them with it');
{
  await db.exec(`update saved_jobs set note = 'مقابلة', remind_at = now() + interval '1 day' where candidate_id = '${candidate}' and job_id = '${liveJob}'`);
  const removed = await as(candidate, `delete from saved_jobs where candidate_id = '${candidate}' and job_id = '${liveJob}' returning note, remind_at`);
  report.check('the row goes, note and reminder in it', removed.ok && removed.rows.length === 1 && removed.rows[0].note === 'مقابلة', removed.error);

  const insertedWith = await as(candidate, `
    insert into saved_jobs (candidate_id, job_id, note) values ('${candidate}', '${otherJob}', '${'م'.repeat(301)}') returning job_id`);
  report.check('and a bookmark saved with a note meets the same limit',
    !insertedWith.ok && /saved_jobs_note_shape/.test(insertedWith.error ?? ''), insertedWith.ok ? 'insert was allowed' : insertedWith.error);
}

process.exit(report.finish() ? 0 : 1);
