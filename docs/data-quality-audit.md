# Data quality — audit and plan (work 17, in progress)

Status: **audit done, design settled, nothing implemented yet.** Branch
`claude/data-quality-17`, worktree `.claude/worktrees/data-quality-17`, cut from
`main` at c8769b0. Baseline `pnpm check` green before any change.

## What production actually holds (read-only, 2026-09-27)

16 profiles, 7 companies, 18 jobs, 8 consultant profiles, 33 applications. They are
almost all seed data, so the values are clean today. The risk lies in how new
input gets in, not in what is already stored.

| Check | Result |
|---|---|
| Phones | 16/16 canonical E.164, all Egyptian mobiles, no two accounts share one |
| Names with double spaces / edge spaces / invisible bidi chars | 0 |
| Agent arrays (tracks, districts, languages) with duplicates or unknown district ids | 0 |
| Salaries of 0 or under 1,000 EGP; 0% or >20% percentage commissions | 0 |
| Freelance-commission-only listings carrying a basic salary | 0 |
| Listing with no basic salary *and* `commission_type = none` | 0 (but nothing forbids it) |
| Applications whose declared band contradicts the candidate's profile years | 20 of 33, mostly from the seed, which hard-codes `junior_1_3`. The one non-seeded application also kept the apply form's `junior_1_3` default against a 0-year profile |
| Consultant profile with 0 years but units closed / work history | 1 (self-reported; not for an admin to fix) |
| Developers taxonomy | `mnhd` (مدينة نصر للإسكان) and `madinet-masr` (مدينة مصر) are very likely one developer (MNHD rebranded as Madinet Masr in 2023). One consultant is tagged with both. **Ambiguous; for the owner to decide, not auto-merged** |
| District 1 | slug `new-cairo`, name_en "New Cairo", name_ar «التجمع الخامس». These are aliases of each other in market usage, not a duplicate. Keep as is |

## Structured vs free text

Already controlled, so leave them: track (`job_track`), employment type,
experience band, lead source, commission type, benefits, languages (ar/en/fr),
company type, headcount band. Locations and developers are FK lookups; users
cannot create them, only admins can.

These are free text and should stay that way: descriptions, requirements,
commission note, headlines, summaries, experience highlights, and degree/field.

The only free-text *identity* field is `agent_experience.company_name`. It is left
free: auto-linking it to `companies` would be a guess.

## Gaps found

1. **Phone**: on main, `normalisePhone` turns `1001234567` into `+1001234567`
   (a "valid" number in no country) and `+20 0100…` into `+2001…`. The DB only
   checks the generic E.164 shape.
2. **Nothing normalises names in the DB**: spacing, invisible RLM/ZWJ, and
   presentation forms pasted from PDFs. That is how "Nile  Brokers" and
   "Nile Brokers" become two things.
3. **Company duplicates**: nothing detects a second employee re-creating their
   company. No review queue exists.
4. **Taxonomy**: names are unique by bytes only (slug unique), so "new cairo" can
   be added beside "New Cairo".
5. **Pay semantics**: `0` and `null` both mean "no basic", a listing can pay
   nothing, freelance-commission-only can carry a salary, 0% percentage is
   allowed, and "8" meaning 8,000 goes through.
6. **Experience**: band edges overlap in the labels. `bandFor` in `src/lib/match.ts`
   resolves them upward; the DB does not document this. The apply form defaults to
   `junior_1_3` for everyone. `years_experience` NOT NULL default 0 conflates "not
   stated" with "under a year" (documented limitation; making it nullable touches
   search ordering and every card, so it is deferred).
7. **Agent `district_ids`**: no check that the ids exist on write (tender-davinci
   guards deletes only).

## Design (decided)

Migration `20260101000120_the_same_thing_written_two_ways.sql`. Numbers 068–110
are taken on other branches.

- `tidy_text(text)`: NFKC; strip U+00AD, U+061C, U+200B–U+200F, U+202A–U+202E,
  U+2060, U+2066–U+2069, U+FEFF; collapse every whitespace kind; trim. Use `\u`
  escapes in regexes, not literal invisibles.
