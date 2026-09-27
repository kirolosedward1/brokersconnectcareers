/**
 * What is taken out of anything the platform writes down about a failure.
 *
 * The rule observe.ts states for server logs — identifiers, never content —
 * applied mechanically, because error text is written by other people's code.
 * A Resend error names the recipient, a Supabase signed URL carries its token
 * in the query string, a browser TypeError can quote a CV's file name, and
 * GoTrue's messages quote the address that was refused. None of that is
 * needed to find a bug; all of it would turn the error store into a second
 * copy of the people on the platform.
 *
 * Isomorphic and pure: the browser scrubs before it sends, and the server
 * scrubs again on arrival, because nothing a browser sends is trusted.
 *
 * No lookbehind in any pattern. Safari before 16.4 refuses to compile one, and
 * a SyntaxError in this module would take the whole client reporter with it on
 * exactly the old phones that produce the most client errors.
 */

const URL_WITH_QUERY = /(https?:\/\/[^\s?#"'<>()]+)[?#][^\s"'<>()]*/g;
const STORAGE_PATH = /(\/storage\/v1\/object\/(?:sign\/|public\/|authenticated\/|upload\/sign\/)?[\w-]+)\/[^\s?#"'<>()]+/g;
const JWT = /\beyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]{5,}/g;
const AUTH_HEADER = /\b(bearer|basic|token)\s+[\w.~+/=-]{8,}/gi;
const KNOWN_SECRET =
  /\b(?:sb_(?:secret|publishable)_[\w-]{6,}|re_[A-Za-z0-9_]{16,}|whsec_[\w+/=]{8,}|sk_(?:live|test)_\w{6,}|gh[pousr]_\w{16,}|xox[abprs]-[\w-]{8,})/g;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const FILE_NAME = /[^\s/\\"'<>()]+\.(?:pdf|docx?|rtf|odt|png|jpe?g|webp|gif|heic|heif|svg)\b/gi;
/** Long opaque runs: base64 blobs, hex keys, signatures. A UUID (36) is shorter. */
const LONG_OPAQUE = /\b[A-Za-z0-9_+/-]{40,}={0,2}/g;
/**
 * Nine or more digits, optionally split by single separators: every Egyptian
 * mobile number in any of the ways people write one, and international ones.
 * A date (eight digits) survives; so do ports, status codes and line numbers.
 */
const LONG_NUMBER = /(^|[^\w-])\+?\d(?:[\s().-]?\d){8,}(?![\w-])/g;

export function scrubText(value: unknown, max = 500): string {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'string' ? value : String(value);

  text = text
    .replace(URL_WITH_QUERY, '$1?<redacted>')
    .replace(STORAGE_PATH, '$1/<path>')
    .replace(JWT, '<token>')
    .replace(AUTH_HEADER, '$1 <token>')
    .replace(KNOWN_SECRET, '<secret>')
    .replace(EMAIL, '<email>')
    .replace(FILE_NAME, '<file>')
    .replace(LONG_OPAQUE, '<secret>')
    .replace(LONG_NUMBER, '$1<number>')
    .replace(/\s+/g, ' ')
    .trim();

  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Detail keys that name content rather than an identifier.
 *
 * Matched on the words a key is made of, so `candidate` and `job` survive
 * while `full_name`, `whatsappPhone`, `cvPath` and `dedupe_key` do not. A
 * caller who passes one of these has made a mistake; dropping it here means
 * the mistake costs a field in a log line rather than a person's number in
 * somebody's inbox.
 */
const SENSITIVE_WORDS = new Set([
  'password', 'passwd', 'pass', 'secret', 'token', 'authorization', 'cookie',
  'session', 'apikey', 'key', 'email', 'mail', 'phone', 'whatsapp', 'mobile',
  'name', 'fullname', 'body', 'note', 'notes', 'message', 'text', 'content',
  'comment', 'cv', 'resume', 'path', 'file', 'filename', 'address', 'ip',
  'query', 'search', 'q', 'otp', 'verifier', 'signature', 'salt',
]);

function words(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function isSensitiveKey(key: string): boolean {
  return words(key).some((word) => SENSITIVE_WORDS.has(word));
}

export type Detail = Record<string, string | number | boolean>;

/**
 * Scalars only, sensitive keys dropped, every string scrubbed and short.
 * Sixteen keys at most: a detail object is a handful of identifiers, and one
 * that is not is a bug worth truncating rather than storing.
 */
export function scrubDetail(detail: Record<string, unknown> | undefined | null): Detail {
  const out: Detail = {};
  if (!detail || typeof detail !== 'object') return out;

  for (const [key, value] of Object.entries(detail)) {
    if (Object.keys(out).length >= 16) break;
    if (value === null || value === undefined || value === '') continue;
    const safeKey = key.replace(/[^\w.-]/g, '').slice(0, 40);
    if (!safeKey || isSensitiveKey(safeKey)) continue;

    if (typeof value === 'number') {
      if (Number.isFinite(value)) out[safeKey] = value;
    } else if (typeof value === 'boolean') {
      out[safeKey] = value;
    } else if (typeof value === 'string') {
      out[safeKey] = scrubText(value, 120);
    }
  }
  return out;
}

/**
 * A pathname reduced to its shape.
 *
 * Grouping needs `/jobs/:param` rather than one row per listing, and privacy
 * needs it too: a consultant's profile handle is the person. Known literal
 * segments are kept so the shape stays readable; everything else — slugs,
 * ids, anything a bot invents — becomes `:param`. The locale prefix is
 * dropped: Arabic and English are the same route.
 */
const LITERAL_SEGMENTS = new Set([
  'jobs', 'companies', 'agents', 'blog', 'employers', 'privacy', 'terms',
  'unsubscribe', 'onboarding', 'notifications', 'sign-in', 'sign-up', 'forgot',
  'new-password', 'candidate', 'employer', 'dashboard', 'account',
  'applications', 'profile', 'saved', 'billing', 'company', 'talent',
  'applicants', 'new', 'edit', 'apply', 'admin', 'users', 'reports', 'email',
  'system', 'operations', 'security', 'auth', 'callback', 'api', 'cron',
  'health', 'telemetry', 'cv', 'preview', 'webhook', 'export',
]);

export function normalizeRoute(pathname: string | null | undefined): string {
  if (!pathname) return '/';
  let path = String(pathname);
  try {
    if (/^https?:\/\//i.test(path)) path = new URL(path).pathname;
  } catch {
    return '/';
  }
  path = path.split(/[?#]/)[0] ?? '/';

  const segments = path.split('/').filter(Boolean).slice(0, 8);
  if (segments[0] === 'ar' || segments[0] === 'en') segments.shift();

  const shaped = segments.map((segment) =>
    LITERAL_SEGMENTS.has(segment.toLowerCase()) ? segment.toLowerCase() : ':param',
  );
  return `/${shaped.join('/')}`;
}

/**
 * Next's route pattern, made readable: `/[locale]/(site)/jobs/[slug]` becomes
 * `/jobs/[slug]`. Already a pattern, so nothing identifying survives in it.
 */
export function cleanRoutePattern(pattern: string | null | undefined): string {
  if (!pattern) return '/';
  const cleaned = String(pattern)
    .split('/')
    .filter((segment) => segment && segment !== '[locale]' && !/^\(.*\)$/.test(segment))
    .join('/');
  return `/${cleaned}`.slice(0, 120);
}
