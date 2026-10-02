/**
 * The service-role client as far as notify.ts reads it: a query builder over
 * globalThis.__db, whose tables are arrays of rows — or a function answering
 * { data, error }, for a read that should fail.
 */
function query(table) {
  const filters = [];
  let order = null;
  let limit = null;
  let single = false;
  const run = () => {
    const source = globalThis.__db[table];
    if (typeof source === 'function') return source(filters);
    let rows = (source ?? []).filter((row) => filters.every((test) => test(row)));
    if (order) rows = [...rows].sort((a, b) => (a[order.col] < b[order.col] ? -1 : a[order.col] > b[order.col] ? 1 : 0) * (order.asc ? 1 : -1));
    if (limit != null) rows = rows.slice(0, limit);
    if (single) return { data: rows[0] ?? null, error: null };
    return { data: rows, error: null };
  };
  const builder = {
    select() {
      return builder;
    },
    eq(col, value) {
      filters.push((row) => row[col] === value);
      return builder;
    },
    in(col, values) {
      filters.push((row) => values.includes(row[col]));
      return builder;
    },
    order(col, options = {}) {
      order = { col, asc: options.ascending !== false };
      return builder;
    },
    limit(n) {
      limit = n;
      return builder;
    },
    maybeSingle() {
      single = true;
      return Promise.resolve(run());
    },
    then(resolve, reject) {
      return Promise.resolve(run()).then(resolve, reject);
    },
  };
  return builder;
}

export function createAdminClient() {
  return {
    from: query,
    auth: { admin: { getUserById: async (id) => ({ data: { user: { email: `${id}@example.test` } }, error: null }) } },
  };
}
