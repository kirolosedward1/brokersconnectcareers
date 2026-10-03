#!/usr/bin/env node
/**
 * Migration safety: one tool, four questions.
 *
 *   pnpm db:lint                is every migration this branch adds safe to ship?
 *   pnpm db:new <what_it_does>  the next free number, with the header filled in
 *   pnpm db:ledger              does a database's applied history match main?
 *   pnpm db:apply               bring a database's history up to this checkout
 *                               (dry run unless --execute; see apply() below)
 *
 * Why it exists. On 2026-09-27 eight branches each carried a migration numbered
 * 068, and five migrations from two of them were applied to production before
 * either was merged — so production ran a schema that no commit on main could
 * build, with two overlapping audit designs in it. Nothing refused any step of
 * that. Code reverts cannot undo a schema, so this is the part of a release
 * that has to be right before it happens rather than after.
 *
 * `lint` runs in CI on every pull request and every push to main. It refuses:
 *
 *   - a file that is not `<14-digit version>_<snake_case>.sql`, including the
 *     ` 2.sql` copies iCloud writes beside originals in this repository;
 *   - two files with one version, anywhere in the directory;
 *   - an edit to, or deletion of, a migration that main already has — it may
 *     already be applied, and the file must keep saying what production ran;
 *   - a new migration numbered at or below the newest one on main, which is
 *     how the second of two parallel branches learns it must renumber;
 *   - a new migration with no `-- rollback:` line;
 *   - a new migration containing an operation that can lose data, lock or
 *     rewrite a table, break the code already running, or change who can read
 *     what — unless the file says so in a `-- safety:` line with a reason.
 *
 * The acknowledgement is the review. It puts one sentence in the diff, next to
 * the dangerous statement, that a reviewer has to read and agree with:
 *
 *   -- safety: rls — employers may now read notes on their own listings only
 *   -- safety: constraint, ships-with-code — no row violates it (checked on
 *   --   production 2026-09-27); the form already sends the column
 *   -- rollback: alter table jobs drop constraint jobs_title_length;
 *
 * Rules that need a `-- safety:` line (block) and what they catch:
 *
 *   drop             drop table/column/schema/type/view/function/trigger that
 *                    is not re-created in the same file; truncate; delete
 *                    without a where; a trigger switched off
 *   rewrite          update without a where; alter column … type; a volatile
 *                    column default; vacuum full; cluster
 *   constraint       add/drop constraint, set not null, not null column with
 *                    no default, unique index — on a table that already exists
 *   rls              enable/disable row level security, create/alter/drop
 *                    policy — on a table that already exists
 *   grant            grant … to anon or public
 *   revoke-anon      revoke … from public that leaves anon's own grant intact
 *                    (on Supabase anon is granted EXECUTE explicitly)
 *   rename           rename or move a table, column, type or function
 *   definer          security definer function without a search_path
 *   ships-with-code  the branch also changes src/: the migration and the code
 *                    that needs it reach production in some order, and the
 *                    line has to say why either order is safe
 *
 * Findings listed for the reviewer without blocking: replaced functions,
 * triggers and views, backfills, new triggers on existing tables, blocking
 * index builds, enum values, extensions, definer functions, dynamic SQL.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = 'supabase/migrations';
const NAME = /^(\d{14})_([a-z0-9_]+)\.sql$/;
const PRODUCTION_REF = process.env.PRODUCTION_SUPABASE_REF || 'hiwdhicwsohbipxzazmb';

const BLOCK = 'block';
const REVIEW = 'review';

// ---------------------------------------------------------------------------
// git
// ---------------------------------------------------------------------------

function git(...args) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

function tryGit(...args) {
  try {
    return git(...args);
  } catch {
    return null;
  }
}

/** Migration file names present at a commit. */
function filesAt(ref) {
  const out = tryGit('ls-tree', '--name-only', ref, `${DIR}/`);
  if (out === null) throw new Error(`cannot read ${DIR} at ${ref} — is it fetched?`);
  return new Set(
    out
      .split('\n')
      .filter(Boolean)
      .map((path) => path.slice(DIR.length + 1)),
  );
}

/** Blob ids, so "unchanged" means byte-identical rather than similar. */
function blobAt(ref, file) {
  return tryGit('rev-parse', `${ref}:${DIR}/${file}`);
}

function blobLocal(file) {
  return git('hash-object', `${DIR}/${file}`);
}

function readLocal(file) {
  return readFileSync(join(ROOT, DIR, file), 'utf8');
}

function localFiles() {
  return readdirSync(join(ROOT, DIR))
    .filter((file) => !file.startsWith('.'))
    .sort();
}

const version = (file) => NAME.exec(file)?.[1] ?? null;
const namePart = (file) => NAME.exec(file)?.[2] ?? null;

// ---------------------------------------------------------------------------
// SQL scanning
// ---------------------------------------------------------------------------

/**
 * Splits a migration into the statements that run when it is applied.
 *
 * Comments and string literals are blanked, and the dollar-quoted body of a
 * function is set aside: an `update jobs set …` inside a trigger function runs
 * when a row changes, not when the migration does, and flagging it would make
 * every finding noise. DO blocks are the exception — their bodies run at
 * migration time — so those bodies are returned for scanning as SQL too.
 *
 * Line numbers survive the blanking, so a finding points at the statement.
 */
export function splitStatements(sql) {
  const statements = [];
  let text = '';
  let bodies = [];
  let line = 1;
  let start = 1;
  let i = 0;

  const push = (chunk) => {
    if (!text.trim() && chunk.trim()) start = line;
    text += chunk;
  };

  while (i < sql.length) {
    const c = sql[i];
    const d = sql[i + 1];

    if (c === '-' && d === '-') {
      while (i < sql.length && sql[i] !== '\n') i += 1;
      continue;
    }

    if (c === '/' && d === '*') {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth) {
        if (sql[i] === '/' && sql[i + 1] === '*') {
          depth += 1;
          i += 2;
        } else if (sql[i] === '*' && sql[i + 1] === '/') {
          depth -= 1;
          i += 2;
        } else {
          if (sql[i] === '\n') {
            line += 1;
            text += '\n';
          }
          i += 1;
        }
      }
      text += ' ';
      continue;
    }

    if (c === "'") {
      // E'…' honours backslash escapes; a plain literal only doubles quotes.
      const escapes = /(^|[^a-z0-9_])e$/i.test(text);
      i += 1;
      while (i < sql.length) {
        if (escapes && sql[i] === '\\') {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            i += 2;
            continue;
          }
          break;
        }
        if (sql[i] === '\n') {
          line += 1;
          text += '\n';
        }
        i += 1;
      }
      i += 1;
      push("''");
      continue;
    }

    if (c === '$' && !/[a-z0-9_$]$/i.test(text)) {
      const tag = /^\$(?:[a-z_][a-z0-9_]*)?\$/i.exec(sql.slice(i, i + 64))?.[0];
      if (tag) {
        const end = sql.indexOf(tag, i + tag.length);
        const body = sql.slice(i + tag.length, end === -1 ? sql.length : end);
        bodies.push({ body, line });
        push(' $body$ ');
        for (const ch of body) {
          if (ch === '\n') {
            line += 1;
            text += '\n';
          }
        }
        i = end === -1 ? sql.length : end + tag.length;
        continue;
      }
    }

    if (c === ';') {
      if (text.trim()) statements.push({ text, line: start, bodies });
      text = '';
      bodies = [];
      i += 1;
      continue;
    }

    if (c === '\n') line += 1;
    push(c);
    i += 1;
  }

  if (text.trim()) statements.push({ text, line: start, bodies });
  return statements;
}

