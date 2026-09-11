-- =============================================================================
-- 60 — The good applicant from last month, with nowhere to keep them
--
-- Shortlisting exists and it is per listing: applications.status = 'shortlisted'
-- says "for this role". A brokerage hiring continuously does not think that
-- way. The consultant who was strong but second for the Sheikh Zayed seat is
-- exactly who they want for the next one, and today the only way back to that
-- person is to remember which listing they applied to. Nothing at all can be
-- kept from the directory, where an employer may meet somebody before a role
-- for them exists.
--
-- The table is the company's, not the recruiter's, because migration 22 made a
-- company a team — the same reason the applicant inbox is shared. A colleague
-- who leaves takes nothing with them; `saved_by` goes null and the row stays,
-- which is also why there is no update policy. A save is a fact about a moment,
-- and a list that can be quietly re-attributed is worth less than one that
-- cannot.
--
-- ---------------------------------------------------------------------------
-- The privacy rule, which is the whole design
-- ---------------------------------------------------------------------------
-- A consultant chooses who sees them: `public`, `verified_employers_only`, or
-- `hidden`. Saving must not become a way around that choice, in either
-- direction in time:
--
--   Going in — only a card that is open to this viewer right now may be saved.
--   Otherwise an unverified company could collect the whole directory as ids
--   and wait to become verified, which is the gate with extra steps.
--
--   Coming out — the saved row proves nothing about today. A consultant who
--   switches to `hidden` has left the directory, and a pool that kept showing
--   their name would be a copy of the directory taken before they left. So the
--   reader re-derives visibility on every read rather than trusting what was
--   true at save time, and a row whose consultant has gone comes back as a row
--   and nothing else: no name, no photo, no headline, and no slug — the slug
--   is the name transliterated, so returning it would hand back exactly what
--   the rest of the row withholds.
--
-- The employer still sees that the row exists, which is the same thing they
-- would learn by following the link and finding nothing there, and it is the
-- only way for them to tidy a list they can no longer read.
-- =============================================================================

create table if not exists saved_agents (
  company_id uuid not null references companies on delete cascade,
  agent_id   uuid not null references agent_profiles on delete cascade,
  -- Whose idea it was. `set null` rather than cascade: the note on who
  -- shortlisted somebody is worth keeping after they leave, and the pool is
  -- the company's either way.
  saved_by   uuid references profiles on delete set null,
  created_at timestamptz not null default now(),

  -- Saving the same consultant twice is not two rows.
  primary key (company_id, agent_id)
);

-- The list as it is actually read: one company's, newest first.
create index if not exists saved_agents_company_idx
  on saved_agents (company_id, created_at desc);

-- Both foreign keys, indexed. Not for any query this migration writes — for
-- the delete side: removing a consultant or an account takes the referencing
-- rows with it, and without these that is a sequential scan of the whole
-- table per deleted row.
create index if not exists saved_agents_agent_idx    on saved_agents (agent_id);
create index if not exists saved_agents_saved_by_idx on saved_agents (saved_by);

-- ---------------------------------------------------------------------------
-- A cap, in the database, for the same reason saved searches have one.
--
-- Two hundred is a shortlist an order of magnitude over. What it stops is the
-- other thing this table could be used for: walking the directory into a
-- private copy of it, one insert at a time.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_saved_agent_cap()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (select count(*) from saved_agents where company_id = new.company_id) >= 200 then
    raise exception 'saved_agent_cap'
      using hint = 'Remove someone from the shortlist first.';
  end if;
  return new;
end;
$$;

revoke execute on function public.enforce_saved_agent_cap() from public, anon, authenticated;

drop trigger if exists saved_agents_enforce_cap on saved_agents;
create trigger saved_agents_enforce_cap
  before insert on saved_agents
  for each row execute function public.enforce_saved_agent_cap();

-- ---------------------------------------------------------------------------
-- "Is this card open to me, right now?"
--
-- The same disjunction get_agent_card() uses to decide `is_unlocked`, minus
-- the owner: a consultant reading their own card is not a company saving one.
-- Written once, here, so the insert policy and the reader cannot drift apart
-- — the pair of them is the privacy rule, and a rule enforced in two places
-- is a rule enforced in whichever of them is wrong.
--
-- SECURITY DEFINER for the reason applied_to_my_job() is: the answer must not
-- depend on the caller being able to read agent_profiles through RLS, which is
-- the very thing it is deciding.
-- ---------------------------------------------------------------------------

create or replace function public.agent_card_is_open(p_agent uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from agent_profiles a
      join profiles p on p.id = a.user_id
     where a.id = p_agent
       and p.role = 'candidate'
       and a.visibility <> 'hidden'
       and (
         a.visibility = 'public'
         or public.viewer_has_verified_company()
         or public.is_admin()
         or public.applied_to_my_job(a.user_id)
       )
  );
