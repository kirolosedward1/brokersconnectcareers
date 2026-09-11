/**
 * Where a reader came from, and what a URL is allowed to claim about it.
 *
 *   node --experimental-strip-types scripts/share-source.test.mjs
 *
 * Two things are worth pinning here and neither is the happy path. A `?src=`
 * is attacker-supplied — it is a query parameter on a page anyone can link to
 * — and it ends up as a property on an analytics event, so anything other than
 * a value this app recognises has to be dropped rather than stored. And the
 * tag has to be added to a URL without eating whatever was already on it.
 */
import assert from 'node:assert/strict';

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

/** A sessionStorage and a location, so the module can run outside a browser. */
function browser(href) {
  const store = new Map();
  let current = href;

  globalThis.sessionStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
  };
  globalThis.window = {
    get location() {
      return { href: current };
    },
    history: {
      replaceState: (_state, _title, url) => {
        current = new URL(url, current).toString();
      },
    },
  };

  return { store, href: () => current };
}

const { rememberShareArrival, shareSource, withShareSource } = await import(
  '../src/lib/share-source.ts'
);

console.log('— the tag is added without eating the query that was there');
is('a bare listing', withShareSource('https://x.test/jobs/a-1'), 'https://x.test/jobs/a-1?src=share');
is(
  'one that already carries a filter',
  withShareSource('https://x.test/jobs?track=primary'),
  'https://x.test/jobs?track=primary&src=share',
);
is(
  'one that already claims a source',
  withShareSource('https://x.test/jobs/a-1?src=other'),
  'https://x.test/jobs/a-1?src=share',
);
is('something that is not a URL at all', withShareSource('not a url'), 'not a url');

console.log('\n— only a value this app recognises is remembered');
{
  const page = browser('https://x.test/jobs/a-1?src=share');
  is('a share is remembered', rememberShareArrival(), 'share');
  is('and readable afterwards', shareSource(), 'share');
  is('and taken back out of the address bar', page.href(), 'https://x.test/jobs/a-1');
}
{
  browser('https://x.test/jobs/a-1?src=paid-ads-q3');
  is('an invented source is not', rememberShareArrival(), null);
  is('and nothing is stored', shareSource(), null);
}
{
  browser('https://x.test/jobs/a-1?src=<script>alert(1)</script>');
  is('nor is markup', rememberShareArrival(), null);
}
{
  const page = browser('https://x.test/jobs/a-1?track=primary&src=share');
  rememberShareArrival();
  is('the rest of the query survives the cleanup', page.href(), 'https://x.test/jobs/a-1?track=primary');
}
{
  browser('https://x.test/jobs/a-1');
  is('a visit with no tag remembers nothing', rememberShareArrival(), null);
}

console.log('\n— storage that refuses is not an error');
{
  globalThis.window = { location: { href: 'https://x.test/jobs/a-1?src=share' }, history: { replaceState() {} } };
  globalThis.sessionStorage = {
    getItem() {
      throw new Error('the browser is blocking site data');
    },
    setItem() {
      throw new Error('the browser is blocking site data');
    },
  };
  assert.doesNotThrow(() => rememberShareArrival());
  assert.doesNotThrow(() => shareSource());
  is('a private window measures nothing and breaks nothing', shareSource(), null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