const normalize = (text) => text.replace(/\s+/g, ' ').trim().toLowerCase();

/** `public."Jobs"` and `jobs` are the same table to a reviewer. */
const bare = (name) => name.replace(/"/g, '').replace(/^public\./, '');

const IDENT = String.raw`((?:"[^"]+"|[a-z_][a-z0-9_$]*)(?:\.(?:"[^"]+"|[a-z_][a-z0-9_$]*))?)`;

/** Splits `a, b(c, d), e` on the commas that are not inside parentheses. */
function topLevelList(text) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

// Defaults that force a table rewrite when a column is added: Postgres can
// store a constant default in the catalogue, but a volatile one has to be
// computed for every existing row.
const VOLATILE_DEFAULT = /\bdefault\b.*\b(gen_random_uuid|uuid_generate_v[14]|random|clock_timestamp|timeofday|nextval)\s*\(/;

/**
 * Everything a single file does that a reviewer should know about.
 *
 * `created` is filled first, so that a policy on a table the same file creates
 * is recognised as part of a new table rather than a change to an old one, and
 * a function dropped and re-created is a replacement rather than a removal.
 */
export function analyse(sql) {
  const statements = splitStatements(sql);
  const created = {
    tables: new Set(),
    functions: new Set(),
    triggers: new Set(),
    policies: new Set(),
    views: new Set(),
  };

  const all = [];
  const collect = (list, fromDo = false) => {
    for (const statement of list) {
      all.push({ ...statement, s: normalize(statement.text), fromDo });
      if (/^do\b/.test(normalize(statement.text))) {
        for (const { body, line } of statement.bodies) {
          const inner = splitStatements(body).map((st) => ({ ...st, line: st.line + line - 1 }));
          collect(inner, true);
        }
      }
    }
  };
  collect(statements);

  for (const { s } of all) {
    let m;
    if ((m = new RegExp(`^create (?:(?:global |local )?(?:temp|temporary|unlogged) )?table (?:if not exists )?${IDENT}`).exec(s)))
      created.tables.add(bare(m[1]));
    if ((m = new RegExp(`^create (?:or replace )?(?:function|procedure) ${IDENT}\\s*\\(`).exec(s)))
      created.functions.add(bare(m[1]));
    if ((m = new RegExp(`^create (?:or replace )?(?:constraint )?trigger ${IDENT} .*? on ${IDENT}`).exec(s)))
      created.triggers.add(`${bare(m[1])}@${bare(m[2])}`);
    if ((m = new RegExp(`^create policy ${IDENT} on ${IDENT}`).exec(s)))
      created.policies.add(`${bare(m[1])}@${bare(m[2])}`);
    if ((m = new RegExp(`^create (?:or replace )?(?:materialized )?view (?:if not exists )?${IDENT}`).exec(s)))
      created.views.add(bare(m[1]));
  }

  const findings = [];
  const add = (level, rule, line, message) => findings.push({ level, rule, line, message });
  const isNew = (table) => created.tables.has(bare(table));

  for (const { s, line, fromDo } of all) {
    let m;

    if (fromDo && /\bexecute\b/.test(s)) {
      add(REVIEW, 'dynamic', line, 'DO block builds SQL at run time — read it by hand');
    }

    // --- drops ------------------------------------------------------------
    if ((m = /^drop (table|schema|type|extension|sequence|domain|aggregate|operator|cast|rule) (?:if exists )?(.*)$/.exec(s))) {
      const [, kind, rest] = m;
      const names = topLevelList(rest.replace(/ (cascade|restrict)$/, '')).map(bare);
      if (kind === 'table' && names.every((name) => isNew(name))) {
        add(REVIEW, 'replace', line, `drops table ${names.join(', ')} created in this same file`);
      } else {
        add(BLOCK, 'drop', line, `drops ${kind} ${names.join(', ')}${/ cascade$/.test(s) ? ' with CASCADE' : ''}`);
      }
      continue;
    }
    if ((m = /^drop (materialized view|view) (?:if exists )?(.*)$/.exec(s))) {
      const names = topLevelList(m[2].replace(/ (cascade|restrict)$/, '')).map(bare);
      const recreated = names.every((name) => created.views.has(name));
      add(recreated ? REVIEW : BLOCK, recreated ? 'replace' : 'drop', line, `${recreated ? 'replaces' : 'drops'} ${m[1]} ${names.join(', ')}`);
      continue;
    }
    if ((m = /^drop (?:function|procedure) (?:if exists )?(.*)$/.exec(s))) {
      const names = topLevelList(m[1].replace(/ (cascade|restrict)$/, '')).map((part) => bare(part.replace(/\s*\(.*$/, '')));
      const recreated = names.every((name) => created.functions.has(name));
      add(
        recreated ? REVIEW : BLOCK,
        recreated ? 'replace' : 'drop',
        line,
        recreated
          ? `re-creates function ${names.join(', ')} (signature may change — callers must match)`
          : `drops function ${names.join(', ')} — code still calling it will error`,
      );
      continue;
    }
    if ((m = new RegExp(`^drop trigger (?:if exists )?${IDENT} on ${IDENT}`).exec(s))) {
      const key = `${bare(m[1])}@${bare(m[2])}`;
      if (!created.triggers.has(key)) {
        add(BLOCK, 'drop', line, `drops trigger ${bare(m[1])} on ${bare(m[2])} — a rule the table enforced stops`);
      }
      continue;
    }
    if ((m = new RegExp(`^drop policy (?:if exists )?${IDENT} on ${IDENT}`).exec(s))) {
      const [, policy, table] = m;
      const recreated = created.policies.has(`${bare(policy)}@${bare(table)}`);
      if (!isNew(table)) {
        add(BLOCK, 'rls', line, `${recreated ? 'rewrites' : 'removes'} policy ${bare(policy)} on ${bare(table)}`);
      }
      continue;
    }
    if (/^drop index\b/.test(s)) {
      add(REVIEW, 'index', line, `drops an index: ${s.slice(11, 90)}`);
      continue;
    }
    if (/^truncate\b/.test(s)) {
      add(BLOCK, 'drop', line, `truncates ${s.slice(9, 80)} — every row goes`);
      continue;
    }

    // --- data ---------------------------------------------------------------
    if ((m = new RegExp(`(?:^|\\) )delete from (?:only )?${IDENT}`).exec(s))) {
      if (/\bwhere\b/.test(s.slice(m.index))) add(REVIEW, 'data', line, `deletes rows from ${bare(m[1])}`);
      else add(BLOCK, 'drop', line, `deletes every row of ${bare(m[1])}`);
      continue;
    }
    if ((m = new RegExp(`(?:^|\\) )update (?:only )?${IDENT}(?: (?:as )?[a-z_]+)? set\\b`).exec(s))) {
      if (/\bwhere\b/.test(s.slice(m.index))) add(REVIEW, 'data', line, `backfills rows of ${bare(m[1])}`);
      else add(BLOCK, 'rewrite', line, `rewrites every row of ${bare(m[1])} (no where clause)`);
      continue;
    }
    if (/^vacuum full\b|^cluster\b/.test(s)) {
      add(BLOCK, 'rewrite', line, `${s.split(' ').slice(0, 2).join(' ')} rewrites a table under an exclusive lock`);
      continue;
    }
    if (/^refresh materialized view (?!concurrently)/.test(s)) {
      add(REVIEW, 'index', line, 'refreshes a materialized view under an exclusive lock');
      continue;
    }

    // --- alter table --------------------------------------------------------
    if ((m = new RegExp(`^alter table (?:if exists )?(?:only )?${IDENT} (.*)$`).exec(s))) {
      const table = bare(m[1]);
      const fresh = isNew(table);
      for (const action of topLevelList(m[2])) {
        let a;
        if (/^rename\b/.test(action) || /^set (schema|tablespace)\b/.test(action)) {
          add(BLOCK, 'rename', line, `${table}: ${action.slice(0, 80)} — code using the old name breaks`);
        } else if (/^drop constraint\b/.test(action)) {
          if (!fresh) add(BLOCK, 'constraint', line, `${table}: ${action.slice(0, 90)}`);
        } else if ((a = /^drop (?:column )?(?:if exists )?("[^"]+"|[a-z_][a-z0-9_]*)/.exec(action))) {
          add(BLOCK, 'drop', line, `${table}: drops column ${bare(a[1])} and its data`);
        } else if (/^add (?:constraint\b|primary key\b|unique\b|check\b|foreign key\b|exclude\b)/.test(action)) {
          if (!fresh) {
            const deferred = /\bnot valid\b/.test(action) ? ' (not valid: existing rows are not checked yet)' : ' — every existing row is checked under lock';
            add(BLOCK, 'constraint', line, `${table}: ${action.slice(0, 70)}${deferred}`);
          }
        } else if ((a = /^add (?:column )?(?:if not exists )?("[^"]+"|[a-z_][a-z0-9_]*) (.*)$/.exec(action))) {
          if (fresh) continue;
          const [, column, definition] = a;
          if (/\bnot null\b/.test(definition) && !/\bdefault\b/.test(definition) && !/\bgenerated\b/.test(definition)) {
            add(BLOCK, 'constraint', line, `${table}: adds ${bare(column)} not null with no default — fails if the table has rows`);
          }
          if (VOLATILE_DEFAULT.test(definition)) {
            add(BLOCK, 'rewrite', line, `${table}: ${bare(column)} has a volatile default — every existing row is rewritten`);
          }
        } else if ((a = /^alter (?:column )?("[^"]+"|[a-z_][a-z0-9_]*) (?:set data )?type\b/.exec(action))) {
          if (!fresh) add(BLOCK, 'rewrite', line, `${table}: changes the type of ${bare(a[1])} — table rewrite under lock, and readers see the new type`);
        } else if ((a = /^alter (?:column )?("[^"]+"|[a-z_][a-z0-9_]*) set not null\b/.exec(action))) {
          if (!fresh) add(BLOCK, 'constraint', line, `${table}: ${bare(a[1])} set not null — fails on any null, scans under lock`);
        } else if ((a = /^alter (?:column )?("[^"]+"|[a-z_][a-z0-9_]*) drop not null\b/.exec(action))) {
          if (!fresh) add(REVIEW, 'constraint', line, `${table}: ${bare(a[1])} may now be null — readers must cope`);
        } else if (/^validate constraint\b/.test(action)) {
          add(REVIEW, 'constraint', line, `${table}: ${action}`);
        } else if (/^disable row level security\b/.test(action) || /^no force row level security\b/.test(action)) {
          add(BLOCK, 'rls', line, `${table}: ${action} — every row becomes reachable through the API`);
        } else if (/^(enable|force) row level security\b/.test(action)) {
          if (!fresh) add(BLOCK, 'rls', line, `${table}: ${action} — only rows a policy allows stay visible`);
        } else if (/^disable (?:always |replica )?trigger\b/.test(action)) {
          add(BLOCK, 'drop', line, `${table}: ${action} — the rule it enforces stops`);
        }
      }
      continue;
    }

    // --- indexes ------------------------------------------------------------
    if ((m = new RegExp(`^create (unique )?index (concurrently )?(?:if not exists )?(?:${IDENT} )?on (?:only )?${IDENT}`).exec(s))) {
      const table = bare(m[4]);
      if (isNew(table)) continue;
      if (m[1]) add(BLOCK, 'constraint', line, `unique index on ${table} — fails if duplicates exist${m[2] ? '' : ', and blocks writes while it builds'}`);
      else if (!m[2]) add(REVIEW, 'index', line, `index on ${table} blocks writes while it builds`);
      continue;
    }

    // --- access -------------------------------------------------------------
    if ((m = new RegExp(`^create policy ${IDENT} on ${IDENT}`).exec(s))) {
      const table = bare(m[2]);
      add(isNew(table) ? REVIEW : BLOCK, 'rls', line, `policy ${bare(m[1])} on ${table}${isNew(table) ? ' (new table)' : ''}`);
      continue;
    }
    if ((m = new RegExp(`^alter policy ${IDENT} on ${IDENT}`).exec(s))) {
      add(BLOCK, 'rls', line, `alters policy ${bare(m[1])} on ${bare(m[2])}`);
      continue;
    }
    if (/^grant\b/.test(s)) {
      const to = / to (.*?)(?: with grant option)?$/.exec(s)?.[1] ?? '';
      const roles = to.split(',').map((role) => role.trim());
      if (roles.includes('anon') || roles.includes('public')) {
        add(BLOCK, 'grant', line, `grants to ${roles.join(', ')}: ${s.slice(6, 80)} — reachable by anyone with the public key`);
      } else if (roles.includes('authenticated')) {
        add(REVIEW, 'grant', line, `grants to authenticated: ${s.slice(6, 80)}`);
      }
      continue;
    }
    if (/^revoke\b/.test(s)) {
      const from = / from (.*?)(?: cascade| restrict)?$/.exec(s)?.[1] ?? '';
      const roles = from.split(',').map((role) => role.trim());
      if (roles.includes('public') && !roles.includes('anon') && /\bfunction\b|\broutine|\bexecute\b/.test(s)) {
        add(BLOCK, 'revoke-anon', line, 'revokes from public only — Supabase granted anon EXECUTE explicitly, so it can still call this');
      }
      continue;
    }

    // --- functions, triggers, types ----------------------------------------
    if ((m = new RegExp(`^create (?:or replace )?(?:function|procedure) ${IDENT}`).exec(s))) {
      if (/\bsecurity definer\b/.test(s)) {
        if (/\bsearch_path\b/.test(s)) add(REVIEW, 'definer', line, `security definer function ${bare(m[1])}`);
        else add(BLOCK, 'definer', line, `security definer function ${bare(m[1])} has no search_path — callers can shadow what it calls`);
      }
      continue;
    }
    if ((m = new RegExp(`^alter (?:function|procedure|routine) ${IDENT}.* rename to\\b`).exec(s))) {
      add(BLOCK, 'rename', line, `renames function ${bare(m[1])}`);
      continue;
    }
    if ((m = new RegExp(`^create (?:or replace )?(?:constraint )?trigger ${IDENT} .*? on ${IDENT}`).exec(s))) {
      if (!isNew(m[2])) add(REVIEW, 'trigger', line, `trigger ${bare(m[1])} on ${bare(m[2])} — can refuse writes the running code makes`);
      continue;
    }
    if ((m = new RegExp(`^alter type ${IDENT} (.*)$`).exec(s))) {
      if (/^add value\b/.test(m[2])) add(REVIEW, 'enum', line, `${bare(m[1])}: ${m[2]} — apply before code that writes it`);
      else if (/^rename\b/.test(m[2])) add(BLOCK, 'rename', line, `${bare(m[1])}: ${m[2]}`);
      continue;
    }
    if ((m = new RegExp(`^alter (?:materialized view|view|sequence) (?:if exists )?${IDENT} (rename|set schema)\\b`).exec(s))) {
      add(BLOCK, 'rename', line, `${bare(m[1])}: ${m[2]}`);
      continue;
    }
    if (/^create extension\b/.test(s)) {
      add(REVIEW, 'extension', line, s.slice(0, 80));
      continue;
    }
  }

  return { findings, statements: all.length };
}

/** `-- safety:` and `-- rollback:` lines. */
export function directives(sql) {
  const safety = [];
  let rollback = null;
  sql.split('\n').forEach((text, index) => {
    const ack = /^\s*--\s*safety:\s*([a-z0-9,\s-]+?)\s*(?:—|–|:|\s-\s)\s*(\S.*)$/i.exec(text);
    if (ack) {
      const rules = ack[1].split(/[\s,]+/).filter(Boolean).map((rule) => rule.toLowerCase());
      safety.push({ rules, reason: ack[2].trim(), line: index + 1 });
    }
    const back = /^\s*--\s*rollback:\s*(\S.*)$/i.exec(text);
    if (back && !rollback) rollback = { text: back[1].trim(), line: index + 1 };
  });
  return { safety, rollback };
}

// ---------------------------------------------------------------------------
// lint
// ---------------------------------------------------------------------------

function changedOutsideMigrations(mergeBase) {
  const tracked = tryGit('diff', '--name-only', mergeBase, '--') ?? '';
  const untracked = tryGit('ls-files', '--others', '--exclude-standard') ?? '';
  return [...new Set([...tracked.split('\n'), ...untracked.split('\n')])]
    .filter(Boolean)
    .filter((path) => /^src\//.test(path) || path === 'vercel.json');
}

/**
 * Files moved to a new version after they reached main, each because two
 * migrations had merged under one version. The rename rule below exists so a
 * file production ran keeps saying what it ran; these are the exceptions,
 * allowed only because no database had applied the old name.
 *
 *   068 → 069  what_the_provider_said_happened: merged the same day as 068's
 *              search migration. Production's ledger carried neither 068 on
 *              2026-09-28, so the later of the two moved to the free 069 and
 *              the application order stayed the same.
 *
 * Frozen like LEGACY: a clash from now on is caught by the version rule
 * before it merges, and is renumbered on its branch.
 */
const RENUMBERED = {
  '20260101000068_what_the_provider_said_happened.sql': '20260101000069_what_the_provider_said_happened.sql',
};

function lint(options) {
  const errors = [];
  const reports = [];

  const files = localFiles();
  for (const file of files) {
    if (!NAME.test(file)) {
      errors.push({
        file,
        message: / \d+\.sql$/.test(file)
          ? 'an iCloud duplicate of another migration — delete it (diff it against the original first)'
          : 'name must be <14-digit version>_<snake_case>.sql',
      });
    }
  }
  const valid = files.filter((file) => NAME.test(file));

  const byVersion = new Map();
  for (const file of valid) byVersion.set(version(file), [...(byVersion.get(version(file)) ?? []), file]);
  for (const [v, list] of byVersion) {
    if (list.length > 1) errors.push({ file: list.join(', '), message: `${list.length} migrations share version ${v}` });
  }

  let added = options.all ? valid : [];
  let codeChanges = [];

  if (options.base) {
    const mergeBase = tryGit('merge-base', 'HEAD', options.base) ?? options.base;
    const atFork = filesAt(mergeBase);
    const atTip = filesAt(options.base);

    for (const file of atFork) {
      if (!files.includes(file)) {
        if (Object.hasOwn(RENUMBERED, file) && files.includes(RENUMBERED[file])) continue;
        errors.push({ file, message: `deleted or renamed, but ${options.base} has it — it may already be applied` });
      } else if (blobAt(mergeBase, file) !== blobLocal(file)) {
        errors.push({ file, message: `edited after it reached ${options.base} — add a new migration instead; this file must keep saying what production ran` });
      }
    }

    // A renumbered file is the same migration the base already has under its
    // old name, not a new one: it is not held to the new-migration rules.
    const moved = new Set(
      Object.entries(RENUMBERED)
        .filter(([from]) => atFork.has(from))
        .map(([, to]) => to),
    );
    const branchAdded = valid.filter((file) => !atFork.has(file) && !moved.has(file));
    if (!options.all) added = branchAdded;

    const tipMax = [...atTip].filter((file) => NAME.test(file)).sort().at(-1);
    for (const file of branchAdded) {
      if (atTip.has(file)) {
        if (blobAt(options.base, file) !== blobLocal(file)) {
          errors.push({ file, message: `${options.base} has a different file by this name` });
        }
        continue;
      }
      const clash = [...atTip].find((other) => version(other) === version(file));
      if (clash) {
        errors.push({ file, message: `version ${version(file)} is already taken on ${options.base} by ${clash} — renumber with \`pnpm db:new\`` });
      } else if (tipMax && version(file) < version(tipMax)) {
        errors.push({ file, message: `sorts before ${tipMax}, already on ${options.base} — a migration has to come after everything merged; renumber with \`pnpm db:new\`` });
      }
    }

    if (branchAdded.length) codeChanges = changedOutsideMigrations(mergeBase);
  }

  const legacy = options.all && !options.base ? new Set() : new Set(valid.filter((file) => !added.includes(file)));

  for (const file of added) {
    const sql = readLocal(file);
    const { findings } = analyse(sql);
    const { safety, rollback } = directives(sql);
    const strict = !legacy.has(file) && !(options.all && !options.base);

    if (strict && codeChanges.length) {
      findings.push({
        level: BLOCK,
        rule: 'ships-with-code',
        line: 1,
        message: `this branch also changes ${codeChanges.slice(0, 3).join(', ')}${codeChanges.length > 3 ? ` and ${codeChanges.length - 3} more` : ''} — say why production is safe whichever lands first`,
      });
    }

    const acknowledged = new Map();
    for (const ack of safety) {
      for (const rule of ack.rules) acknowledged.set(rule, ack);
      if (ack.reason.length < 10) {
        errors.push({ file, line: ack.line, message: `the reason on this safety line is too short to review: "${ack.reason}"` });
      }
    }

    for (const finding of findings) {
      finding.ack = acknowledged.get(finding.rule) ?? null;
      if (strict && finding.level === BLOCK && !finding.ack) {
        errors.push({
          file,
          line: finding.line,
          message: `${finding.rule}: ${finding.message} — add \`-- safety: ${finding.rule} — <why this is safe>\``,
        });
      }
    }

    if (strict && !rollback) {
      errors.push({ file, line: 1, message: 'no `-- rollback:` line — write the SQL that undoes this, or "forward-fix only" and why' });
    }

    reports.push({ file, findings, rollback, strict });
  }

  return { errors, reports, added };
}

function printLint({ errors, reports, added }, options) {
  const out = [];
  const md = [];
  const rel = (file) => `${DIR}/${file}`;

  out.push(`migrations: ${localFiles().length} files, ${added.length} ${options.all ? 'scanned' : 'new on this branch'}${options.base ? ` (base ${options.base})` : ''}`);
  md.push('## Migration safety', '');
  md.push(`${added.length} migration(s) ${options.all ? 'scanned' : 'added on this branch'}${options.base ? ` against \`${options.base}\`` : ''}.`, '');

  if (options.all) {
    const counts = {};
    for (const { findings } of reports) {
      for (const { level, rule } of findings) {
        const key = `${level === BLOCK ? 'block' : 'review'} ${rule}`;
        counts[key] = (counts[key] ?? 0) + 1;
      }
    }
    out.push('', 'inventory:');
    for (const [key, count] of Object.entries(counts).sort()) out.push(`  ${String(count).padStart(4)}  ${key}`);
  }

  for (const { file, findings, rollback, strict } of reports) {
    if (!findings.length && !strict) continue;
    out.push('', rel(file));
    md.push(`### \`${file}\``, '');
    if (rollback) md.push(`Rollback: ${rollback.text}`, '');
    for (const f of findings) {
      const mark = f.level === BLOCK ? (f.ack ? 'ack ' : 'STOP') : '  · ';
      out.push(`  ${mark} ${f.rule.padEnd(15)} L${String(f.line).padEnd(4)} ${f.message}${f.ack ? `\n         └ ${f.ack.reason}` : ''}`);
      md.push(`- ${f.level === BLOCK ? (f.ack ? '✅' : '⛔') : '🔎'} **${f.rule}** (line ${f.line}): ${f.message}${f.ack ? ` — _${f.ack.reason}_` : ''}`);
    }
    if (!findings.length) md.push('- nothing that needs a safety line');
    md.push('');
  }

  if (errors.length) {
    out.push('', `${errors.length} problem(s):`);
    md.push(`### ${errors.length} problem(s) to fix before merging`, '');
    for (const e of errors) {
      out.push(`  ✗ ${e.file}${e.line ? `:${e.line}` : ''} — ${e.message}`);
      md.push(`- \`${e.file}${e.line ? `:${e.line}` : ''}\` — ${e.message}`);
      if (process.env.GITHUB_ACTIONS && NAME.test(e.file)) {
        console.log(`::error file=${rel(e.file)},line=${e.line ?? 1}::${e.message.replace(/\n/g, ' ')}`);
      }
    }
  } else {
    out.push('', 'ok: nothing unacknowledged');
    md.push('No unacknowledged findings.');
  }

  console.log(out.join('\n'));
  const summary = options.summary ?? process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, `${md.join('\n')}\n`);
}

// ---------------------------------------------------------------------------
// new
// ---------------------------------------------------------------------------

/**
 * The next number nobody has used — on this branch, on main, or on any other
 * branch pushed to origin. Numbering against main alone is exactly how eight
 * branches arrived at 068 on the same afternoon; looking at every pushed branch
 * does not make a collision impossible, but it makes it take two people
 * starting within the same minute.
 */
function nextVersion({ fetch }) {
  if (fetch) tryGit('fetch', '--quiet', 'origin');
  const used = new Map();
  const note = (file, where) => {
    const v = version(file);
    if (v) used.set(v, [...(used.get(v) ?? []), where]);
  };
  for (const file of localFiles()) note(file, 'this branch');
  const refs = (tryGit('for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin') ?? '').split('\n').filter((ref) => ref && ref !== 'origin/HEAD' && ref !== 'origin');
  for (const ref of refs) {
    try {
      for (const file of filesAt(ref)) note(file, ref);
    } catch {
      // A branch without a migrations directory has nothing to reserve.
    }
  }
  const highest = [...used.keys()].sort().at(-1) ?? '20260101000000';
  const next = String(Number(highest) + 1).padStart(14, '0');
  return { next, highest, holders: used.get(highest) ?? [] };
}

function create(slugWords, options) {
  const slug = slugWords.join('_').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!slug) {
    console.error('usage: pnpm db:new <what the migration does, in words>');
    process.exit(2);
  }
  const { next, highest, holders } = nextVersion(options);
  const file = `${next}_${slug}.sql`;
  const number = Number(next.slice(-4));
  const title = slug.replace(/_/g, ' ').replace(/^./, (ch) => ch.toUpperCase());

  writeFileSync(
    join(ROOT, DIR, file),
    `-- =============================================================================
-- ${number} — ${title}
--
-- What was wrong, and what this changes.
--
-- Compatibility: production code keeps running while this is applied, and
-- stays running on it if the release is rolled back. Add first, switch the code
-- over, remove the old thing in a later release — never in the same one.
-- =============================================================================

-- rollback: <SQL that undoes this, or "forward-fix only" and why>
-- safety: <rule> — <why it is safe>   (only for rules \`pnpm db:lint\` names)

`,
  );

  console.log(`created ${DIR}/${file}`);
  console.log(`(highest number already used: ${highest}${holders.length ? `, on ${holders.join(', ')}` : ''})`);
}

// ---------------------------------------------------------------------------
// ledger
// ---------------------------------------------------------------------------

/**
 * Production's history under the names it was applied with, before every
 * migration was applied under its file's own name. Frozen: nothing new is
 * added here — a migration applied from now on uses the name part of its
 * file, and matches without help.
 *
 * `null` marks an entry that is real but has no file: the API role grants
 * that scripts/db-push.mjs applies after the migrations.
 */
const LEGACY = {
  core_tables: '20260101000001_tables',
  functions_and_triggers: '20260101000003_functions',
  row_level_security: '20260101000004_rls',
  privilege_guards: '20260101000005_guards',
  storage_buckets: '20260101000006_storage',
  api_role_grants: null,
  email_notification_preferences: '20260101000008_email',
  company_logo_admin_scope: '20260101000024_member_scope',
  email_outbox_tables: '20260101000027_email_log',
  email_outbox_functions: '20260101000027_email_log',
  email_activity_readers: '20260101000027_email_log',
  email_activity_revoke_public: '20260101000027_email_log',
  applicant_digest_preference: '20260101000028_applicant_digest',
  refuse_reserved_domains: '20260101000029_reserved_domains',
  targeted_indexes: '20260101000030_indexes',
  repost_a_listing_whose_label_lags: '20260101000046_reposting_a_listing_that_never_returns',
};

/**
 * Files production ran without leaving a ledger entry — through the SQL editor
 * or a bare execute — each verified by hand against the database itself.
 * Counted as applied only when the ledger carries the historical names above,
 * which only production's does; any other database has to record them.
 *
 *   026  verified 2026-09-27: company-logos allows png, jpeg and webp only.
 */
export const UNRECORDED = ['20260101000026_no_svg_logos'];

/**
 * The steps that bring a database from its ledger to this checkout: every
 * pending file, in file order, each in its own transaction with its ledger row
 * (what `apply` runs, and scripts/release/rehearse.mjs runs first).
 *
 * `ranAhead` lists the files the database ran before a pending file that main
 * orders ahead of them — production ran 203, 204 and 316–318 before main's
 * 068–202 and 300–314. Where that order changes the result, an ADJUSTMENTS
 * entry puts it right for the one object concerned. The rehearsal is what
 * proves nothing else depends on the order: it compares the reconciled
 * database with a fresh build of main, object by object.
 */
export function reconciliationPlan(rows, repoFiles) {
  const files = repoFiles.filter((file) => NAME.test(file)).sort();
  const { matched } = reconcile(rows, files);
  const stems = files.map((file) => file.replace(/\.sql$/, ''));
  const pending = stems.filter((stem) => !matched.has(stem));
  return {
    steps: pending.map((stem) => ({
      stem,
      before: ADJUSTMENTS[stem]?.before ?? null,
      after: ADJUSTMENTS[stem]?.after ?? null,
    })),
    ranAhead: stems.filter((stem) => matched.has(stem) && pending.some((other) => other < stem)),
  };
}

/**
 * SQL run in a pending file's own transaction, just before or just after it,
 * where the database's history makes the file collide with something already
 * there. Frozen per file. Each is recorded in the ledger row's statements
 * beside the file, so the ledger still says exactly what ran.
 */
export const ADJUSTMENTS = {
  /*
    307 adds reports_detail_length (not valid; `detail is null or length(detail)
    <= 1000`), and 317 later drops it and adds its own (validated; `length(detail)
    <= 1000`), which is what main ends with. Production ran 317 first, so 307's
    add collides with 317's constraint. It is dropped just before 307 and put
    back, as 317 wrote it, just after — ending where main ends. The rehearsal
    found this, and found it to be the only object whose final form depends on
    the order.
  */
  '20260101000307_a_row_says_what_the_server_said': {
    before: 'alter table reports drop constraint if exists reports_detail_length;',
    after:
      'alter table reports drop constraint if exists reports_detail_length;\n' +
      'alter table reports add constraint reports_detail_length check (length(detail) <= 1000);',
  },
};

export async function loadLedger(options) {
  if (options.fromFile) {
    const parsed = JSON.parse(readFileSync(options.fromFile, 'utf8'));
    return { source: options.fromFile, rows: Array.isArray(parsed) ? parsed : (parsed.migrations ?? parsed.result ?? []) };
  }

  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (token) {
    const ref = options.ref ?? PRODUCTION_REF;
    const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/migrations`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`Supabase Management API answered ${response.status} for project ${ref}`);
    return { source: `project ${ref}`, rows: await response.json() };
  }

  const url = process.env.TARGET_DATABASE_URL;
  if (url) {
    const { default: pg } = await import('pg');
    const client = new pg.Client({ connectionString: url, ssl: url.includes('supabase.') ? { rejectUnauthorized: false } : undefined });
    await client.connect();
    const { rows } = await client.query('select version, name from supabase_migrations.schema_migrations order by version');
    await client.end();
    return { source: new URL(url).hostname, rows };
  }

  return null;
}

/**
 * When `apply` ran on production. A row it records carries its file's own
 * version, which says which file ran but not when, and a ledger is read in
 * version order — so the files of the release of 2026-09-29 (068–330, all that
 * production was missing then) list ahead of everything they ran after, and
 * replayed in that order 068 meets a database with no tables yet. Frozen per
 * run, like the rest of production's history here; a run not listed is the
 * latest, which ran after everything else.
 */
export const APPLY_RUNS = [{ at: '20260929000000', from: '20260101000068', through: '20260101000330' }];

/**
 * A ledger in the order its database ran it, which scripts/release/rehearse.mjs
 * replays. A row recorded under a time (Supabase's apply_migration, the CLI on
 * production before `apply` existed) ran at that time; a row `apply` recorded
 * under its file's version ran with its run (APPLY_RUNS), in file order. Only
 * production's ledger mixes the two — it is the one that carries the historical
 * names — so any other database's runs in version order, which for files is
 * file order.
 */
export function replayOrder(rows, repoFiles) {
  const production = rows.some((row) => Object.hasOwn(LEGACY, String(row.name ?? '')));
  const versions = new Set(repoFiles.map((file) => file.slice(0, 14)));
  const ranAt = (row) => {
    const version = String(row.version);
    if (!production || !versions.has(version)) return version;
    return APPLY_RUNS.find((run) => version >= run.from && version <= run.through)?.at ?? '99999999999999';
  };
  return [...rows].sort((a, b) => ranAt(a).localeCompare(ranAt(b)) || String(a.version).localeCompare(String(b.version)));
}

/**
 * Which file each ledger row is, in the ledger's own order: a stem, `null` for
 * a historical entry that has no file (LEGACY), or `undefined` for a row no
 * file accounts for (drift). A row matches by version, then by the historical
 * name it was applied under, then by the name part of a file.
 *
 * In row order because the order is information: given rows in the order the
 * database ran them (replayOrder), it is what scripts/release/rehearse.mjs
 * replays.
 */
export function resolveLedger(rows, repoFiles) {
  const stems = repoFiles.map((file) => file.replace(/\.sql$/, ''));
  const byVersion = new Map(stems.map((stem) => [stem.slice(0, 14), stem]));
  const seen = new Set();
  const entries = [];

  for (const row of rows) {
    const name = String(row.name ?? '');
    let stem;
    if (byVersion.has(String(row.version))) stem = byVersion.get(String(row.version));
    else if (Object.hasOwn(LEGACY, name)) stem = LEGACY[name];
    else if (stems.includes(name)) stem = name;
    else stem = stems.find((candidate) => candidate.slice(15) === name && !seen.has(candidate)) ?? stems.find((candidate) => candidate.slice(15) === name);

    if (stem) seen.add(stem);
    entries.push({ row, stem });
  }
  return entries;
}

export function reconcile(rows, repoFiles) {
  const stems = repoFiles.map((file) => file.replace(/\.sql$/, ''));
  const matched = new Set();
  const drift = [];
  const known = [];

  for (const { row, stem } of resolveLedger(rows, repoFiles)) {
    if (stem === null) known.push(row);
    else if (stem === undefined) drift.push(row);
    else matched.add(stem);
  }

  const unrecorded = [];
  if (rows.some((row) => Object.hasOwn(LEGACY, String(row.name ?? '')))) {
    for (const stem of UNRECORDED) {
      if (stems.includes(stem) && !matched.has(stem)) {
        matched.add(stem);
        unrecorded.push(stem);
      }
    }
  }

  const pending = stems.filter((stem) => !matched.has(stem));
  return { matched, drift, pending, known, unrecorded };
}

async function ledger(options) {
  const loaded = await loadLedger(options);
  if (!loaded) {
    console.error(
      'Nothing to compare against. Give one of:\n' +
        '  --from-file ledger.json            (Supabase MCP list_migrations output)\n' +
        '  SUPABASE_ACCESS_TOKEN=… [--ref <project>]   (Management API, read-only use)\n' +
        '  TARGET_DATABASE_URL=postgresql://…  (reads supabase_migrations.schema_migrations)',
    );
    process.exit(2);
  }

  let files = localFiles().filter((file) => NAME.test(file));
  if (options.base) files = [...filesAt(options.base)].filter((file) => NAME.test(file)).sort();

  const { matched, drift, pending, known, unrecorded } = reconcile(loaded.rows, files);
  const md = ['## Migration ledger', '', `Compared \`${loaded.source}\` with ${options.base ? `\`${options.base}\`` : 'this checkout'}.`, ''];

  console.log(`ledger: ${loaded.source} — ${loaded.rows.length} applied, ${files.length} in ${options.base ?? 'this checkout'}`);
  console.log(`  ${matched.size} migration file(s) applied${known.length ? `, ${known.length} historical entr${known.length === 1 ? 'y' : 'ies'} with no file (expected)` : ''}`);
  if (unrecorded.length) console.log(`  (${unrecorded.join(', ')} applied without a ledger entry, verified by hand)`);
  md.push(`- ${matched.size} migration file(s) applied`);

  if (pending.length) {
    console.log(`\n  pending — in git, not applied (${pending.length}):`);
    for (const stem of pending) console.log(`    ${stem}`);
    md.push(`- **${pending.length} pending** (in git, not applied): ${pending.map((stem) => `\`${stem}\``).join(', ')}`);
  }

  if (drift.length) {
    console.log(`\n  DRIFT — applied, but no migration in git says so (${drift.length}):`);
    for (const row of drift) console.log(`    ${row.version}  ${row.name}`);
    console.log('\n  The database runs a schema no commit here can rebuild. Merge the');
    console.log('  migrations that did this, or write one that undoes it.');
    md.push(`- **⛔ ${drift.length} drifted** (applied, not in git): ${drift.map((row) => `\`${row.name}\` (${row.version})`).join(', ')}`);
  } else {
    console.log('\n  no drift: everything applied is in git');
    md.push('- no drift');
  }

  const summary = options.summary ?? process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, `${md.join('\n')}\n`);

  const failPending = options.strict && pending.length;
  process.exit(drift.length || failPending ? 1 : 0);
}

// ---------------------------------------------------------------------------
// apply
// ---------------------------------------------------------------------------

/** Held for the whole apply, so two cannot interleave on one database. */
const APPLY_LOCK = 7_426_001;

/**
 * Applies what a database is missing, and nothing else.
 *
 *   TARGET_DATABASE_URL=postgresql://… pnpm db:apply            # the plan, applied to nothing
 *   TARGET_DATABASE_URL=postgresql://… pnpm db:apply --execute  # and then for real
 *
 * Reads the database's own ledger, works out the pending files with
 * reconcile(), and runs reconciliationPlan(): each pending file in file order,
 * with its ADJUSTMENTS, in its own transaction together with its ledger row —
 * so a failure leaves the database on the last file that fully succeeded, and
 * the ledger always says exactly what ran. It stops at the first failure.
 *
 * This replaces `pnpm db:push:url` for any database that already has data:
 * that script re-runs every migration, then seed.sql, then the API grants.
 *
 * Refused: a ledger with drift (the database runs something no file here
 * explains — merge it first); the transaction pooler (port 6543), which cannot
 * hold a transaction open around DDL; production without `--confirm <ref>`.
 * Each file waits at most five seconds for a lock rather than queueing the
 * site's traffic behind it; a timeout rolls that file back and stops.
 *
 * Rehearse first: node scripts/release/rehearse.mjs --ledger <ledger.json>.
 */
async function apply(options) {
  const url = process.env.TARGET_DATABASE_URL;
  if (!url) {
    console.error(
      'Set TARGET_DATABASE_URL to the database to bring up to date — the direct connection or the\n' +
        'session pooler (port 5432), never the transaction pooler (6543).',
    );
    process.exit(2);
  }
  if (/:6543(\/|$)/.test(url)) {
    console.error('That is the transaction pooler (port 6543). Use the session pooler or the direct connection.');
    process.exit(2);
  }
  const production = url.includes(PRODUCTION_REF);

  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: url, ssl: url.includes('supabase.') ? { rejectUnauthorized: false } : undefined });
  await client.connect();

  try {
    const { rows } = await client.query('select version, name from supabase_migrations.schema_migrations order by version');
    const files = localFiles().filter((file) => NAME.test(file));
    const { drift } = reconcile(rows, files);
    const plan = reconciliationPlan(rows, files);

    console.log(`apply: ${production ? 'PRODUCTION' : new URL(url).hostname} — ${rows.length} ledger rows, ${files.length} files here`);
    if (drift.length) {
      console.error(`\n  refused: ${drift.length} ledger row(s) no file here explains:`);
      for (const row of drift) console.error(`    ${row.version}  ${row.name}`);
      process.exitCode = 1;
      return;
    }
    if (!plan.steps.length) {
      console.log('  nothing pending: the database has every migration here');
      return;
    }
    if (plan.ranAhead.length) {
      console.log(`  ran ahead of main's order: ${plan.ranAhead.join(', ')}`);
    }
    console.log(`\n  ${plan.steps.length} to apply, in this order:`);
    for (const step of plan.steps) {
      console.log(`    ${step.stem}${step.before || step.after ? '   (with its adjustment — see ADJUSTMENTS)' : ''}`);
    }

    if (!options.execute) {
      console.log('\n  dry run: nothing was applied. Run again with --execute to apply.');
      return;
    }
    if (production && options.confirm !== PRODUCTION_REF) {
      console.error(`\n  refused: this is production. Take a backup, then add --confirm ${PRODUCTION_REF}.`);
      process.exitCode = 1;
      return;
    }

    const { rows: lock } = await client.query('select pg_try_advisory_lock($1) as held', [APPLY_LOCK]);
    if (!lock[0].held) {
      console.error('\n  refused: another apply is running against this database.');
      process.exitCode = 1;
      return;
    }

    console.log('');
    for (const step of plan.steps) {
      const sql = readLocal(`${step.stem}.sql`);
      const statements = [step.before, sql, step.after].filter(Boolean);
      process.stdout.write(`  ${step.stem} … `);
      try {
        await client.query('begin');
        await client.query("set local lock_timeout = '5s'");
        for (const statement of statements) await client.query(statement);
        await client.query(
          'insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, $3)',
          [step.stem.slice(0, 14), step.stem.slice(15), statements],
        );
        await client.query('commit');
        console.log('ok');
      } catch (error) {
        await client.query('rollback').catch(() => {});
        console.log('FAILED');
        console.error(`\n  ${error.message}${error.hint ? `\n  hint: ${error.hint}` : ''}`);
        console.error('\n  Rolled back. Everything before it is applied and recorded; nothing after it ran.');
        process.exitCode = 1;
        return;
      }
    }
    console.log(`\n  applied ${plan.steps.length}. Check with: pnpm db:ledger (then pnpm dr:drift, pnpm doctor).`);
  } finally {
    await client.end();
  }
}

// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const options = { positional: [], fetch: true };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--base') options.base = argv[++i];
    else if (arg === '--all') options.all = true;
    else if (arg === '--summary') options.summary = argv[++i];
    else if (arg === '--from-file') options.fromFile = argv[++i];
    else if (arg === '--ref') options.ref = argv[++i];
    else if (arg === '--strict') options.strict = true;
    else if (arg === '--no-fetch') options.fetch = false;
    else if (arg === '--no-base') options.noBase = true;
    else if (arg === '--execute') options.execute = true;
    else if (arg === '--confirm') options.confirm = argv[++i];
    else options.positional.push(arg);
  }
  return options;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const [command, ...rest] = process.argv.slice(2);
  const options = parseArgs(rest);

  if (command === 'lint') {
    // Locally, compare with origin/main unless told otherwise; CI passes --base.
    if (!options.base && !options.noBase && tryGit('rev-parse', '--verify', '--quiet', 'origin/main')) {
      options.base = 'origin/main';
    }
    const result = lint(options);
    printLint(result, options);
    process.exit(result.errors.length ? 1 : 0);
  } else if (command === 'new') {
    create(options.positional, options);
  } else if (command === 'ledger') {
    await ledger(options);
  } else if (command === 'apply') {
    await apply(options);
  } else {
    console.error(
      'usage: migrations.mjs lint [--base <ref>] [--all] | new <slug> | ledger [--from-file f] [--ref r] [--base <ref>] [--strict]\n' +
        '       migrations.mjs apply [--execute [--confirm <production ref>]]   (TARGET_DATABASE_URL)',
    );
    process.exit(2);
  }
}
