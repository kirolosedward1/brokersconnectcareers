-- Covering indexes for the six foreign keys the performance linter found bare
-- (2026-09-11). Nothing here is hot at today's size; the point is the cascades
-- and the lookups these keys exist for — "which companies sit in this
-- district", "which listings name this developer", "what did this reviewer
-- resolve" — not scanning their table once the tables are real.
create index if not exists agent_developers_developer_idx   on agent_developers (developer_id);
create index if not exists agent_experience_district_idx    on agent_experience (district_id);
create index if not exists companies_district_idx           on companies (district_id);
create index if not exists company_documents_reviewed_by_idx on company_documents (reviewed_by);
create index if not exists job_developers_developer_idx     on job_developers (developer_id);
create index if not exists reports_resolved_by_idx          on reports (resolved_by);
