/**
 * Drafts a form keeps in the browser, and the words for a failed upload.
 *
 *   node --experimental-strip-types scripts/form-draft.test.mjs   (pnpm test:drafts)
 *
 * What is pinned is what would go wrong quietly. A draft read back for the
 * wrong account, or kept past its week, or left behind by signing out, is
 * somebody's phone number on a shared computer. A draft that throws when
 * storage is full or blocked is a form that stops working. And an upload
 * refusal sorted into the wrong bucket tells a person to try again when the
 * file is too big, or to sign in when they are only offline.
 */
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

/** A localStorage, so the module can run outside a browser. */
function storage({ quota = Infinity, broken = false } = {}) {
  const store = new Map();
  const api = {
    get length() {
      return store.size;
    },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => {
      if (broken) throw new Error('SecurityError');
      return store.has(key) ? store.get(key) : null;
    },
    setItem: (key, value) => {
      if (broken) throw new Error('SecurityError');
      if (String(value).length > quota) throw new Error('QuotaExceededError');
      store.set(key, String(value));
    },
    removeItem: (key) => {
      if (broken) throw new Error('SecurityError');
      store.delete(key);
    },
  };
  globalThis.localStorage = api;
  return store;
}

const { DRAFT_MAX_AGE_MS, draftKey, forgetDrafts, pruneDrafts, readDraft, removeDraft, writeDraft } =
  await import('../src/lib/form-draft.ts');
const { afterDenied, uploadFailure } = await import('../src/lib/upload-failure.ts');

const NOW = Date.UTC(2026, 9, 16, 12, 0, 0);

console.log('— a draft is the account’s and the record’s');
{
  storage();
  const mine = draftKey('job', 'user-a', 'job-1');
  const theirs = draftKey('job', 'user-b', 'job-1');
  is('keys name the form, the account and the record', mine, 'bc-draft:job:user-a:job-1');
  is('a new record is "new"', draftKey('apply', 'user-a'), 'bc-draft:apply:user-a:new');

  is('written', writeDraft(mine, { title: 'وكيل مبيعات' }, '3', NOW), true);
  is('read back as written', readDraft(mine, NOW + 1000), {
    values: { title: 'وكيل مبيعات' },
    savedAt: NOW,
    base: '3',
  });
  is('another account on the same browser reads nothing', readDraft(theirs, NOW), null);
  removeDraft(mine);
  is('removed is gone', readDraft(mine, NOW), null);
}

console.log('— a draft is kept a week and no longer');
{
  const store = storage();
  const key = draftKey('apply', 'user-a', 'job-1');
  writeDraft(key, { note: 'x' }, null, NOW);
  is('six days on it is there', readDraft(key, NOW + 6 * 86_400_000)?.values, { note: 'x' });
  is('past the week it is not', readDraft(key, NOW + DRAFT_MAX_AGE_MS + 1), null);
  is('and reading it took it out of storage', store.has(key), false);

  writeDraft(key, { note: 'x' }, null, NOW + 10 * 86_400_000);
  is('one dated in the future (a wrong clock) is not trusted', readDraft(key, NOW), null);
}

console.log('— what cannot be read is thrown away, not handed to a form');
{
  const store = storage();
  store.set('bc-draft:job:user-a:new', '{not json');
  store.set('bc-draft:job:user-a:old', JSON.stringify({ v: 0, at: NOW, base: null, values: {} }));
  store.set('bc-draft:job:user-a:odd', JSON.stringify({ v: 1, at: NOW, base: 7, values: {} }));
  is('unparseable', readDraft('bc-draft:job:user-a:new', NOW), null);
  is('an older shape', readDraft('bc-draft:job:user-a:old', NOW), null);
  is('a base that is not text', readDraft('bc-draft:job:user-a:odd', NOW), null);
  is('all three removed', store.size, 0);
}

