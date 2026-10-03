/**
 * The pure halves of the security modules: what a file is, what a piece of
 * text becomes, what an href may be, and how two secrets are compared.
 *
 *   pnpm test:security-libs
 *
 * These are the rules the server actions lean on before anything reaches the
 * database, and every one of them is the kind that silently stops being true
 * under a refactor — a regex loosened, a scheme added, a magic number typo'd.
 */
import { cleanText, clean, safeHttpUrl } from '../src/lib/security/sanitize.ts';
import { sniffKind, isOwnedPath } from '../src/lib/security/magic.ts';
import { secretsMatch, bearerToken } from '../src/lib/security/secrets.ts';
import { isPaymentPage } from '../src/lib/paymob/checkout-url.ts';

let pass = 0;
let fail = 0;
function check(label, ok, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('\n— text a person typed');
{
  const r = cleanText('<script>alert(1)</script>استشاري <b>مبيعات</b>');
  check('markup is removed', r.ok && r.value === 'alert(1) استشاري مبيعات', JSON.stringify(r));

  const bidi = cleanText('salary‮000,05‬ EGP');
  check('bidirectional overrides are removed', bidi.ok && !/[‪-‮]/.test(bidi.value));

  const zero = cleanText('free​​lance');
  check('zero-width characters are removed', zero.ok && zero.value === 'freelance');

  const control = cleanText('line\u0000one\u0007');
  check('control characters are removed', control.ok && control.value === 'lineone');

  const multi = cleanText('a\n\n\n\n\nb   c\t d', { multiline: true });
  check('multi-line keeps paragraphs and collapses padding', multi.ok && multi.value === 'a\n\nb c d', JSON.stringify(multi));

  const links = cleanText('see https://a.example and www.b.example and http://c.example', { maxLinks: 2 });
  check('too many links is a refusal', !links.ok && links.reason === 'too_many_links');

  const fine = cleanText('see https://a.example', { maxLinks: 2 });
  check('a link within the allowance passes', fine.ok);

  check('clean() returns a string, empty when refused', clean(null) === '' && clean('  x  ') === 'x');
}

console.log('\n— an href');
{
  check('https passes', safeHttpUrl('https://example.com/a?b=1') === 'https://example.com/a?b=1');
  check('http passes', safeHttpUrl('http://example.com') === 'http://example.com/');
  for (const bad of [
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    ' javascript:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html,hi',
    'vbscript:x',
    'ftp://example.com',
    '//example.com',
    'example.com',
    'https://user:pw@example.com',
    '',
    null,
  ]) {
    check(`refuses ${JSON.stringify(bad)}`, safeHttpUrl(bad) === null, String(safeHttpUrl(bad)));
  }
  check('length is bounded', safeHttpUrl(`https://example.com/${'a'.repeat(300)}`) === null);

  // An Arabic page name, as people paste it: kept readable, and short enough
  // for the column (190 after the scheme), where its escaped form was 233.
  const page = 'https://www.facebook.com/شركة-الرواد-للتسويق-والاستثمار-العقاري';
  check('an Arabic address is kept as it reads', safeHttpUrl(page) === page, String(safeHttpUrl(page)));
  check(
    'and fits the column, which its escaped form did not',
    /^https?:\/\/[^\s]{1,190}$/i.test(safeHttpUrl(page) ?? '') && new URL(page).toString().length > 198,
  );
  check(
    'an invisible direction mark stays escaped',
    safeHttpUrl('https://example.com/a\u202Eb') === 'https://example.com/a%E2%80%AEb',
    String(safeHttpUrl('https://example.com/a\u202Eb')),
  );
  check(
    'so does a space',
    safeHttpUrl('https://example.com/a b') === 'https://example.com/a%20b',
    String(safeHttpUrl('https://example.com/a b')),
  );
  check(
    'an address too long for the column even read is refused',
    safeHttpUrl(`https://example.com/${'م'.repeat(185)}`) === null,
  );
}

console.log('\n— the one page off the site a button may send somebody to');
{
  check('Paymob\'s payment page', isPaymentPage('https://accept.paymob.com/api/acceptance/iframes/812345?payment_token=abc'));
  check('not over plain http', !isPaymentPage('http://accept.paymob.com/api/acceptance/iframes/812345?payment_token=abc'));
  check('not another host', !isPaymentPage('https://accept.paymob.com.evil.example/api/acceptance/iframes/812345'));
  check('not a user@host trick', !isPaymentPage('https://accept.paymob.com@evil.example/api/acceptance/iframes/1'));
  check('not another path on the host', !isPaymentPage('https://accept.paymob.com/api/auth/tokens'));
  check('not a script', !isPaymentPage('javascript:alert(1)'));
  check('not protocol-relative', !isPaymentPage('//evil.example/api/acceptance/iframes/1'));
  check('nor nothing', !isPaymentPage(''));
}

console.log('\n— what a file is');
{
  const bytes = (...parts) => {
    const out = [];
    for (const part of parts) {
      if (typeof part === 'string') out.push(...Array.from(part, (c) => c.charCodeAt(0)));
      else out.push(...part);
    }
    return new Uint8Array(out);
  };
  check('PDF', sniffKind(bytes('%PDF-1.7\n')) === 'pdf');
  check('PNG', sniffKind(bytes([0x89], 'PNG\r\n', [0x1a, 0x0a])) === 'png');
  check('JPEG', sniffKind(bytes([0xff, 0xd8, 0xff, 0xe0])) === 'jpeg');
  check('WebP', sniffKind(bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 ')) === 'webp');
  check('legacy .doc', sniffKind(bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) === 'doc');
  const zipHeader = [0x50, 0x4b, 0x03, 0x04, ...new Array(26).fill(0)];
  check('.docx', sniffKind(bytes(zipHeader, '[Content_Types].xml')) === 'docx');
  check('a zip that is not a document is not a docx', sniffKind(bytes(zipHeader, 'payload.exe')) === null);
  check('HTML is nothing', sniffKind(bytes('<!doctype html><script>')) === null);
  check('an executable is nothing', sniffKind(bytes('MZ', [0x90, 0])) === null);
  check('an SVG is nothing', sniffKind(bytes('<svg xmlns=')) === null);
  check('empty is nothing', sniffKind(new Uint8Array()) === null);
}

console.log('\n— the shape of a storage path');
{
  const me = '11111111-1111-1111-1111-111111111111';
  check('own folder, one file', isOwnedPath(`${me}/cv-1.pdf`, me));
  check('dot segments refused', !isOwnedPath(`${me}/../22222222-2222-2222-2222-222222222222/cv.pdf`, me));
  check('nested folders refused', !isOwnedPath(`${me}/a/b.pdf`, me));
  check("somebody else's folder refused", !isOwnedPath(`22222222-2222-2222-2222-222222222222/cv.pdf`, me));
  check('percent-encoding refused', !isOwnedPath(`${me}/%2e%2e/cv.pdf`, me));
  check('a bare folder refused', !isOwnedPath(`${me}/`, me));
  check('spaces refused', !isOwnedPath(`${me}/my cv.pdf`, me));
}

console.log('\n— secrets');
{
  check('equal secrets match', secretsMatch('abc123', 'abc123'));
  check('different secrets do not', !secretsMatch('abc123', 'abc124'));
  check('an empty expected never matches', !secretsMatch('', '') && !secretsMatch('x', ''));
  check('an unset header never matches', !secretsMatch(null, 'x'));
  check('bearer parsing', bearerToken('Bearer tok') === 'tok' && bearerToken('bearer tok') === 'tok' && bearerToken('Basic x') === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
