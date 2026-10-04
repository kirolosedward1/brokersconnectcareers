-- =============================================================================
-- The two accounts App Review signs in with — application rows only.
--
-- scripts/review-accounts.mjs creates the users through the Auth admin API
-- (as scripts/seed-demo.mjs does, for the same reason: GoTrue's own rows), uploads
-- the candidate's CV, sets `review.params` and runs this file in one
-- transaction; supabase/tests/review-accounts.test.mjs runs it on the real
-- migrations. Every run starts the review over (below), so it is the one to
-- run again before each submission, with new passwords.
--
-- What it makes, all of it labelled as the review's on every page that shows it:
--   - an employer, approved, owning a verified company with two live listings;
--   - a candidate with a directory profile kept out of the directory and a CV,
--     who has applied to the first listing, so the employer has an applicant,
--     and not to the second, which is the one the reviewer applies to;
--   - both having agreed to the current Terms and Privacy policy, as onboarding
--     records it, and the directory profile's visibility counted as chosen, so
--     neither is asked either again.
--
-- The listing is on the public board while it is live, like every listing.
-- `review.params ->> 'remove'` takes it all away again (after App Review),
-- before the script deletes the two users.
--
-- review.params, JSON:
--   candidate, employer        the users' ids
--   candidatePhone, employerPhone   E.164 numbers the applicant card dials
--   terms, privacy             POLICY_VERSIONS (src/lib/policy-versions.ts)
--   cv                         the candidate's CV path in the cvs bucket, or null
--   remove                     true to delete the company (its listings and
--                              applications with them) and the agent profile
-- =============================================================================

do $$
declare
  p           jsonb := current_setting('review.params')::jsonb;
  v_candidate uuid  := (p->>'candidate')::uuid;
  v_employer  uuid  := (p->>'employer')::uuid;
  v_company   uuid;
  v_job       uuid;
  v_district  int;
  v_first_published  timestamptz;
  v_second_published timestamptz;
begin
  if v_candidate is null or v_employer is null or v_candidate = v_employer then
    raise exception 'review.params needs two different users';
  end if;

  -- What the last review left goes first, so each review starts where the
  -- first did: the reviewer's own application to the second listing (a listing
  -- takes one application per person, so the next reviewer could not apply),
  -- the applicant moved on, a listing edited back into review or past its
  -- thirty days, the profile shown in the directory, the bells full of it,
  -- the name and number typed into the apply form (written onto the account),
  -- the email switches, the owner's deletion request.
  -- The company goes with its listings and every application to them — the
  -- applications first, since a listing is never deleted from under them
  -- (applications_job_id_fkey restricts); anyone who applied to a review
  -- listing despite what it says loses that application with it. `remove`
  -- stops there.
  --
  -- When each listing first went up is kept: the daily new-jobs bell and the
  -- weekly alert count a listing by its publication, and listings published
  -- afresh on every run were announced again, each time, to everyone whose
  -- saved search they match. Their thirty days start again.
  select max(j.published_at) filter (where j.slug = 'app-review-property-consultant'),
         max(j.published_at) filter (where j.slug = 'app-review-sales-manager')
    into v_first_published, v_second_published
    from jobs j join companies c on c.id = j.company_id
   where c.slug = 'brokers-connect-app-review' and c.owner_id = v_employer;
  delete from applications
   where job_id in (select j.id from jobs j join companies c on c.id = j.company_id
                     where c.slug = 'brokers-connect-app-review' and c.owner_id = v_employer);
  delete from companies where slug = 'brokers-connect-app-review' and owner_id = v_employer;
  delete from agent_profiles where user_id = v_candidate;
  delete from notifications where user_id in (v_candidate, v_employer);
  -- The owner's Delete account files a request (the employer owns the
  -- company), which the delete screen then shows to the next reviewer.
  delete from support_requests where user_id = v_employer and topic = 'account_deletion';

  if coalesce((p->>'remove')::boolean, false) then
    return;
  end if;

  select id into v_district from districts where slug = 'new-cairo';
  if v_district is null then
    raise exception 'the district new-cairo is missing: is the taxonomy seeded?';
  end if;

  -- ---------------------------------------------------------------------------
  -- The two people
  -- ---------------------------------------------------------------------------
  insert into profiles (id, role, full_name, whatsapp_phone, locale) values
    (v_employer,  'employer',  'فريق مراجعة التطبيق', p->>'employerPhone',  'ar'),
    (v_candidate, 'candidate', 'مراجع التطبيق',       p->>'candidatePhone', 'ar')
  on conflict (id) do update
    set full_name = excluded.full_name, whatsapp_phone = excluded.whatsapp_phone, locale = excluded.locale,
        notify_applications = default, notify_status = default, notify_digest = default,
        notify_applicant_digest = default, notify_profile_nudge = default;

  -- Every employer account starts pending (migration 16); this one is the
  -- reviewer's, approved as the admin console would.
  update profiles
     set approval_status = 'approved', approved_at = coalesce(approved_at, now())
   where id = v_employer and approval_status <> 'approved';

  insert into policy_acceptances (user_id, terms_version, privacy_version)
  select person, p->>'terms', p->>'privacy'
    from unnest(array[v_employer, v_candidate]) as person
   where not exists (
     select 1 from policy_acceptances a
      where a.user_id = person and a.terms_version = p->>'terms' and a.privacy_version = p->>'privacy');

  -- ---------------------------------------------------------------------------
  -- The company and its listing
  -- ---------------------------------------------------------------------------
  select id into v_company from companies where slug = 'brokers-connect-app-review';
  if v_company is null then
    insert into companies (owner_id, name_ar, name_en, slug, about_ar, headcount_band,
                           district_id, verification_status, verified_at)
    values (v_employer, 'حساب مراجعة التطبيق', 'App Review account', 'brokers-connect-app-review',
            'الحساب ده بيستخدمه فريق مراجعة متجر التطبيقات عشان يجرّب التطبيق. الإعلانات اللي هنا للتجربة بس، والتقديم عليها لفريق المراجعة بس.',
            '1_10', v_district, 'verified', now())
    returning id into v_company;
  elsif not exists (select 1 from companies where id = v_company and owner_id = v_employer) then
    raise exception 'brokers-connect-app-review belongs to another account';
  end if;

  select id into v_job from jobs where slug = 'app-review-property-consultant';
  if v_job is null then
    insert into jobs (
      company_id, title_ar, title_en, slug, track, employment_type, experience_band, seats,
      district_id, basic_salary_min, basic_salary_max, commission_type, commission_value,
      commission_note_ar, leads_source, benefits, description_ar, requirements_ar, status,
      published_at, expires_at
    ) values (
      v_company, 'استشاري عقاري (إعلان لمراجعة التطبيق)', 'Property consultant (app review listing)',
      'app-review-property-consultant', 'primary', 'full_time', 'junior_1_3', 1,
      v_district, 8000, 12000, 'percentage', 1.50,
      'عمولة 1.5٪ من قيمة الوحدة.', 'company_provided', array['social_insurance'],
      'الإعلان ده موجود عشان فريق مراجعة متجر التطبيقات يجرّب التقديم ومتابعة المتقدمين. مش وظيفة حقيقية، والتقديم عليه لفريق المراجعة بس.',
      'مفيش متطلبات: الإعلان للتجربة بس.', 'active',
      v_first_published, now() + interval '30 days'
    )
    returning id into v_job;
  end if;

  -- A second listing, which nobody has applied to: the one the reviewer
  -- applies to from the candidate account. The first already has that
  -- account's application, for the employer's pipeline, and a listing takes
  -- one application per person.
  if not exists (select 1 from jobs where slug = 'app-review-sales-manager') then
    insert into jobs (
      company_id, title_ar, title_en, slug, track, employment_type, experience_band, seats,
      district_id, basic_salary_min, basic_salary_max, commission_type, commission_value,
      commission_note_ar, leads_source, benefits, description_ar, requirements_ar, status,
      published_at, expires_at
    ) values (
      v_company, 'مدير مبيعات (إعلان لمراجعة التطبيق)', 'Sales manager (app review listing)',
      'app-review-sales-manager', 'resale', 'full_time', 'mid_3_5', 1,
      v_district, 15000, 20000, 'percentage', 1.00,
      'عمولة 1٪ من قيمة البيع.', 'company_provided', array['social_insurance', 'medical'],
      'الإعلان ده موجود عشان فريق مراجعة متجر التطبيقات يجرّب التقديم من حساب المتقدّم. مش وظيفة حقيقية، والتقديم عليه لفريق المراجعة بس.',
      'مفيش متطلبات: الإعلان للتجربة بس.', 'active',
      v_second_published, now() + interval '30 days'
    );
  end if;

  -- ---------------------------------------------------------------------------
  -- The candidate's profile and application
  -- ---------------------------------------------------------------------------
  -- Hidden: real companies browsing the directory never see the reviewer.
  insert into agent_profiles (user_id, slug, headline_ar, years_experience, tracks, district_ids,
                              languages, availability, visibility, cv_path)
  values (v_candidate, 'app-review-consultant', 'استشاري عقاري — حساب مراجعة التطبيق', 2,
          array['primary']::job_track[], array[v_district], array['ar', 'en'],
          'actively_searching', 'hidden', p->>'cv')
  on conflict (user_id) do nothing;

  insert into applications (job_id, candidate_id, status, experience_band, note, cv_path)
  select v_job, v_candidate, 'new', 'junior_1_3', 'متاح أبدأ فوراً.', p->>'cv'
   where not exists (select 1 from applications where job_id = v_job and candidate_id = v_candidate);

  -- Hidden by choice: only the owner's own change stamps that a visibility was
  -- chosen (migration 336), so the stamp is made as the candidate, for this
  -- one statement. Unstamped, the candidate's Home asks who may see the card,
  -- and a reviewer answering it would put the account in the directory.
  perform set_config('request.jwt.claim.sub', v_candidate::text, true);
  update agent_profiles set visibility_chosen_at = now() where user_id = v_candidate;
  perform set_config('request.jwt.claim.sub', '', true);
end
$$;