console.log('— signing out and pruning');
{
  const store = storage();
  store.set('bc-theme', 'dark');
  writeDraft(draftKey('apply', 'user-a', 'j1'), { a: 1 }, null, NOW);
  writeDraft(draftKey('job', 'user-b'), { b: 1 }, null, NOW - DRAFT_MAX_AGE_MS - 1);
  store.set('bc-draft:broken', 'nope');

  is('pruning takes the expired and the unreadable', pruneDrafts(NOW), 2);
  is('and leaves a live draft', readDraft(draftKey('apply', 'user-a', 'j1'), NOW)?.values, { a: 1 });

  writeDraft(draftKey('onboarding', 'user-c'), { c: 1 }, null, NOW);
  is('signing out forgets every draft', forgetDrafts(), 2);
  is('and nothing that is not a draft', [...store.keys()], ['bc-theme']);
}

console.log('— storage that refuses is a form without a draft, not a broken form');
{
  storage({ broken: true });
  const key = draftKey('apply', 'user-a', 'j1');
  is('write answers false', writeDraft(key, { a: 1 }, null, NOW), false);
  is('read answers null', readDraft(key, NOW), null);
  is('forget answers 0', forgetDrafts(), 0);

  delete globalThis.localStorage;
  is('no storage at all (the server) reads null', readDraft(key, NOW), null);
  is('and writes nothing', writeDraft(key, { a: 1 }, null, NOW), false);

  const store = storage({ quota: 50 });
  store.set(key, JSON.stringify({ v: 1, at: NOW, base: null, values: { short: 1 } }));
  is('a full storage refuses the write', writeDraft(key, { long: 'x'.repeat(200) }, null, NOW), false);
  is('and does not leave the older draft to be read as the latest', readDraft(key, NOW), null);

  storage();
  is('past the size ceiling it is not written', writeDraft(key, { long: 'x'.repeat(70_000) }, null, NOW), false);
}

console.log('— why an upload failed');
is('nothing at all', uploadFailure(null), 'failed');
is('413', uploadFailure({ name: 'StorageApiError', status: 413, statusCode: '413', message: 'Payload too large' }), 'too_large');
is('EntityTooLarge behind a 400', uploadFailure({ status: 400, statusCode: '413', code: 'EntityTooLarge', message: 'The object exceeded the maximum allowed size' }), 'too_large');
is('the MIME list', uploadFailure({ status: 400, statusCode: '415', code: 'InvalidMimeType', message: 'mime type application/x-msdownload is not supported' }), 'file_type');
is('row-level security', uploadFailure({ status: 400, statusCode: '403', message: 'new row violates row-level security policy' }), 'denied');
is('an expired token', uploadFailure({ status: 400, statusCode: '400', code: 'InvalidJWT', message: '"exp" claim timestamp check failed' }), 'denied');
is('a 403', uploadFailure({ status: 403, statusCode: '403', message: 'Unauthorized' }), 'denied');
is('no response', uploadFailure({ name: 'StorageUnknownError', message: 'Failed to fetch' }), 'network');
is('Safari’s no response', uploadFailure({ message: 'Load failed' }), 'network');
is('a server error', uploadFailure({ status: 500, statusCode: '500', message: 'Internal Server Error' }), 'failed');

console.log('— after a refusal by policy: signed out, or only offline?');
is('somebody signed in may not upload here', afterDenied({ data: { user: { id: 'u' } }, error: null }), 'denied');
is('the call itself threw: offline, not signed out', afterDenied(null), 'network');
is('the auth server could not be reached: offline, not signed out', afterDenied({ data: { user: null }, error: { name: 'AuthRetryableFetchError' } }), 'network');
is('no session: sign in again', afterDenied({ data: { user: null }, error: { name: 'AuthSessionMissingError' } }), 'signed_out');
is('a revoked session: sign in again', afterDenied({ data: { user: null }, error: { name: 'AuthApiError' } }), 'signed_out');

console.log('— every way out of an account takes its drafts with it');
{
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const walk = (dir) =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : /\.tsx?$/.test(name) ? [path] : [];
    });
  // A browser leaving an account: signing out here, or the account deleted.
  const exits = walk('src').filter((path) => {
    const text = readFileSync(path, 'utf8');
    return /^['"]use client['"]/m.test(text) && /signOut\(\{\s*scope:\s*'local'|deleteMyAccount\(\)/.test(text);
  });
  is('found the ways out', exits.length >= 3, true);
  for (const path of exits) {
    is(`${path} forgets the drafts`, readFileSync(path, 'utf8').includes('forgetDrafts()'), true);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
