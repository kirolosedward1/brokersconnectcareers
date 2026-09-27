# Marketplace taxonomy — audit and design

Status: **audit and design only. No migration or application code yet.**
Written 2026-09-27 against `main` at ca3791a. Read this before building.

## What already exists

Two pieces of related work landed or went live the same day. The build has to
sit on top of both rather than beside them:

- **`main` — search (migration 068, `search_that_reads_the_listing_the_way_people_do`).**
  `job_search_documents` holds one weighted tsvector per public listing: title
  (A), track + district + governorate with their aliases (B), company +
  tagged developers (C), description (D). Kept current by triggers, including
  renames of districts, governorates and developers. It is a separate table on
  purpose, because rewriting a column on `jobs` would bump `version` and tell
  employers with the listing open that someone else had saved it.
  `search_aliases` holds extra names for a district, governorate or track,
  keyed by foreign key, seeded in `seed.sql`. **Not yet applied to
  production**; the board's query falls back to the old search when the table
  is missing.
- **Branch `moderation-safety` — the admin console (migrations 068–072 there).**
  These are applied to production but **not merged to `main`**. They include
  `/admin/taxonomy` (add, rename, and delete-when-unused for districts,
  governorates and developers) and audited RPCs
  (`admin_save_taxonomy`, `admin_delete_taxonomy`, `admin_taxonomy_usage`). It
  also adds `guard_taxonomy_change()`: slugs are permanent, and a row in use
  cannot be deleted, including a district that only an
  `agent_profiles.district_ids` array names.
  Its migration numbers collide with `main`'s 068, so it must be rebased and
  renumbered before anything here is built on it.

## Audit — where each vocabulary lives

| Vocabulary | Identity | Labels | Order | Copies found in code |
|---|---|---|---|---|
| Governorates | `governorates.id` + `slug` | `name_ar/en` | id | — |
| Districts | `districts.id` + `slug` | `name_ar/en` | id | footer `FEATURED_DISTRICTS` (slugs) |
| Developers | `developers.id` + `slug` | `name_ar/en` | `name_en` | — |
| Tracks (job categories = consultant specialisations) | enum `job_track` | `messages/*.json` `track.*` | `JOB_TRACKS` | `TRACK_SLUGS` URL map; ~20 components iterate `JOB_TRACKS` |
| Company types | text + check (067) | messages + `*_jobs` phrasings | `COMPANY_TYPES` | filters, browse |
| Experience bands | enum | messages (labels state the years) | `EXPERIENCE_BANDS` | year ranges repeated in `match.ts` `bandFor`, `seo/job-posting.ts`, `agent-filters.tsx` |
| Lead sources | enum | messages + `*_short` | `LEADS_SOURCES` | `compensation.tsx` branches on a value |
| Employment types | enum | messages | `EMPLOYMENT_TYPES` | schema.org map in `seo/job-posting.ts` |

Findings:
- Slugs and enum keys are stored in `saved_searches.query` (`district=`,
  `gov=`, `track=`), in landing URLs `/jobs/<track-slug>-<district-slug>`, and
  in analytics event values. They must never change; only labels may.
- Deleting a district or governorate referenced only by a saved search is
  still allowed and silently empties that search. This is the failure
  migration 59 describes for company slugs.
- Track labels exist only in JSON, so SQL cannot index them. The search
  document gets a track's words only from `search_aliases`.
- Nothing can be retired. There is no active flag, so "stop offering this for
  new listings" can only be done by deleting, and deleting is refused once the
  value is used.
- Seed data holds both «مدينة مصر» (Madinet Masr) and «مدينة نصر للإسكان»
  (MNHD), probably one company after a rebrand. The owner should confirm. The
  fix is an alias plus deactivating one, not a delete.
- Analytics already sends keys and slugs only, never labels.

## Decision — three tiers

1. **Reference data, owned by admins:** governorates, districts, developers.
   Admins can create, rename, reorder (governorates and districts; developers
   stay alphabetical), activate/deactivate, and manage aliases. Delete only
   when nothing references the row, saved searches included.
2. **Categories, curated by admins but keyed in code:** tracks. A new table
   `job_tracks (key job_track primary key, label_ar, label_en, sort_order,
   is_active, updated_at)`, seeded from today's message labels. Admins can
   rename, reorder, activate/deactivate and manage aliases. There is no create
   or delete, because a new track needs an enum value, a URL slug and code.
