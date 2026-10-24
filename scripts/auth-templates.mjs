/**
 * Generates the Supabase Auth email templates.
 *
 * Verification and password reset are not sent by this application — GoTrue
 * sends them, from templates stored in the Supabase project. Left at their
 * defaults they arrive in English, left to right, unbranded, on the two
 * messages every account depends on: the one that lets somebody finish signing
 * up, and the one that lets them back in.
 *
 * So they are generated here from the same components and the same copy as
 * every other message, rather than hand-written into a dashboard field where
 * they would drift from the design the moment either changed. Run:
 *
 *   node --experimental-strip-types scripts/auth-templates.mjs
 *
 * The output goes to supabase/templates/*.html. Those files are the source of
 * truth for what should be pasted into
 * Authentication -> Emails -> Templates, and config.toml points the local
 * stack at the same files.
 *
 * GoTrue substitutes Go template variables — {{ .ConfirmationURL }} and the
 * rest — after this HTML is written. Text variables pass through the block
 * builders as ordinary strings, because they contain no character the escaper
 * touches.
 *
 * URLs cannot. safeHref() refuses anything that is not plainly http, https or
 * mailto, which is exactly right for a job title somebody typed and exactly
 * wrong for `{{ .ConfirmationURL }}` — it became `#`, and every confirmation
 * button in the first generated set linked nowhere. So the templates are
 * rendered with a real placeholder URL that satisfies the guard, and the
 * placeholder is swapped for the variable afterwards. The guard stays as
 * strict as the running application needs it to be, and the check at the
 * bottom is what turned this from a shipped bug into a failed script.
 *
 * The links go to /auth/confirm with the token hash, not to GoTrue's own
 * {{ .ConfirmationURL }}. That URL ends in the code flow, which only works in
 * the browser that asked for the email; a token hash verifies wherever the
 * link is opened — on the phone after signing up on a laptop, or in the iOS
 * app, which opens /auth/confirm as a universal link.
 *
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=<type>&next=<path>&redirect_to={{ .RedirectTo }}
 *
 * `next` is a path on this site, used when the form asked for nothing more
 * specific. `redirect_to` comes last because it is a whole URL of its own
 * (src/lib/auth/confirm-link.ts reads it as the rest of the string) and, when
 * it names a path, it wins over `next` — it carries the door's role and the
 * page the person was opening. Deploy /auth/confirm before pasting these, and
 * send one test email to see the link arrive whole.
 *
 * The Arabic is Modern Standard Arabic, the same wording the other emails
 * use. An English copy sits under it. Every link and the reauthentication
 * code say one hour, matching Email OTP expiration (3600 seconds).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderEmail } from '../src/lib/email/components.ts';
import { emailCopy } from '../src/lib/email/copy.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'supabase/templates');

// Read from the environment so a self-hosted or staging project generates its
// own links, and never so a localhost URL can reach a production inbox.
const SITE = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.brokersconnect.net').replace(/\/$/, '');

// These files get pasted into a production dashboard. A developer with a
// localhost NEXT_PUBLIC_SITE_URL in their shell would otherwise generate a set
// whose logo and legal links point at their own machine, and nothing about the
// output would say so. Refuse instead, and say how to mean it.
if (/^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(SITE) && !process.argv.includes('--allow-localhost')) {
  console.error(
    `Refusing to generate: NEXT_PUBLIC_SITE_URL is ${SITE}.\n` +
      'These templates are pasted into the live Supabase project, and localhost links\n' +
      'in a real inbox are dead links. Unset it to use the production URL, or pass\n' +
      '--allow-localhost if you are deliberately generating for a local stack.',
  );
  process.exit(1);
}

const c = emailCopy.ar;

/**
 * Stand-ins that satisfy safeHref, swapped for GoTrue's variables after
 * rendering. `.invalid` is reserved by RFC 2606 and can never resolve, so a
 * placeholder that somehow escaped substitution would fail loudly rather than
 * reaching somebody's DNS.
 */
/**
 * A link to /auth/confirm for one type of email, with GoTrue's variables in it.
 *
 * `next` is a path. It is not encoded: these paths have no `&` of their own,
 * and encoding the slashes would make the line pasted into the dashboard
 * harder to read. `redirect_to` stays last.
 */