- `name_key(text)`: `tidy_text`, ASCII-only lowercase via `translate` (so it does
  not depend on locale), fold harakat/tatweel, أإآٱ→ا, ى/ی→ي, ة→ه, ؤ→و, ئ→ي,
  ک→ك, and both Arabic digit sets. Keep only `[a-z0-9ء-ي]`. Self-contained, so it
  does not depend on `ar_normalise` (the search branch changes that).
- `company_core_key(text)`: `name_key`, drop ال/لل/وال, al/el, legal forms,
  generic real-estate words in both scripts, and 1-letter tokens. Compare only
  when ≥3 chars. Used **only** to flag, never to block.
- `normalise_phone(text)`: exact mirror of the **prod-ready branch's**
  `src/lib/phone.ts`. Apply those same edits to phone.ts verbatim so the merge is
  clean, then add `formatPhone()` for display. Parity-test TS against SQL.
- BEFORE triggers `<table>_05_normalise`, which sort before the `_10_` guards:
  profiles (name, phone), companies (names), jobs (titles, 0→null salary, dedupe
  benefits), agent_profiles (headlines, dedupe arrays; *new* district ids must
  exist), the CV tables, and governorates/districts/developers.
- Constraints: add NOT VALID, then VALIDATE only when no violators remain;
  violators go to review.
  - Egyptian phones must be `^\+201\d{9}$`.
  - Basic salary ≥ 1000 when stated.
  - Percentage > 0.
  - A listing pays something (basic or commission type ≠ none).
  - Freelance-commission-only has no basic.
- Taxonomy: unique `name_key` indexes (districts per governorate). If duplicates
  already exist, log them and skip the index.
- `data_review_items`: kinds company/developer/taxonomy duplicate and
  value_needs_review. FK columns cascade, `subject_key` is unique, admin-read-only
  RLS, writes only via definer functions. Plus
  `resolve_data_review(id, status, note)` and optionally
  `merge_developers(keep, drop)`.
- `data_quality_changes` log; `data_quality_preview()` / `data_quality_apply()`,
  admin/service only and revoked from anon. The migration runs apply, flags
  existing company pairs, and opens the MNHD/Madinet Masr item by slug.
- `company_name_matches` / `find_similar_companies(name_ar, name_en)`: a
  non-blocking warning under the company-name field (onboarding + company form),
  same philosophy as `findSimilarListing`. An AFTER trigger on companies flags
  pairs for admin review. **No automatic merges.**
- App: `src/lib/compensation.ts` (pure rules shared by zod + tests) with messages
  `salaryTooLow`, `commissionZero`, `noPay`, `commissionOnlyHasNoBasic`; job-form
  shows the specific key. Languages `z.enum`. Apply form preselects
  `bandFor(years)` only when years > 0, otherwise forces a choice. Admin page
  `/admin/data` plus nav badge; new actions in `src/lib/actions/data-quality.ts`
  (a new file, to avoid merge conflicts).
- Tests: `supabase/tests/quality.test.mjs`, which applies migrations up to 067,
  inserts dirty rows, then applies 120 and asserts changes, review items and
  constraints. Needs a small `until` option in `setup.mjs`. Also
  `scripts/data-quality.test.mjs`. **Update** the schema.test check "a
  local-format number is rejected": it is now normalised to E.164, so assert the
  stored value inside a rolled-back transaction.

## Overlaps with parallel branches (check before merging)

- `fervent-volta` (search) adds `search_aliases` (districts, governorates,
  tracks, seeded with القاهرة الجديدة etc.) and rewrites `ar_normalise`. Location
  **aliases come from there**; do not create a second alias table.
- `brokers-connect-prod-ready` rewrites `src/lib/phone.ts`; mirror it exactly.
- `blissful-wright` adds app-level `clean()`; the DB triggers complement it. It
  also renumbers its migrations to 100–110.
- `tender-davinci` adds `guard_taxonomy_change` (in-use delete guard,
  permanent slugs) and an admin taxonomy page. It is already applied on
  production along with 4 other unmerged migrations.
- Another session is using the main checkout (branch `support-experience`), so
  work only in this worktree.

Production apply and commit/push were **not** done and need the owner's go-ahead.
