import { env } from '~/lib/env';
import { withAppMarker } from '~/lib/app-marker';

const SITE = env.siteUrl;

/** The same address on a host that only looks like this site. */
function lookAlike(path: string): string {
  const url = new URL(path, SITE);
  url.hostname = `${url.hostname}.evil.example`;
  return url.toString();
}

describe('withAppMarker', () => {
  it('adds app=1 on a page of this site', () => {
    expect(withAppMarker(`${SITE}/privacy`)).toBe(`${SITE}/privacy?app=1`);
    expect(withAppMarker(`${SITE}/terms`)).toBe(`${SITE}/terms?app=1`);
    expect(withAppMarker(SITE)).toBe(`${SITE}/?app=1`);
    expect(withAppMarker(`${SITE}/`)).toBe(`${SITE}/?app=1`);
  });

  it('keeps a query and a hash that were already there', () => {
    expect(withAppMarker(`${SITE}/unsubscribe?token=abc`)).toBe(`${SITE}/unsubscribe?token=abc&app=1`);
    expect(withAppMarker(`${SITE}/jobs?q=sales&district=new-cairo#results`)).toBe(
      `${SITE}/jobs?q=sales&district=new-cairo&app=1#results`,
    );
    expect(withAppMarker(`${SITE}/x?a=1&a=2`)).toBe(`${SITE}/x?a=1&a=2&app=1`);
    expect(withAppMarker(`${SITE}/privacy#cookies`)).toBe(`${SITE}/privacy?app=1#cookies`);
    expect(withAppMarker(`${SITE}/privacy?x=1&app=0&y=2`)).toBe(`${SITE}/privacy?x=1&app=1&y=2`);
  });

  it('leaves an address that already carries the marker', () => {
    const marked = `${SITE}/privacy?foo=1&app=1#cookies`;
    expect(withAppMarker(marked)).toBe(marked);
    expect(withAppMarker(withAppMarker(`${SITE}/terms`))).toBe(`${SITE}/terms?app=1`);
  });

  it.each([
    ['a signed file', 'https://storage.example/cv.pdf?token=1'],
    ['a licence', 'https://spdx.org/licenses/MIT.html'],
    ['a look-alike host', lookAlike('/privacy')],
    ['a path with no host', '/privacy'],
    ['not an address', 'privacy'],
    ['nothing', ''],
  ])('leaves %s untouched', (_name, input) => {
    expect(withAppMarker(input)).toBe(input);
  });

  it('leaves a different origin on the same host untouched', () => {
    const other = new URL(`${SITE}/privacy`);
    other.protocol = other.protocol === 'https:' ? 'http:' : 'https:';
    expect(withAppMarker(other.toString())).toBe(other.toString());
  });
});
