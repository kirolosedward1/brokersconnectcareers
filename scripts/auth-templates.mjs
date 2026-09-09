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
const URL_VARIABLES = {
  'https://gotrue.invalid/confirmation-url': '{{ .ConfirmationURL }}',
};

function substitute(html) {
  let out = html;
  for (const [placeholder, variable] of Object.entries(URL_VARIABLES)) {
    out = out.split(placeholder).join(variable);
  }
  return out;
}

const CONFIRMATION_URL = 'https://gotrue.invalid/confirmation-url';

/** Arabic only. Supabase stores one template per email type, not one per language. */
const LOCALE = 'ar';
const DIR = 'rtl';

const footer = {
  automated: c.footer.automated,
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
    preheader: 'خطوة واحدة وحسابك يشتغل.',
    heading: 'أكّد بريدك الإلكتروني',
    blocks: [
      {
        kind: 'text',
        value:
          'أهلاً بيك في بروكرز كونكت. اضغط الزرار عشان نتأكد إن البريد ده بتاعك ونفعّل الحساب.',
      },
      { kind: 'button', label: 'تأكيد البريد الإلكتروني', href: CONFIRMATION_URL },
      {
        kind: 'text',
        value: 'اللينك ده صالح لمدة 24 ساعة، وبيشتغل مرة واحدة بس.',
      },
      {
        kind: 'security',
        value:
          'لو مش إنت اللي عملت الحساب، ما تعملش حاجة — الحساب مش هيتفعّل من غير التأكيد ده.',
      },
    ],
  },

  recovery: {
    file: 'recovery.html',
    subject: 'إعادة تعيين كلمة المرور',
    preheader: 'لينك لإعادة تعيين كلمة المرور.',
    heading: 'إعادة تعيين كلمة المرور',
    blocks: [
      {
        kind: 'text',
        value: 'وصلنا طلب لإعادة تعيين كلمة المرور بتاعت حسابك. اضغط الزرار عشان تحطّ واحدة جديدة.',
      },
      { kind: 'button', label: 'إعادة تعيين كلمة المرور', href: CONFIRMATION_URL },
      { kind: 'text', value: 'اللينك ده صالح لمدة ساعة، وبيشتغل مرة واحدة بس.' },
      {
        kind: 'security',
        value:
          'لو مش إنت اللي طلبت ده، تجاهل الرسالة. كلمة المرور بتاعتك ما اتغيرتش، والحساب زي ما هو.',
      },
    ],
  },

  email_change: {
    file: 'email-change.html',
    subject: 'أكّد بريدك الإلكتروني الجديد',
    preheader: 'تأكيد تغيير البريد على حسابك.',
    heading: 'أكّد البريد الجديد',
    blocks: [
      {
        kind: 'text',
        value: 'طلبت تغيير البريد الإلكتروني بتاع حسابك. اضغط الزرار عشان نأكّد العنوان الجديد.',
      },
      { kind: 'facts', rows: [['البريد الجديد', '{{ .NewEmail }}']] },
      { kind: 'button', label: 'تأكيد البريد الجديد', href: CONFIRMATION_URL },
      {
        kind: 'security',
        value:
          'لو مش إنت اللي طلبت ده، غيّر كلمة المرور بتاعتك فوراً — حد تاني يمكن يكون داخل على حسابك.',
      },
    ],
  },

  reauthentication: {
    file: 'reauthentication.html',
    subject: 'كود تأكيد الهوية',
    preheader: 'كود لتأكيد إنك إنت.',
    heading: 'كود التأكيد',
    blocks: [
      { kind: 'text', value: 'استخدم الكود ده عشان تكمّل العملية اللي بدأتها على حسابك.' },
      { kind: 'facts', rows: [['الكود', '{{ .Token }}']] },
      { kind: 'text', value: 'الكود صالح لمدة ساعة.' },
      {
        kind: 'security',
        value: 'لو مش إنت اللي طلبت الكود ده، غيّر كلمة المرور بتاعتك فوراً.',
      },
    ],
  },

  magic_link: {
    file: 'magic-link.html',
    subject: 'لينك الدخول لحسابك',
    preheader: 'لينك دخول لمرة واحدة.',
    heading: 'ادخل على حسابك',
    blocks: [
      { kind: 'text', value: 'اضغط الزرار عشان تدخل على حسابك من غير كلمة مرور.' },
      { kind: 'button', label: 'ادخل على حسابك', href: CONFIRMATION_URL },
      { kind: 'text', value: 'اللينك ده صالح لمدة ساعة، وبيشتغل مرة واحدة بس.' },
      {
        kind: 'security',
        value: 'لو مش إنت اللي طلبت اللينك ده، تجاهل الرسالة ومحدش هيقدر يدخل.',
      },
    ],
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
  const source = JSON.stringify(TEMPLATES[item.name].blocks);
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
