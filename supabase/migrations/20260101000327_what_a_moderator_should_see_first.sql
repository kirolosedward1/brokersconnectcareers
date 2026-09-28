-- =============================================================================
-- 327 — What a moderator should see first
--
-- Every listing already passes a person before it goes live. What that person
-- was not shown is the part that takes experience to spot: that an advert asks
-- the candidate to pay a "registration fee" by Vodafone Cash, asks for a photo
-- of their national ID, sends them to a t.me group, or comes from a company
-- whose WhatsApp number also belongs to an account suspended last week.
--
-- This migration computes those as *signals for review*. None of them hides,
-- blocks or rejects anything. A listing with a flag waits in the same queue as
-- one without; a company with a signal trades exactly as it did. The only
-- thing a signal changes is what the moderator sees beside the decision.
--
--   Text flags        money asked of the candidate; ID, bank or login details
--                     asked for; links that hide where they go (shorteners,
--                     Telegram, off-site forms, look-alike domains); and, low
--                     weight, any outside link, phone number or email.
--   Company signals   many listings in a day; repeated rejections; the same
--                     advert posted over and over, or copied from another
--                     company; complaints from different people; a phone
--                     number or website shared with another company or with a
--                     suspended account; a name resembling a developer's or a
--                     verified company's.
--
-- The patterns are the anti-abuse detail a scammer would most like to read,
-- so every function here is closed to the API except the admin wrappers, and
-- nothing is ever written where an employer can read it.
--
-- Also here, because each closes a way round the review that already exists:
--
--   A live listing's other text now goes back to review when it changes.
--   guard_job_update re-reviews the Arabic title and description and the pay
--   block; the English text, the requirements, the commission note and the
--   employment type could be rewritten on an approved advert without anybody
--   seeing it — "requirements: a 500 EGP registration fee" included. A second
--   trigger, not a restatement, because other migrations restate that
--   function, and whichever restatement runs last would drop this clause.
--
--   Nothing is submitted for review by an account that is not in good
--   standing. A restricted (held) or suspended account keeps what it has live
--   and cannot put anything new in front of a moderator or a candidate. Row-
--   level security already keeps both out of their listings — a suspended
--   account since 308, and since 322 any account not approved, which a hold
--   is — so this is the same rule for the write those policies do not see: a
--   new listing inserted straight into review.
--
--   A company's suspension reason is no longer public. companies is readable
--   by anyone (it is the directory), so the reason an admin wrote "to the
--   company" was readable by every visitor through the API. It moves to
--   company_moderation, which the company's members and admins read.
-- =============================================================================

-- rollback: by hand, after 328 and before 326 — the statements are listed at the end of this file
-- safety: constraint — no company on production is suspended or carries a suspension reason (checked 2026-09-27), and this file moves any reason into company_moderation before the check is added
-- safety: ships-with-code — apply after the deploy that carries this branch's src/ changes. The new code works without it (the console says the migration is missing, the report and appeal forms refuse cleanly), but main's bell shows the notification kinds this writes (company_suspended, company_restored, profile_restricted, profile_restored, account_held) only as its generic line, so the person would not be told what happened until the code arrives; main's admin company page would also stop showing a suspension reason, which the new page reads from company_moderation.

-- ---------------------------------------------------------------------------
-- Where a link goes
-- ---------------------------------------------------------------------------