3. **Vocabularies that carry rules, owned by code:** company types, experience
   bands, lead sources, employment types (and commission types, benefits,
   availability, headcount, report reasons). They stay in one registry
   (`src/lib/taxonomy.ts`) alongside the enum/check and the messages, with a
   test that all three agree. The duplicated year ranges and the schema.org
   map move into the registry.

## Rules

- **Canonical id:** the integer id for rows, the enum key for tracks. The slug
  or key is the public identifier and is permanent. Labels are never identity.
- **Inactive** means the value is not offered for new selections: job form,
  company form, onboarding, agent profile, CV editor, filters, footer, sitemap
  landing pages, landing sibling links and home browse. Existing records keep
  and show it. URLs and saved searches still resolve. A selected inactive
  filter still renders so it can be removed. Landing pages of inactive values
  are `noindex, follow`. A district counts as active only when it and its
  governorate are both active.
- **A database trigger refuses newly attaching an inactive value.** This
  covers `jobs.district_id` and `track`, `companies.district_id`, new elements
  of `agent_profiles.district_ids` and `tracks`, and `job_developers` and
  `agent_developers` inserts. History (`agent_experience`) is exempt, and
  admins and the service role bypass it. The error word is
  `taxonomy_inactive`, mapped to a message in the four save actions.
- **Aliases are rows in `search_aliases`** (main's table). There is no second
  aliases column. The console manages them per term. An alias or new name
  that matches another term's name or alias after `ar_normalise` and
  `ar_strip_al` is refused (`alias_taken` / `name_taken`), so an alias cannot
  become a duplicate entity. Renaming offers "keep the old name as an alias",
  on by default. Developers have no alias target today; adding
  `developer_id` to `search_aliases` is optional.

## Search

Built on `job_search_documents`, with no new mechanism:
- `refresh_job_search()` adds `job_tracks.label_ar/en` at weight B, so a
  renamed category is found by its new name. A trigger on label changes in
  `job_tracks` refreshes that track's listings, like the existing district
  triggers do.
- Inactive values stay indexed. Their listings are still live and must stay
  findable.

## Planned migration (number chosen after `moderation-safety` is renumbered onto `main`)

- `sort_order`, `is_active` and `updated_at` on the three tables. The initial
  order is today's id order, spaced by 10.
- `job_tracks`, seeded; readable by everyone, writable only through RPCs.
- Unique indexes on normalised names: per governorate for districts, global
  for the others.
- A restated `guard_taxonomy_change()` that also counts saved searches
  (`(^|&)district=<slug>(&|$)`, `gov=`, `track=`), and a
  `guard_job_track_change()` (key permanent, no delete).
- The trigger that refuses inactive values.
- `refresh_job_search()` restated to include `job_tracks` labels.
- RPCs `admin_save_track`, `admin_set_taxonomy_active`,
  `admin_reorder_taxonomy`, `admin_save_alias`/`admin_delete_alias` and
  `admin_taxonomy_stats` (uses plus live listings). All are definer functions
  that go through `admin_begin()` and `admin_audit()`, and anon's grant is
  revoked explicitly (see the Supabase grant trap).
- Backward compatible with the code on `main`.

## Planned code

- `queries/taxonomy.ts` loaders select `*` and sort in JS, so they keep
  working if the migration is not there yet. Helpers return active values plus
  whatever is currently selected. `getTracks()` falls back to the code
  registry.
- `src/i18n/request.ts` overlays the DB track labels on the `track`
  namespace, with the JSON as fallback. Every existing `t('track.x')` then
  follows a rename.
- Pickers receive ordered, active lists as props.
- Console: a categories tab, an active toggle (a `ConfirmAction` lever),
  reorder buttons, an alias editor, usage and live-listing counts.
- Every change calls `revalidateTag('taxonomy')` and
  `revalidatePath('/', 'layout')`.

## Planned tests

New `supabase/tests/taxonomy.test.mjs`:
- A rename keeps job and profile references and slugs.
- Search finds a listing by the new name, by an alias (Arabic and English),
  and by the category label.
- Deactivating blocks new use but not existing records; reactivating
  restores it.
- A delete is blocked by a saved search.
- Reordering works, and audit rows are written.
- `job_tracks` has every enum value.
- anon cannot call the RPCs.

In TypeScript:
- The registry, the messages and the enum agree.
- `bandFor` reads the registry.
- The active-list helpers work, and the label overlay falls back to JSON.

In the browser: board filters, a landing URL unchanged after a rename, and
Arabic. English routes are closed (`ENGLISH_ENABLED = false`), so English is
covered by unit tests.
