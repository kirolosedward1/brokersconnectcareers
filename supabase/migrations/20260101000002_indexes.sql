-- =============================================================================
-- 02 — Indexes
-- =============================================================================

create index jobs_active_published_idx on jobs (status, published_at desc) where status = 'active';
create index jobs_facets_idx           on jobs (track, experience_band, district_id);
create index jobs_leads_source_idx     on jobs (leads_source);
create index jobs_company_idx          on jobs (company_id, status);
create index jobs_expires_idx          on jobs (expires_at) where status = 'active';
create index jobs_search_idx           on jobs using gin (search_vector);
create index jobs_featured_idx         on jobs (is_featured, published_at desc) where status = 'active';

create index applications_job_status_idx  on applications (job_id, status);
create index applications_candidate_idx   on applications (candidate_id, created_at desc);

create index agent_profiles_directory_idx on agent_profiles (visibility, availability);
create index agent_profiles_tracks_idx    on agent_profiles using gin (tracks);
create index agent_profiles_districts_idx on agent_profiles using gin (district_ids);

create index districts_governorate_idx    on districts (governorate_id);
create index company_documents_company_idx on company_documents (company_id, status);
create index reports_open_idx             on reports (resolved, created_at desc);
create index orders_company_idx           on orders (company_id, created_at desc);
