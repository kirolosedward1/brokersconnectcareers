-- A report is a report *about a listing*.
--
-- job_id was nullable, which made the moderation queue's grouping partial: a
-- row with no job could be neither taken down nor traced, and nothing in the
-- product could produce one to be fixed. The column is unreachable-null today
-- (the only writer is reportJob, which requires a uuid, and the foreign key
-- cascades on delete rather than nulling), so this states the rule the data
-- already follows and lets the queue group by job without a leftover bucket.
alter table reports
  alter column job_id set not null;