const confirmLink = (type, next) =>
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=${type}&amp;next=${next}&amp;redirect_to={{ .RedirectTo }}`;

const URL_VARIABLES = {
  // `email` covers both a sign-up confirmation and a magic link, as verifyOtp
  // names them; the older `signup` and `magiclink` still verify too. No
  // placeholder may begin with another, or the shorter replaces inside the
  // longer — /confirm/email once did, inside /confirm/email_change.
  // The two `email` links differ by `next`, so they cannot share a placeholder.
  'https://gotrue.invalid/confirm/signup': confirmLink('email', '/onboarding'),
  'https://gotrue.invalid/confirm/magic': confirmLink('email', '/'),
  'https://gotrue.invalid/confirm/recovery': confirmLink('recovery', '/sign-in/new-password'),
  'https://gotrue.invalid/confirm/new-address': confirmLink('email_change', '/dashboard/account'),
};

function substitute(html) {
  let out = html;
  for (const [placeholder, variable] of Object.entries(URL_VARIABLES)) {
    out = out.split(placeholder).join(variable);
  }
  return out;
}

const CONFIRM_SIGNUP = 'https://gotrue.invalid/confirm/signup';
const CONFIRM_MAGIC = 'https://gotrue.invalid/confirm/magic';
const CONFIRM_RECOVERY = 'https://gotrue.invalid/confirm/recovery';
const CONFIRM_EMAIL_CHANGE = 'https://gotrue.invalid/confirm/new-address';

/** Under the button, for a client that does not draw it. */
const PLAIN_AR = 'إذا لم يظهر الزر، فافتح هذا الرابط في المتصفح:';
const PLAIN_EN = 'If the button does not appear, open this link in your browser:';

/** The document is Arabic and right to left. English is a second section, not a second file. */
const LOCALE = 'ar';
const DIR = 'rtl';

// Auth mail has no Reply-To, so the footer only offers the address. It is
// hardcoded because these files are pasted into the dashboard as they are.
const AUTH_SUPPORT = 'info@topsuite.net';

const footer = {
  contact: { lead: 'هل تحتاج إلى مساعدة؟ راسلنا على', email: AUTH_SUPPORT },
  contactEn: { lead: 'Need help? Write to', email: AUTH_SUPPORT },
  reason: c.footer.reasonAccount,
  legal: [
    { label: c.footer.privacy, href: `${SITE}/privacy` },
    { label: c.footer.terms, href: `${SITE}/terms` },
  ],
  // No unsubscribe. There is nothing to unsubscribe from on a password reset,
  // and offering one that would be ignored is worse than offering none.
};

/**
 * The copy for these five lives here rather than in copy.ts because nothing in
 * the application sends them — they belong to the auth provider, and putting
 * them beside the templates the app does send would suggest otherwise.
 */
const TEMPLATES = {
  confirmation: {
    file: 'confirmation.html',
    subject: 'أكّد بريدك الإلكتروني في بروكرز كونكت',
    preheader: 'خطوة واحدة ويُفعَّل حسابك.',
    heading: 'أكّد بريدك الإلكتروني',
    blocks: [
      {
        kind: 'text',
        value:
          'أهلاً بك في بروكرز كونكت. اضغط الزر لنتأكد أن هذا البريد لك ونُفعّل الحساب.',
      },
      { kind: 'button', label: 'تأكيد البريد الإلكتروني', href: CONFIRM_SIGNUP, plain: PLAIN_AR },
      {
        kind: 'text',
        value: 'هذا الرابط صالح لمدة ساعة واحدة، ويعمل مرة واحدة فقط.',
      },
      {
        kind: 'security',
        value:
          'إذا لم تكن أنت من أنشأ الحساب، فلا تفعل شيئاً — لن يُفعَّل الحساب من دون هذا التأكيد.',
      },
    ],
    english: {
      heading: 'Confirm your email',
      blocks: [
        {
          kind: 'text',
          value:
            'Welcome to Brokers Connect. Press the button so we can make sure this email is yours and activate the account.',
        },
        { kind: 'button', label: 'Confirm your email', href: CONFIRM_SIGNUP, plain: PLAIN_EN },
        { kind: 'text', value: 'This link is valid for one hour, and it works only once.' },
        {
          kind: 'security',
          value:
            'If you did not create the account, do nothing — it will not be activated without this confirmation.',
        },
      ],
    },
  },

  recovery: {
    file: 'recovery.html',
    subject: 'إعادة تعيين كلمة المرور',
    preheader: 'رابط لإعادة تعيين كلمة المرور.',
    heading: 'إعادة تعيين كلمة المرور',
    blocks: [
      {
        kind: 'text',
        value: 'وصلنا طلباً لإعادة تعيين كلمة المرور الخاصة بحسابك. اضغط الزر لتعيين كلمة جديدة.',
      },
      { kind: 'button', label: 'إعادة تعيين كلمة المرور', href: CONFIRM_RECOVERY, plain: PLAIN_AR },
      { kind: 'text', value: 'هذا الرابط صالح لمدة ساعة، ويعمل مرة واحدة فقط.' },
      {
        kind: 'security',
        value:
          'إذا لم تكن أنت من طلب ذلك، فتجاهل هذه الرسالة. لم تتغيّر كلمة المرور، والحساب على حاله.',
      },
    ],
    english: {
      heading: 'Reset your password',
      blocks: [
        {
          kind: 'text',
          value: 'We received a request to reset the password on your account. Press the button to set a new one.',
        },
        { kind: 'button', label: 'Reset your password', href: CONFIRM_RECOVERY, plain: PLAIN_EN },
        { kind: 'text', value: 'This link is valid for one hour, and it works only once.' },
        {
          kind: 'security',
          value: 'If you did not ask for this, ignore the message. Your password has not changed.',
        },
      ],
    },
  },

  email_change: {
    file: 'email-change.html',
    subject: 'أكّد بريدك الإلكتروني الجديد',
    preheader: 'تأكيد تغيير البريد على حسابك.',
    heading: 'أكّد البريد الجديد',
    blocks: [
      {
        kind: 'text',
        value: 'طلبت تغيير البريد الإلكتروني الخاص بحسابك. اضغط الزر لتأكيد العنوان الجديد.',
      },
      { kind: 'facts', rows: [['البريد الجديد', '{{ .NewEmail }}']] },
      { kind: 'button', label: 'تأكيد البريد الجديد', href: CONFIRM_EMAIL_CHANGE, plain: PLAIN_AR },
      {
        kind: 'security',
        value:
          'إذا لم تكن أنت من طلب ذلك، فغيّر كلمة المرور فوراً — قد يكون شخص آخر داخل حسابك.',
      },
    ],
    english: {
      heading: 'Confirm the new email',
      blocks: [
        {
          kind: 'text',
          value: 'You asked to change the email on your account. Press the button to confirm the new address.',
        },
        { kind: 'facts', rows: [['New email', '{{ .NewEmail }}']] },
        { kind: 'button', label: 'Confirm the new email', href: CONFIRM_EMAIL_CHANGE, plain: PLAIN_EN },
        {
          kind: 'security',
          value:
            'If you did not ask for this, change your password immediately — someone else may be in your account.',
        },
      ],
    },
  },

  reauthentication: {
    file: 'reauthentication.html',
    subject: 'رمز تأكيد الهوية',
    preheader: 'رمز للتأكد من هويتك.',
    heading: 'رمز التأكيد',
    blocks: [
      { kind: 'text', value: 'استخدم هذا الرمز لإكمال العملية التي بدأتها في حسابك.' },
      { kind: 'facts', rows: [['الرمز', '{{ .Token }}']] },
      { kind: 'text', value: 'الرمز صالح لمدة ساعة.' },
      {
        kind: 'security',
        value: 'إذا لم تكن أنت من طلب هذا الرمز، فغيّر كلمة المرور فوراً.',
      },
    ],
    english: {
      heading: 'Confirmation code',
      blocks: [
        { kind: 'text', value: 'Use this code to finish what you started on your account.' },
        { kind: 'facts', rows: [['Code', '{{ .Token }}']] },
        { kind: 'text', value: 'The code is valid for one hour.' },
        {
          kind: 'security',
          value: 'If you did not ask for this code, change your password immediately.',
        },
      ],
    },
  },

  magic_link: {
    file: 'magic-link.html',
    subject: 'رابط الدخول إلى حسابك',
    preheader: 'رابط دخول لمرة واحدة.',
    heading: 'ادخل إلى حسابك',
    blocks: [
      { kind: 'text', value: 'اضغط الزر للدخول إلى حسابك من دون كلمة مرور.' },
      { kind: 'button', label: 'ادخل إلى حسابك', href: CONFIRM_MAGIC, plain: PLAIN_AR },
      { kind: 'text', value: 'هذا الرابط صالح لمدة ساعة، ويعمل مرة واحدة فقط.' },
      {
        kind: 'security',
        value: 'إذا لم تكن أنت من طلب هذا الرابط، فتجاهل هذه الرسالة. لن يتمكّن أحد من الدخول.',
      },
    ],
    english: {
      heading: 'Sign in to your account',
      blocks: [
        { kind: 'text', value: 'Press the button to sign in to your account without a password.' },
        { kind: 'button', label: 'Sign in', href: CONFIRM_MAGIC, plain: PLAIN_EN },
        { kind: 'text', value: 'This link is valid for one hour, and it works only once.' },
        {
          kind: 'security',
          value: 'If you did not ask for this link, ignore the message and nobody can sign in.',
        },
      ],
    },
  },
};

mkdirSync(OUT, { recursive: true });

const written = [];
for (const [name, template] of Object.entries(TEMPLATES)) {
  const html = renderEmail({
    locale: LOCALE,
    dir: DIR,
    siteName: c.siteName,
    logoUrl: `${SITE}/brand/logo-ar.png`,
    preheader: template.preheader,
    heading: template.heading,
    blocks: template.blocks,
    footer,
    appearance: 'auth',
    alternate: template.english,
  });

  const final = substitute(html);
  writeFileSync(join(OUT, template.file), final + '\n');
  written.push({ name, file: template.file, subject: template.subject, html: final });
}

// The escaper must leave GoTrue's variables alone. A single escaped brace here
// means a confirmation link that renders as literal text — a signup nobody can
// complete, discovered by users rather than by this line.
let broken = 0;
for (const item of written) {
  const source = JSON.stringify({ blocks: TEMPLATES[item.name].blocks, english: TEMPLATES[item.name].english });
  const expected = [
    ...[...source.matchAll(/{{ \.\w+ }}/g)].map((match) => match[0]),
    // The URL placeholders must have become variables, and none may remain.
    ...Object.entries(URL_VARIABLES)
      .filter(([placeholder]) => source.includes(placeholder))
      .map(([, variable]) => variable),
  ];
  for (const variable of new Set(expected)) {
    if (!item.html.includes(variable)) {
      console.error(`  BROKEN  ${item.file}: ${variable} did not survive rendering`);
      broken += 1;
    }
  }

  for (const placeholder of Object.keys(URL_VARIABLES)) {
    if (item.html.includes(placeholder)) {
      console.error(`  BROKEN  ${item.file}: ${placeholder} was never substituted`);
      broken += 1;
    }
  }
}

// Every link-carrying template sends people to /auth/confirm, with the token
// hash, a same-origin next, and redirect_to as the last parameter — the route
// reads redirect_to as the rest of the string, so anything after it would be
// read as part of it.
const DESIGN = [
  'color-scheme: light dark',
  'prefers-color-scheme: dark',
  '#111827',
  '#E5E7EB',
  '#5B6475',
  '#E3E7EF',
  'bc-logo',
  'font-size:13px;text-decoration:underline',
];
for (const item of written) {
  for (const needle of DESIGN) {
    if (!item.html.includes(needle)) {
      console.error(`  BROKEN  ${item.file}: missing ${needle}`);
      broken += 1;
    }
  }
  if (!item.html.includes('lang="en"')) {
    console.error(`  BROKEN  ${item.file}: no English section`);
    broken += 1;
  }

  const hrefs = [...item.html.matchAll(/href="([^"]*auth\/confirm[^"]*)"/g)].map((match) => match[1]);
  if (item.name === 'reauthentication') continue; // a code, not a link
  if (!hrefs.length) {
    console.error(`  BROKEN  ${item.file}: no /auth/confirm link`);
    broken += 1;
  }
  if (!item.html.includes(PLAIN_AR) || !item.html.includes(PLAIN_EN)) {
    console.error(`  BROKEN  ${item.file}: no plain-text fallback link`);
    broken += 1;
  }
  for (const href of hrefs) {
    if (
      !href.startsWith('{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}') ||
      !href.includes('&amp;type=') ||
      !href.includes('&amp;next=') ||
      !href.endsWith('redirect_to={{ .RedirectTo }}')
    ) {
      console.error(`  BROKEN  ${item.file}: ${href} is not SiteURL / token_hash / type / next / redirect_to last`);
      broken += 1;
    }
  }
}

if (!written.find((item) => item.name === 'confirmation')?.html.includes('هذا الرابط صالح لمدة ساعة واحدة، ويعمل مرة واحدة فقط.')) {
  console.error('  BROKEN  confirmation.html: the expiry does not say one hour');
  broken += 1;
}

console.log(`\nWrote ${written.length} Supabase Auth templates to supabase/templates/\n`);
for (const item of written) {
  console.log(`  ${item.file.padEnd(24)} ${item.subject}`);
}

if (broken) {
  console.error(`\n${broken} template variable(s) were mangled — do not upload these.`);
  process.exitCode = 1;
} else {
  console.log('\nAll GoTrue variables survived rendering.');
  console.log('Paste each into Authentication -> Emails -> Templates, with the subject above.');
}