create or replace function public.safety_host(p_url text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select nullif(
           regexp_replace(
             regexp_replace(lower(btrim(p_url)), '^[a-z][a-z0-9+.-]*://', ''),
             '^www\.|[/?#:].*$', '', 'g'),
           '');
$$;

revoke execute on function public.safety_host(text) from public, anon, authenticated;

/*
  What two companies would have to share for "same website" to mean anything.
  For an ordinary domain that is the host. For a page on a platform everybody
  uses — a Facebook page, a Linktree — it is the host and the page's name,
  or every company with a Facebook page would share a website.
*/
create or replace function public.safety_site_key(p_url text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
           when s.host is null then null
           when s.host ~ '(^|\.)(facebook\.com|fb\.com|instagram\.com|linkedin\.com|tiktok\.com|x\.com|twitter\.com|youtube\.com|linktr\.ee|wa\.me|t\.me|sites\.google\.com|wixsite\.com|blogspot\.com|business\.site)$'
             then s.host || '/' || split_part(
                    regexp_replace(lower(btrim(p_url)), '^([a-z][a-z0-9+.-]*://)?(www\.)?[^/]+/?', ''), '/', 1)
           else s.host
         end
    from (select public.safety_host(p_url) as host) s;
$$;

revoke execute on function public.safety_site_key(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Text flags
--
-- Matched against the text as search normalises it (migration 23): diacritics
-- and tatweel removed, alef, ya and taa marbuta folded, Arabic-Indic digits
-- made Latin, lower case. So the Arabic patterns below are written in that
-- folded spelling — تامين, not تأمين.
--
-- Written against real-estate adverts, where money is everywhere: a sales job
-- talks about commission, booking amounts and down payments on units, and a
-- benefit is "تأمين اجتماعي". What is flagged is money asked *of the
-- candidate* — a fee to register, train or be interviewed, an amount to
-- transfer, a refundable deposit — and payment rails a legitimate employer has
-- no reason to name in a job advert.
--
-- Returns [{flag, weight, evidence}], one entry per flag, evidence being the
-- matched words with a little context, for the moderator and nobody else.
-- ---------------------------------------------------------------------------

create or replace function public.safety_text_flags(p_text text, p_own_host text default null)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_text   text;
  v_links  text;
  v_digits text;
  v_flags  jsonb := '[]'::jsonb;
  v_hit    text;
  v_rule   record;
  v_url    text;
  v_host   text;
  v_kind   text;
begin
  if p_text is null or btrim(p_text) = '' then
    return v_flags;
  end if;

  v_text := ' ' || regexp_replace(public.ar_normalise(p_text), '\s+', ' ', 'g') || ' ';

  for v_rule in
    select * from (values
      -- A fee or an amount asked of the candidate.
      ('asks_for_money', 'high',
       '(?:رسوم|رسم|مصاريف|مصروفات) (?:ال)?(?:تسجيل|اشتراك|تدريب|كورس|دوره|تقديم|التحاق|تعيين|انضمام|ملف|اداريه|استماره|مقابله|توظيف|قبول)'),
      ('asks_for_money', 'high',
       '(?:ادفع|تدفع|هتدفع|تسدد|سدد|حول|تحول|هتحول) (?:ال)?(?:مبلغ|رسوم|قيمه|اشتراك|تامين)'),
      ('asks_for_money', 'high',
       '(?:مطلوب|يجب|لازم|بشرط) (?:ال)?(?:دفع|سداد|تحويل|ايداع) (?:ال)?(?:مبلغ|رسوم|قيمه|اشتراك|تامين)'),
      ('asks_for_money', 'high',
       '(?:يدفع|يسدد|على) (?:ال)?(?:متقدم|مرشح|موظف الجديد)'),
      ('asks_for_money', 'high',
       'مبلغ (?:تامين|مسترد|رمزي|اشتراك)|تامين (?:مسترد|نقدي|قابل للاسترداد)'),
      ('asks_for_money', 'high',
       '(?:فودافون|اورانج|اتصالات) ?كاش|انستا ?باي|instapay|vodafone ?cash|orange ?cash|etisalat ?cash|fawry|western union|ويسترن يونيون|moneygram|bitcoin|بيتكوين|usdt|crypto|كريبتو|عملات رقميه|محفظه (?:الكترونيه|كاش)|e-?wallet'),
      ('asks_for_money', 'high',
       '(?:registration|training|application|joining|processing|onboarding|course|administrative|admin|interview|file|visa) fees?'),
      ('asks_for_money', 'high',
       '(?:refundable|security|cash) deposit|pay (?:a |an |the )?(?:small |one[- ]time )?(?:fee|deposit|amount)|(?:upfront|advance) (?:fee|payment)|payment (?:is )?required|send (?:money|payment)'),

      -- Identity, bank or login details, which no advert needs.
      ('asks_for_documents', 'high',
       '(?:رقم|صوره|صور|نسخه|كوبي|سكان|اسكان) (?:ال)?(?:بطاقه|بطاقتك|رقم القومي|قومي|هويه|باسبور|جواز)'),
      ('asks_for_documents', 'high',
       'الرقم القومي|رقم قومي'),
      ('asks_for_documents', 'high',
       '(?:رقم|بيانات|تفاصيل) (?:ال)?(?:حساب ?(?:ال)?بنكي|حسابك البنكي|فيزا|كارت ?(?:ال)?(?:بنكي|فيزا|ائتمان)|بطاقه ?(?:ال)?(?:ائتمان|بنكيه))'),
      ('asks_for_documents', 'high',
       '(?:كود|رمز) (?:ال)?(?:تفعيل|تحقق|سري)|كلمه (?:ال)?(?:سر|مرور)|باسورد|الكود (?:اللي|الي) (?:هيوصلك|وصلك|هيجيلك|جالك|هيوصل)'),
      ('asks_for_documents', 'high',
       'national id|id (?:card )?(?:copy|photo|scan|number)|passport (?:copy|photo|scan|number)|bank (?:account|details|statement)|credit card|card number|cvv|one[- ]time (?:code|password)|verification code|password|\motp\M')
    ) as r(flag, weight, pattern)
  loop
    if v_flags @> jsonb_build_array(jsonb_build_object('flag', v_rule.flag)) then
      continue;
    end if;
    v_hit := substring(v_text from '.{0,24}(?:' || v_rule.pattern || ').{0,24}');
    if v_hit is not null then
      v_flags := v_flags || jsonb_build_object('flag', v_rule.flag, 'weight', v_rule.weight,
                                               'evidence', btrim(v_hit));
    end if;
  end loop;

  -- An email address: contact off the platform. Removed before the link scan
  -- so its domain is not reported a second time as a website.
  v_hit := substring(v_text from '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}');
  if v_hit is not null then
    v_flags := v_flags || jsonb_build_object('flag', 'email_in_text', 'weight', 'low', 'evidence', v_hit);
  end if;
  v_links := regexp_replace(v_text, '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}', ' ', 'g');

  -- An Egyptian mobile number, however it was spaced out.
  v_digits := regexp_replace(v_links, '([0-9])[ .-]+(?=[0-9])', '\1', 'g');
  v_hit := substring(v_digits from '(?:\+?20|0020)?0?1[0125][0-9]{8}');
  if v_hit is not null then
    v_flags := v_flags || jsonb_build_object('flag', 'phone_in_text', 'weight', 'low', 'evidence', v_hit);
  end if;

  -- A link straight to an address rather than a name.
  v_hit := substring(v_links from 'https?://[0-9]{1,3}(?:\.[0-9]{1,3}){3}[^ ]*');
  if v_hit is not null then
    v_flags := v_flags || jsonb_build_object('flag', 'suspicious_link', 'weight', 'high', 'evidence', v_hit);
  end if;

  for v_url in
    select m[1]
      from regexp_matches(v_links,
        '((?:https?://)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|info|biz|io|co|me|ly|gl|gle|gd|at|cc|xyz|link|site|online|top|app|page|live|click|shop|store|eg|ae|sa|uk|us|de|ru|tk|ml|ga|cf|gq|in|ee|to|dev|ai|gg|ws|so|pw|id)(?:[/?#][^ ]*)?)',
        'g') as m
  loop
    v_host := public.safety_host(v_url);
    continue when v_host is null;

    v_kind := case
      when v_host ~ '(^|\.)(bit\.ly|bitly\.com|tinyurl\.com|t\.co|goo\.gl|cutt\.ly|rb\.gy|is\.gd|ow\.ly|buff\.ly|shorturl\.at|tiny\.cc|s\.id|v\.gd|rebrand\.ly|bl\.ink|t\.ly|shorte\.st|adf\.ly|lnkd\.in)$'
        then 'shortened_link'
      when v_host ~ '(^|\.)(t\.me|telegram\.me|telegram\.org|telegram\.dog)$'
        then 'telegram_link'
      when v_host ~ '(^|\.)(forms\.gle|jotform\.com|typeform\.com|surveymonkey\.com|forms\.office\.com)$'
           or (v_host = 'docs.google.com' and v_url ~ '/forms')
        then 'form_link'
      when v_host ~ '(^|\.)xn--'
        then 'suspicious_link'
      when v_host ~ '(^|\.)(wa\.me|whatsapp\.com)$'
        then 'whatsapp_link'
      when p_own_host is not null and (v_host = p_own_host or v_host like '%.' || p_own_host)
        then null
      else 'external_link'
    end;

    if v_kind is not null
       and not (v_flags @> jsonb_build_array(jsonb_build_object('flag', v_kind))) then
      v_flags := v_flags || jsonb_build_object(
        'flag', v_kind,
        'weight', case when v_kind in ('whatsapp_link', 'external_link') then 'low' else 'high' end,
        'evidence', v_host);
    end if;
  end loop;

  return v_flags;
end;
$$;

revoke execute on function public.safety_text_flags(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Somebody else's name
--
-- Checked only for a company that is not verified: verification is exactly the
-- step that settles whether "Palm Hills Sales" is Palm Hills. Two ways to
-- resemble a developer on the taxonomy list — its whole name appears, or
-- every distinctive word of it does ("طلعت" and "مصطفي", not "مجموعه") — and
-- one way to resemble a verified company: its full name, eight letters or
-- more, inside this one's. Generic words (مصر, العقاريه, developers, group…)
-- never count, or every brokerage in Egypt would resemble Tatweer Misr.
-- ---------------------------------------------------------------------------

create or replace function public.company_name_resemblance(p_company uuid, p_name_ar text, p_name_en text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_generic constant text[] := array[
    'مصر', 'مصريه', 'المصريه', 'تطوير', 'للتطوير', 'التطوير', 'استثمار', 'للاستثمار', 'الاستثمار',
    'عقاري', 'عقاريه', 'العقاري', 'العقاريه', 'عقارات', 'للعقارات', 'العقارات', 'مجموعه', 'شركه',
    'اسكان', 'للاسكان', 'الاسكان', 'مدينه', 'المدينه', 'بارك', 'سيتي', 'تسويق', 'للتسويق', 'التسويق',
    'هومز', 'بروبرتيز', 'جروب', 'القابضه', 'ديفلوبرز', 'للمقاولات', 'المقاولات',
    'misr', 'masr', 'egypt', 'egyptian', 'group', 'developer', 'developers', 'development',
    'developments', 'real', 'estate', 'realty', 'properties', 'property', 'investment',
    'investments', 'holding', 'holdings', 'city', 'park', 'homes', 'company', 'the', 'and'];
  -- Words that say what kind of entity it is, never which one. Matched as
  -- whole words (the text is space-padded), and repeated because a match
  -- consumes the space the next one would need.
  v_forms  constant text := ' (?:شركه|مؤسسه|مكتب|company|co|ltd|llc|inc|the|sae)(?= )';
  v_names  text;
  v_dev    record;
  v_phrase text;
  v_norm   text;
  v_tokens text[];
  v_other  record;
begin
  v_names := ' ' || btrim(regexp_replace(public.ar_normalise(concat_ws(' ', p_name_ar, p_name_en)),
                                         '[[:punct:][:space:]]+', ' ', 'g')) || ' ';
  if btrim(v_names) = '' then
    return null;
  end if;

  for v_dev in select name_ar, name_en from developers loop
    foreach v_phrase in array array[v_dev.name_ar, v_dev.name_en] loop
      continue when v_phrase is null;
      v_norm := btrim(regexp_replace(public.ar_normalise(v_phrase), '[[:punct:][:space:]]+', ' ', 'g'));

      if length(v_norm) >= 6 and position(' ' || v_norm || ' ' in v_names) > 0 then
        return jsonb_build_object('kind', 'developer', 'name', v_phrase);
      end if;

      select array_agg(w) into v_tokens
        from unnest(string_to_array(v_norm, ' ')) as w
       where length(w) >= 4 and not (w = any (v_generic));

      if cardinality(v_tokens) > 0
         and not exists (select 1 from unnest(v_tokens) as w where position(' ' || w || ' ' in v_names) = 0) then
        return jsonb_build_object('kind', 'developer', 'name', v_phrase);
      end if;
    end loop;
  end loop;

  -- The corporate form is not part of the name: "شركة الرواد العقارية" and
  -- "الرواد العقارية مصر" are the same brand.
  v_names := regexp_replace(v_names, v_forms, ' ', 'g');

  for v_other in
    select c.name_ar, c.name_en,
           btrim(regexp_replace(' ' || regexp_replace(public.ar_normalise(c.name_ar), '[[:punct:][:space:]]+', ' ', 'g') || ' ',
                                v_forms, ' ', 'g')) as n_ar,
           btrim(regexp_replace(' ' || regexp_replace(public.ar_normalise(coalesce(c.name_en, '')), '[[:punct:][:space:]]+', ' ', 'g') || ' ',
                                v_forms, ' ', 'g')) as n_en
      from companies c
     where c.id is distinct from p_company
       and c.verification_status = 'verified'
  loop
    if (length(v_other.n_ar) >= 8 and position(' ' || v_other.n_ar || ' ' in v_names) > 0)
       or (length(v_other.n_en) >= 8 and position(' ' || v_other.n_en || ' ' in v_names) > 0) then
      return jsonb_build_object('kind', 'company', 'name', coalesce(v_other.name_en, v_other.name_ar));
    end if;
  end loop;

  return null;
end;
$$;

revoke execute on function public.company_name_resemblance(uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Flags for one listing, one company
-- ---------------------------------------------------------------------------

create or replace function public.job_safety_flags(p_job uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
           public.safety_text_flags(
             concat_ws(' ', j.title_ar, j.title_en, j.description_ar, j.description_en,
                       j.requirements_ar, j.commission_note_ar),
             public.safety_host(c.website)),
           '[]'::jsonb)
    from jobs j
    join companies c on c.id = j.company_id
   where j.id = p_job;
$$;

revoke execute on function public.job_safety_flags(uuid) from public, anon, authenticated;

create or replace function public.company_safety_flags(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_company companies%rowtype;
  v_flags   jsonb;
  v_site    jsonb;
  v_flag    jsonb;
  v_like    jsonb;
begin
  select * into v_company from companies where id = p_company;
  if not found then
    return '[]'::jsonb;
  end if;

  v_flags := public.safety_text_flags(concat_ws(' ', v_company.about_ar, v_company.about_en),
                                      public.safety_host(v_company.website));

  -- The website field itself: only what hides where it goes counts here; a
  -- company's own site being an outside link is the point of the field.
  v_site := public.safety_text_flags(v_company.website);
  for v_flag in select * from jsonb_array_elements(v_site) loop
    if v_flag ->> 'weight' = 'high'
       and not (v_flags @> jsonb_build_array(jsonb_build_object('flag', v_flag ->> 'flag'))) then
      v_flags := v_flags || v_flag;
    end if;
  end loop;

  if v_company.verification_status <> 'verified' then
    v_like := public.company_name_resemblance(v_company.id, v_company.name_ar, v_company.name_en);
    if v_like is not null then
      v_flags := v_flags || jsonb_build_object(
        'flag', 'impersonation', 'weight', 'high',
        'evidence', v_like ->> 'name', 'kind', v_like ->> 'kind');
    end if;
  end if;

  return v_flags;
end;
$$;

revoke execute on function public.company_safety_flags(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Company signals
--
-- A fingerprint of each listing's description (normalised, punctuation and
-- spacing gone) makes "the same advert again" an indexed equality rather than
-- a comparison of every listing with every other.
--
-- An index on the expression, not a column on jobs. A stored generated column
-- reads as null in a BEFORE trigger's NEW, and bump_version() (324) compares
-- whole rows to tell a page view from an edit: a second such column made
-- every view look like an edit, moving the version that approval emails and
-- the edit form's lock key on. It would also have rewritten the whole table.
-- ---------------------------------------------------------------------------

create or replace function public.job_text_fingerprint(p_description text)
returns text
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select md5(regexp_replace(public.ar_normalise(coalesce(p_description, '')), '[[:space:][:punct:]]+', ' ', 'g'));
$$;

create index if not exists jobs_text_fingerprint_idx
  on jobs (public.job_text_fingerprint(description_ar))
  where status <> 'draft';

-- Shared phone numbers are found by equality on the number.
create index if not exists profiles_whatsapp_phone_idx on profiles (whatsapp_phone);

create or replace function public.company_review_signals(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_company  companies%rowtype;
  v_signals  jsonb := '[]'::jsonb;
  v_n        int;
  v_m        int;
  v_list     jsonb;
  v_site     text;
  v_flags    jsonb;
begin
  select * into v_company from companies where id = p_company;
  if not found then
    return jsonb_build_object('signals', '[]'::jsonb, 'facts', '{}'::jsonb);
  end if;

  -- Many listings at once.
  select count(*) filter (where created_at > now() - interval '1 day'),
         count(*) filter (where created_at > now() - interval '7 days')
    into v_n, v_m
    from jobs
   where company_id = p_company;
  if v_n >= 5 or v_m >= 15 then
    v_signals := v_signals || jsonb_build_object('signal', 'mass_posting', 'day', v_n, 'week', v_m);
  end if;

  -- Listings a moderator turned down or took down in ninety days, from the
  -- console's own record; or rejected right now, for anything older.
  select count(distinct target_id) into v_n
    from admin_audit_log
   where action in ('job.reject', 'job.unpublish', 'job.request_changes')
     and metadata ->> 'company_id' = p_company::text
     and created_at > now() - interval '90 days';
  v_n := greatest(v_n, (select count(*)::int from jobs where company_id = p_company and status = 'rejected'));
  if v_n >= 3 then
    v_signals := v_signals || jsonb_build_object('signal', 'rejections', 'count', v_n);
  end if;

  -- The same advert, three times or more, all live or waiting.
  select coalesce(max(n), 0) into v_n
    from (select count(*)::int as n
            from jobs
           where company_id = p_company and status in ('pending_review', 'active')
           group by public.job_text_fingerprint(description_ar)) g;
  if v_n >= 3 then
    v_signals := v_signals || jsonb_build_object('signal', 'duplicate_listings', 'count', v_n);
  end if;

  -- Another company's advert, word for word. Short descriptions are left out:
  -- "مطلوب مندوب مبيعات" is not copying.
  select coalesce(jsonb_agg(distinct jsonb_build_object(
           'id', c.id, 'name_ar', c.name_ar, 'name_en', c.name_en,
           'suspended', c.suspended_at is not null)), '[]'::jsonb)
    into v_list
    from jobs mine
    join jobs theirs on public.job_text_fingerprint(theirs.description_ar) = public.job_text_fingerprint(mine.description_ar)
                    and theirs.company_id <> mine.company_id
                    and theirs.status <> 'draft'
    join companies c on c.id = theirs.company_id
   where mine.company_id = p_company
     and mine.status <> 'draft'
     and length(mine.description_ar) >= 120;
  if jsonb_array_length(v_list) > 0 then
    v_signals := v_signals || jsonb_build_object('signal', 'copied_listings', 'companies', v_list);
  end if;

  -- Complaints from different people, about the company or its listings.
  select count(distinct reporter_id)::int, count(*)::int into v_n, v_m
    from reports
   where source = 'user'
     and created_at > now() - interval '90 days'
     and ((target_type = 'company' and target_id = p_company)
       or (target_type = 'job' and target_snapshot ->> 'company_id' = p_company::text));
  if v_n >= 2 then
    v_signals := v_signals || jsonb_build_object('signal', 'reported', 'reporters', v_n, 'reports', v_m);
  end if;

  -- What the company says about itself, and what its live and waiting
  -- listings say.
  v_flags := public.company_safety_flags(p_company);
  if exists (select 1 from jsonb_array_elements(v_flags) f where f ->> 'weight' = 'high') then
    v_signals := v_signals || jsonb_build_object('signal', 'company_text',
      'flags', (select jsonb_agg(f) from jsonb_array_elements(v_flags) f where f ->> 'weight' = 'high'));
  end if;

  select count(*)::int into v_n
    from jobs j
   where j.company_id = p_company
     and j.status in ('pending_review', 'active')
     and exists (select 1 from jsonb_array_elements(public.job_safety_flags(j.id)) f
                  where f ->> 'weight' = 'high');
  if v_n > 0 then
    v_signals := v_signals || jsonb_build_object('signal', 'flagged_listings', 'count', v_n);
  end if;

  -- The same WhatsApp number in another company.
  select coalesce(jsonb_agg(distinct jsonb_build_object(
           'id', c2.id, 'name_ar', c2.name_ar, 'name_en', c2.name_en,
           'suspended', c2.suspended_at is not null)), '[]'::jsonb)
    into v_list
    from company_members m1
    join profiles p1 on p1.id = m1.user_id
    join profiles p2 on p2.whatsapp_phone = p1.whatsapp_phone and p2.id <> p1.id
    join company_members m2 on m2.user_id = p2.id and m2.company_id <> p_company
    join companies c2 on c2.id = m2.company_id
   where m1.company_id = p_company;
  if jsonb_array_length(v_list) > 0 then
    v_signals := v_signals || jsonb_build_object('signal', 'shared_phone', 'companies', v_list);
  end if;

  -- ...or on an account that is suspended, in any company or none.
  select count(distinct p2.id)::int into v_n
    from company_members m1
    join profiles p1 on p1.id = m1.user_id
    join profiles p2 on p2.whatsapp_phone = p1.whatsapp_phone and p2.id <> p1.id
   where m1.company_id = p_company
     and p2.approval_status = 'rejected';
  if v_n > 0 then
    v_signals := v_signals || jsonb_build_object('signal', 'phone_of_suspended_account', 'count', v_n);
  end if;

  -- The same website as another company.
  v_site := public.safety_site_key(v_company.website);
  if v_site is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', c2.id, 'name_ar', c2.name_ar, 'name_en', c2.name_en,
             'suspended', c2.suspended_at is not null)), '[]'::jsonb)
      into v_list
      from companies c2
     where c2.id <> p_company
       and public.safety_site_key(c2.website) = v_site;
    if jsonb_array_length(v_list) > 0 then
      v_signals := v_signals || jsonb_build_object('signal', 'shared_website', 'site', v_site, 'companies', v_list);
    end if;
  end if;

  return jsonb_build_object(
    'signals', v_signals,
    'facts', jsonb_build_object(
      'new', v_company.created_at > now() - interval '7 days',
      'verified', v_company.verification_status = 'verified',
      'suspended', v_company.suspended_at is not null));
end;
$$;

revoke execute on function public.company_review_signals(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The admin's doors to all of the above
-- ---------------------------------------------------------------------------

create or replace function public.admin_job_signals(p_jobs uuid[])
returns table (job_id uuid, flags jsonb, company_id uuid, company_signals jsonb)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_jobs), 0) > 100 then
    raise exception 'invalid_action';
  end if;

  return query
    with js as (
      select j.id, j.company_id from jobs j where j.id = any (p_jobs)
    ),
    cs as (
      select d.cid, public.company_review_signals(d.cid) as s
        from (select distinct js.company_id as cid from js) d
    )
    select js.id, public.job_safety_flags(js.id), js.company_id, cs.s
      from js
      join cs on cs.cid = js.company_id;
end;
$$;

create or replace function public.admin_company_signals(p_companies uuid[])
returns table (company_id uuid, flags jsonb, signals jsonb)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_companies), 0) > 100 then
    raise exception 'invalid_action';
  end if;

  return query
    select c.id, public.company_safety_flags(c.id), public.company_review_signals(c.id)
      from companies c
     where c.id = any (p_companies);
end;
$$;

-- The review queue's "flagged" view: listings waiting on a moderator whose
-- own text carries a high-weight flag.
create or replace function public.admin_flagged_pending_jobs(p_limit int default 200)
returns setof uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
    select j.id
      from jobs j
     where j.status = 'pending_review'
       and exists (select 1 from jsonb_array_elements(public.job_safety_flags(j.id)) f
                    where f ->> 'weight' = 'high')
     order by j.created_at, j.id
     limit greatest(1, least(p_limit, 500));
end;
$$;

revoke execute on function public.admin_job_signals(uuid[])       from public, anon;
revoke execute on function public.admin_company_signals(uuid[])   from public, anon;
revoke execute on function public.admin_flagged_pending_jobs(int) from public, anon;
grant  execute on function public.admin_job_signals(uuid[])       to authenticated;
grant  execute on function public.admin_company_signals(uuid[])   to authenticated;
grant  execute on function public.admin_flagged_pending_jobs(int) to authenticated;

-- ---------------------------------------------------------------------------
-- A live listing's text goes back to review, all of it
-- ---------------------------------------------------------------------------

create or replace function public.review_live_text_edits()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.acting_as_admin() then
    return new;
  end if;

  if old.status = 'active' and new.status = 'active'
     and (new.title_en, new.description_en, new.requirements_ar, new.commission_note_ar, new.employment_type)
         is distinct from
         (old.title_en, old.description_en, old.requirements_ar, old.commission_note_ar, old.employment_type)
  then
    new.status := 'pending_review';
  end if;

  return new;
end;
$$;

revoke execute on function public.review_live_text_edits() from public, anon, authenticated;

-- 12: after the owner's transition rules (10) have judged the statement,
-- before the suspension (15), cap (20) and credit (25) checks.
drop trigger if exists jobs_12_text_edits_are_reviewed on jobs;
create trigger jobs_12_text_edits_are_reviewed
  before update on jobs
  for each row execute function public.review_live_text_edits();

-- ---------------------------------------------------------------------------
-- Good standing to submit
--
-- Runs on every insert and update (not only "update of status") because the
-- move into review is often made by a trigger — 10 or 12 above — rather than
-- by the statement, and a column-list trigger would never see it.
-- ---------------------------------------------------------------------------

create or replace function public.require_standing_to_submit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.acting_as_admin() or auth.uid() is null then
    return new;
  end if;
  if new.status <> 'pending_review' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'pending_review' then
    return new;
  end if;

  if not exists (select 1 from profiles where id = auth.uid() and approval_status = 'approved') then
    raise exception 'account_not_in_good_standing'
      using hint = 'This account is restricted or suspended; nothing new can be submitted for review until that is lifted.';
  end if;

  return new;
end;
$$;

revoke execute on function public.require_standing_to_submit() from public, anon, authenticated;

drop trigger if exists jobs_16_submitter_in_good_standing on jobs;
create trigger jobs_16_submitter_in_good_standing
  before insert or update on jobs
  for each row execute function public.require_standing_to_submit();

-- ---------------------------------------------------------------------------
-- A company's own words, raised for review when they carry a high flag
--
-- A company goes public the moment it is created — there is no approval step
-- for the profile the way there is for a listing — so this is the one place a
-- platform flag becomes a queue item (a report with source = system). It is
-- raised once until somebody closes it, and not again for text a moderator
-- already dismissed. The company is not told; nothing about it changes.
-- ---------------------------------------------------------------------------

create or replace function public.flag_company_text()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_high   jsonb;
  v_reason text;
  v_detail text;
begin
  if public.acting_as_admin() then
    return null;
  end if;
  if tg_op = 'UPDATE'
     and (new.name_ar, new.name_en, new.about_ar, new.about_en, new.website)
         is not distinct from (old.name_ar, old.name_en, old.about_ar, old.about_en, old.website) then
    return null;
  end if;

  select coalesce(jsonb_agg(f), '[]'::jsonb) into v_high
    from jsonb_array_elements(public.company_safety_flags(new.id)) f
   where f ->> 'weight' = 'high';

  if jsonb_array_length(v_high) = 0 then
    return null;
  end if;

  v_reason := case
    when v_high @> '[{"flag": "impersonation"}]' then 'impersonation'
    when v_high @> '[{"flag": "asks_for_money"}]' or v_high @> '[{"flag": "asks_for_documents"}]' then 'scam'
    else 'suspicious_company'
  end;

  select string_agg((f ->> 'flag') || ': ' || coalesce(f ->> 'evidence', ''), ' · ')
    into v_detail
    from jsonb_array_elements(v_high) f;

  perform public.raise_system_report('company', new.id, v_reason, v_detail);
  return null;
end;
$$;

revoke execute on function public.flag_company_text() from public, anon, authenticated;

drop trigger if exists companies_92_flag_text on companies;
create trigger companies_92_flag_text
  after insert or update on companies
  for each row execute function public.flag_company_text();

-- ---------------------------------------------------------------------------
-- The suspension reason: to the company, not to the internet
-- ---------------------------------------------------------------------------

create table if not exists company_moderation (
  company_id        uuid primary key references companies (id) on delete cascade,
  suspension_reason text check (length(suspension_reason) <= 1000),
  updated_at        timestamptz not null default now()
);

alter table company_moderation enable row level security;

drop policy if exists company_moderation_read on company_moderation;
create policy company_moderation_read on company_moderation
  for select using (public.owns_company(company_id) or (select public.is_admin()));

revoke all on company_moderation from anon;
revoke insert, update, delete, truncate on company_moderation from authenticated;

insert into company_moderation (company_id, suspension_reason)
select id, suspension_reason from companies where suspension_reason is not null
on conflict (company_id) do update set suspension_reason = excluded.suspension_reason, updated_at = now();

update companies set suspension_reason = null where suspension_reason is not null;

alter table companies drop constraint if exists companies_suspension_reason_is_private;
alter table companies add constraint companies_suspension_reason_is_private
  check (suspension_reason is null);

comment on column companies.suspension_reason is
  'Always null since migration 327: the reason lives in company_moderation, '
  'which only the company''s members and admins can read.';

-- Restated from migration 318 with one change: the reason is written to
-- company_moderation, before the company row, so the notification trigger
-- below can read it.
create or replace function public.admin_set_company_suspension(
  p_company uuid,
  p_suspend boolean,
  p_reason  text default null
)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company companies%rowtype;
  v_reason  text;
  v_down    int := 0;
begin
  perform public.admin_begin();

  select * into v_company from companies where id = p_company for update;
  if not found then
    raise exception 'not_found';
  end if;

  v_reason := public.admin_reason(p_reason, true);

  if p_suspend and v_company.suspended_at is not null then
    raise exception 'no_change' using hint = 'The company is already suspended.';
  end if;
  if not p_suspend and v_company.suspended_at is null then
    raise exception 'no_change' using hint = 'The company is not suspended.';
  end if;

  if p_suspend then
    insert into company_moderation (company_id, suspension_reason, updated_at)
    values (p_company, v_reason, now())
    on conflict (company_id) do update
      set suspension_reason = excluded.suspension_reason, updated_at = now();

    update companies
       set suspended_at = now(), suspension_reason = null
     where id = p_company;

    update jobs
       set status = 'rejected', rejection_note = v_reason
     where company_id = p_company and status in ('active', 'pending_review');
    get diagnostics v_down = row_count;
  else
    update company_moderation
       set suspension_reason = null, updated_at = now()
     where company_id = p_company;

    update companies
       set suspended_at = null, suspension_reason = null
     where id = p_company;
  end if;

  perform public.admin_audit(
    case when p_suspend then 'company.suspended' else 'company.restored' end,
    'company', p_company::text, v_company.name_ar, v_reason,
    jsonb_build_object('listings_taken_down', v_down));

  return v_down;
end;
$$;

revoke execute on function public.admin_set_company_suspension(uuid, boolean, text) from public, anon;
grant  execute on function public.admin_set_company_suspension(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Telling the people a decision is about
--
-- Separate triggers rather than clauses in on_approval_changed() or
-- on_job_moderated(), which other migrations restate (305, 318). None of
-- these reads the approval note, which 305 moved into profile_private.
-- ---------------------------------------------------------------------------

create or replace function public.tell_company_about_suspension()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (old.suspended_at is null) = (new.suspended_at is null) then
    return null;
  end if;

  perform public.moderation_notify_company(
    new.id,
    (case when new.suspended_at is not null then 'company_suspended' else 'company_restored' end)::notification_kind,
    jsonb_build_object(
      'name_ar', new.name_ar,
      'name_en', new.name_en,
      'note', case when new.suspended_at is not null
                   then (select suspension_reason from company_moderation where company_id = new.id) end),
    '/employer');
  return null;
end;
$$;

revoke execute on function public.tell_company_about_suspension() from public, anon, authenticated;

drop trigger if exists companies_93_tell_about_suspension on companies;
create trigger companies_93_tell_about_suspension
  after update on companies
  for each row execute function public.tell_company_about_suspension();

create or replace function public.tell_consultant_about_restriction()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (old.restricted_at is null) = (new.restricted_at is null) then
    return null;
  end if;

  perform public.moderation_notify(
    new.user_id,
    (case when new.restricted_at is not null then 'profile_restricted' else 'profile_restored' end)::notification_kind,
    jsonb_build_object('note', case when new.restricted_at is not null then new.restriction_reason end),
    '/dashboard/profile');
  return null;
end;
$$;

revoke execute on function public.tell_consultant_about_restriction() from public, anon, authenticated;

drop trigger if exists agent_profiles_93_tell_about_restriction on agent_profiles;
create trigger agent_profiles_93_tell_about_restriction
  after update on agent_profiles
  for each row execute function public.tell_consultant_about_restriction();

-- A hold (restriction) on an account that was trading. The first review of a
-- new employer is also "pending", but it is set on insert, never by an
-- update, so it does not arrive here.
create or replace function public.tell_account_about_hold()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.approval_status = 'pending' and old.approval_status in ('approved', 'rejected') then
    perform public.moderation_notify(
      new.id, 'account_held', '{}'::jsonb,
      case when new.role = 'employer' then '/employer' else '/dashboard' end);
  end if;
  return null;
end;
$$;

revoke execute on function public.tell_account_about_hold() from public, anon, authenticated;

drop trigger if exists profiles_93_tell_about_hold on profiles;
create trigger profiles_93_tell_about_hold
  after update on profiles
  for each row execute function public.tell_account_about_hold();

-- ---------------------------------------------------------------------------
-- Rollback, by hand, after 328 and before 326:
--
--   drop trigger if exists profiles_93_tell_about_hold on profiles;
--   drop trigger if exists agent_profiles_93_tell_about_restriction on agent_profiles;
--   drop trigger if exists companies_93_tell_about_suspension on companies;
--   drop trigger if exists companies_92_flag_text on companies;
--   drop trigger if exists jobs_16_submitter_in_good_standing on jobs;
--   drop trigger if exists jobs_12_text_edits_are_reviewed on jobs;
--   drop function if exists public.tell_account_about_hold(), public.tell_consultant_about_restriction(),
--     public.tell_company_about_suspension(), public.flag_company_text(), public.require_standing_to_submit(),
--     public.review_live_text_edits(), public.admin_flagged_pending_jobs(int),
--     public.admin_company_signals(uuid[]), public.admin_job_signals(uuid[]),
--     public.company_review_signals(uuid), public.company_safety_flags(uuid), public.job_safety_flags(uuid),
--     public.company_name_resemblance(uuid, text, text), public.safety_text_flags(text, text),
--     public.safety_site_key(text), public.safety_host(text);
--   alter table companies drop constraint if exists companies_suspension_reason_is_private;
--   update companies c set suspension_reason = m.suspension_reason
--     from company_moderation m where m.company_id = c.id and c.suspended_at is not null;
--   -- restate admin_set_company_suspension() exactly as migration 318 wrote it
--   drop table if exists company_moderation;
--   drop index if exists jobs_text_fingerprint_idx, profiles_whatsapp_phone_idx;
--   drop function if exists public.job_text_fingerprint(text);
-- ---------------------------------------------------------------------------
