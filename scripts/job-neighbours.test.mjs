/**
 * Previous and next, in the list the review was opened from.
 *
 *   node --experimental-strip-types scripts/job-neighbours.test.mjs
 *
 * The ids are computed with the same filters as the listings page. This
 * stands in for PostgREST and checks the order, the ends, and the pending
 * queue the page walks after a decision.
 */
import { register } from 'node:module';

register('../supabase/tests/alias-hooks.mjs', import.meta.url);

const { defaultSort, jobListContext, jobListHref, jobNeighbours, jobReviewHref, sideFilter } = await import(
  '../src/lib/admin/job-neighbours.ts'
);

let pass = 0;
let fail = 0;

function is(label, got, want) {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';
const D = '00000000-0000-4000-8000-00000000000d';
const T1 = '2026-01-01T00:00:00.000Z';
const T2 = '2026-01-02T00:00:00.000Z';
const T3 = '2026-01-03T00:00:00.000Z';

console.log('— the address of the list');
is('a review opened with no query is the pending queue, oldest first', jobListContext({}), { tab: 'pending', sort: 'oldest' });
is('pending is oldest unless asked otherwise', defaultSort('pending'), 'oldest');
is('the whole list is newest', defaultSort('all'), 'newest');
is('all omits the status filter', jobListHref({ tab: 'all', sort: 'newest' }), '/admin/jobs');
is(
  'a queue keeps its tab and its search',
  jobReviewHref(B, { tab: 'pending', sort: 'oldest', q: 'مبيعات' }),
  `/admin/jobs/${B}?tab=pending&sort=oldest&q=%D9%85%D8%A8%D9%8A%D8%B9%D8%A7%D8%AA`,
);
is('the list page says status, not tab', jobListHref({ tab: 'pending', sort: 'oldest' }), '/admin/jobs?status=pending');
is(
  'before, oldest first, is an earlier time or the same time and a smaller id',
  sideFilter('created_at', T2, B, 'before', true),
  `created_at.lt.${T2},and(created_at.eq.${T2},id.lt.${B})`,
);

function splitTop(expr) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < expr.length; i += 1) {
    if (expr[i] === '(') depth += 1;
    else if (expr[i] === ')') depth -= 1;
    else if (expr[i] === ',' && depth === 0) {
      parts.push(expr.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(expr.slice(start));
  return parts;
}

function matchesAtom(row, atom) {
  const match = /^([a-z_]+)\.(eq|neq|gt|lt|gte|lte|ilike)\.(.*)$/.exec(atom);
  if (!match) return false;
  const [, column, op, raw] = match;
  const value = row[column];
  if (op === 'eq') return value === raw;
  if (op === 'neq') return value !== raw;
  if (op === 'ilike') return String(value ?? '').toLowerCase().includes(raw.replaceAll('*', '').toLowerCase());
  if (value == null) return false;
  if (op === 'gt') return value > raw;
  if (op === 'lt') return value < raw;
  if (op === 'gte') return value >= raw;
  if (op === 'lte') return value <= raw;
  return false;
}

function matchesOr(row, expr) {
  return splitTop(expr).some((part) => {
    if (part.startsWith('and(') && part.endsWith(')')) return splitTop(part.slice(4, -1)).every((inner) => matchesAtom(row, inner));
    return matchesAtom(row, part);
  });
}

/** The jobs table, answering the way the neighbour queries ask. */
function database(rows, flagged = []) {
  return {
    from() {
      return {
        select(_columns, options) {
          const filters = [];
          const orders = [];
          let limitN = null;
          const query = {
            eq(column, value) {
              filters.push((row) => row[column] === value);
              return query;
            },
            neq(column, value) {
              filters.push((row) => row[column] !== value);
              return query;
            },
            gt(column, value) {
              filters.push((row) => row[column] != null && row[column] > value);
              return query;
            },
            lt(column, value) {
              filters.push((row) => row[column] != null && row[column] < value);
              return query;
            },
            lte(column, value) {
              filters.push((row) => row[column] != null && row[column] <= value);
              return query;
            },
            is(column, value) {
              filters.push((row) => (value === null ? row[column] == null || (Array.isArray(row[column]) && row[column].length === 0) : row[column] === value));
              return query;
            },
            in(column, values) {
              if (column.includes('.')) {
                const [embed, field] = column.split('.');
                filters.push((row) => (row[embed] ?? []).some((item) => values.includes(item[field])));
              } else filters.push((row) => values.includes(row[column]));
              return query;
            },
            or(expr) {
              filters.push((row) => matchesOr(row, expr));
              return query;
            },
            order(column, order) {
              orders.push({ column, ascending: order?.ascending !== false });
              return query;
            },
            limit(n) {
              limitN = n;
              return query;
            },
            then(resolve, reject) {
              try {
                let matched = rows.filter((row) => filters.every((test) => test(row)));
                matched = [...matched].sort((left, right) => {
                  for (const { column, ascending } of orders) {
                    const a = left[column] ?? '';
                    const b = right[column] ?? '';
                    if (a < b) return ascending ? -1 : 1;
                    if (a > b) return ascending ? 1 : -1;
                  }
                  return 0;
                });
                if (limitN != null) matched = matched.slice(0, limitN);
                resolve({
                  data: options?.head ? null : matched.map((row) => ({ id: row.id })),
                  error: null,
                  count: matched.length,
                });
              } catch (error) {
                reject(error);
              }
            },
          };
          return query;
        },
      };
    },
    rpc() {
      return Promise.resolve({ data: flagged, error: null });
    },
  };
}

const rows = [
  { id: A, status: 'pending_review', created_at: T1, published_at: null, expires_at: null },
  { id: B, status: 'pending_review', created_at: T2, published_at: null, expires_at: null },
  { id: C, status: 'pending_review', created_at: T3, published_at: null, expires_at: null },
  { id: D, status: 'active', created_at: T2, published_at: T2, expires_at: '2026-12-01T00:00:00.000Z' },
];

const pending = { tab: 'pending', sort: 'oldest' };

console.log('\n— where a listing sits in the pending queue');
const middle = await jobNeighbours(database(rows), rows[1], pending, new Date('2026-10-27T00:00:00.000Z'));
is('the one in the middle', middle, { previousId: A, nextId: C, position: 2, total: 3, nextPendingId: C });

const first = await jobNeighbours(database(rows), rows[0], pending, new Date('2026-10-27T00:00:00.000Z'));
is('the oldest has no previous', first.previousId, null);
is('and is 1 of 3', { position: first.position, total: first.total, nextId: first.nextId }, { position: 1, total: 3, nextId: B });

const last = await jobNeighbours(database(rows), rows[2], pending, new Date('2026-10-27T00:00:00.000Z'));
is('the newest of the queue has no next', last.nextId, null);
is('and after it, the queue continues at the oldest other one', last.nextPendingId, A);

const outside = await jobNeighbours(database(rows), rows[3], pending, new Date('2026-10-27T00:00:00.000Z'));
is('a listing the filter excludes is not counted in the list', outside.position, null);
is('the queue still has its three', outside.total, 3);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