$$;

/*
  `from public, anon` and not just `from public`.

  Supabase grants EXECUTE on every new function in this schema to anon,
  authenticated and service_role through default privileges, as the function is
  created — an explicit grant to the anon role, not a grant to PUBLIC. So
  `revoke ... from public` removes a grant that was never what held the door
  open, and the function stays callable over the anonymous API while the
  migration reads as though it had been closed.

  Not a leak here — a stranger gets `visibility = 'public'`, which is the same
  bit the directory shows them — but this one is a predicate, and the answer a
  predicate gives is only as narrow as the next edit to it. Unlike the
  predicates migration 43 had to leave open to anon, nothing anonymous
  evaluates this: it appears in one INSERT policy, on a table anon can never
  satisfy the first conjunct of.
*/
revoke execute on function public.agent_card_is_open(uuid) from public, anon;
grant  execute on function public.agent_card_is_open(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Row-level security: the pool belongs to the team, like the inbox.
-- ---------------------------------------------------------------------------

alter table saved_agents enable row level security;

create policy saved_agents_member_select on saved_agents
  for select using (public.owns_company(company_id));

create policy saved_agents_member_insert on saved_agents
  for insert with check (
    public.owns_company(company_id)
    -- Nobody saves on somebody else's behalf. The column is an attribution,
    -- and an attribution the writer chooses is not one.
    and saved_by = (select auth.uid())
    and public.agent_card_is_open(agent_id)
  );

create policy saved_agents_member_delete on saved_agents
  for delete using (public.owns_company(company_id));

-- No update policy, deliberately. Every column is either the identity of the
-- row or a record of when and by whom it was made; there is nothing here that
-- changing would mean anything except rewriting history.

-- ---------------------------------------------------------------------------
-- The reader. Visibility is re-derived here, every time.
-- ---------------------------------------------------------------------------

create or replace function public.saved_agent_cards(
  p_limit  int default 50,
  p_offset int default 0
)
returns table (
  id               uuid,
  slug             text,
  is_listed        boolean,
  is_unlocked      boolean,
  full_name        text,
  avatar_url       text,
  headline_ar      text,
  headline_en      text,
  years_experience int,
  tracks           job_track[],
  district_ids     int[],
  languages        text[],
  availability     agent_availability,
  saved_at         timestamptz,
  saved_by_name    text,
  total_count      bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with viewer as (
    -- Null for anyone who is not in a company, which makes the join below
    -- match nothing. The function guards itself rather than trusting a caller
    -- to have checked.
    select public.my_company_id() as company,
           (public.viewer_has_verified_company() or public.is_admin()) as unlocked
  ),
  cards as (
    select
      s.agent_id,
      s.created_at,
      a.slug,
      a.headline_ar,
      a.headline_en,
      a.years_experience,
      a.tracks,
      a.district_ids,
      a.languages,
      a.availability,
      p.full_name,
      p.avatar_url,
      sb.full_name as saved_by_name,
      (a.visibility <> 'hidden' and p.role = 'candidate')                      as listed,
      (a.visibility = 'public' or v.unlocked or public.applied_to_my_job(a.user_id)) as open
    from saved_agents s
    join agent_profiles a on a.id = s.agent_id
    join profiles p       on p.id = a.user_id
    cross join viewer v
    left join profiles sb on sb.id = s.saved_by
    where s.company_id = v.company
  )
  select
    c.agent_id                                                     as id,
    case when c.listed then c.slug             end                 as slug,
    c.listed                                                       as is_listed,
    (c.listed and c.open)                                          as is_unlocked,
    case when c.listed and c.open then c.full_name  end            as full_name,
    case when c.listed and c.open then c.avatar_url end            as avatar_url,
    case when c.listed then c.headline_ar      end                 as headline_ar,
    case when c.listed then c.headline_en      end                 as headline_en,
    case when c.listed then c.years_experience end                 as years_experience,
    case when c.listed then c.tracks           end                 as tracks,
    case when c.listed then c.district_ids     end                 as district_ids,
    case when c.listed then c.languages        end                 as languages,
    case when c.listed then c.availability     end                 as availability,
    c.created_at                                                   as saved_at,
    c.saved_by_name,
    count(*) over ()                                               as total_count
  from cards c
  -- The last key cannot tie, so the order is total and page two does not
  -- repeat a row from page one.
  order by c.created_at desc, c.agent_id
  limit greatest(1, least(p_limit, 100)) offset greatest(0, p_offset);
$$;

-- Likewise, and here it is the whole point: this reads one company's private
-- shortlist. It answers a stranger with nothing, because my_company_id() is
-- null for them — but "returns nothing" is not the same as "cannot be called".
revoke execute on function public.saved_agent_cards(int, int) from public, anon;
grant  execute on function public.saved_agent_cards(int, int) to authenticated, service_role;
