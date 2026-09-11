import 'server-only';
import { env } from '@/lib/env';
import { copyFor } from './copy';
import { buildEnvelope } from './envelope';
import type { Block } from './components';
import type { Envelope } from './service';

/**
 * Every template, rendered from fixtures.
 *
 * This module cannot send. It imports the renderers and the copy and nothing
 * else — no service, no transport, no admin client — so there is no code path
 * from a preview to an outbound message, and that is a property of the imports
 * rather than a flag somebody could flip.
 *
 * Three cases per template, because the three ways an email layout breaks are
 * all about content rather than code:
 *
 *   default — what it looks like on a normal day
 *   long    — a 90-character Arabic job title and a five-part company name,
 *             which is where a fixed-width table starts pushing the button off
 *             the right edge
 *   minimal — every optional field absent, which is where a layout that
 *             assumed a salary or a note renders an empty box
 */

export type PreviewCase = 'default' | 'long' | 'minimal';
export const PREVIEW_CASES: PreviewCase[] = ['default', 'long', 'minimal'];

type Fixture = { locale: 'ar' | 'en'; case: PreviewCase };

const SHORT = {
  ar: {
    job: 'مستشار عقاري أول',
    company: 'العاصمة للتطوير العقاري',
    name: 'أحمد محمود',
    note: 'خبرتك في التجاري قوية بس الدور ده primary.',
  },
  en: {
    job: 'Senior Property Consultant',
    company: 'Capital Developments',
    name: 'Ahmed Mahmoud',
    note: 'Strong commercial background, but this role is primary.',
  },
};

const LONG = {
  ar: {
    job: 'مستشار عقاري أول متخصص في السوق الأولي والمشروعات السكنية بالقاهرة الجديدة والعاصمة الإدارية',
    company: 'شركة العاصمة الكبرى للاستثمار والتطوير العقاري والإدارة المتكاملة للمشروعات',
    name: 'عبد الرحمن محمد عبد العزيز الشناوي',
    note: 'شكراً على وقتك. المقابلة كانت كويسة جداً والخبرة واضحة، بس الدور محتاج حد عنده تجربة أطول في السوق الأولي تحديداً مع مطوّرين بعينهم، وده اللي رجّح المرشح التاني في المرحلة الأخيرة.',
  },
  en: {
    job: 'Senior Property Consultant — Primary Market, New Cairo and the New Administrative Capital',
    company: 'Greater Capital Investment, Real Estate Development and Integrated Project Management',
    name: 'Abdelrahman Mohamed Abdelaziz El-Shennawy',
    note: 'Thank you for your time. The interview went well and the experience is clear, but the role needs someone with a longer track record in the primary market with specific developers, which is what decided it in the final stage.',
  },
};

function words(fixture: Fixture) {
  return fixture.case === 'long' ? LONG[fixture.locale] : SHORT[fixture.locale];
}

/** Present on `default`, absent on `minimal`. */
function optional<T>(fixture: Fixture, value: T): T | undefined {
  return fixture.case === 'minimal' ? undefined : value;
}

const DATE_AR = '12 مارس 2026';
const DATE_EN = '12 Mar 2026';

function day(fixture: Fixture) {
  return fixture.locale === 'ar' ? DATE_AR : DATE_EN;
}

type Builder = (fixture: Fixture) => { subject: string; preheader: string; heading: string; blocks: Block[] };

/**
 * One entry per template that this system sends. Kept in the same order as
 * notify.ts so a template added there without a preview is visible as a gap
 * rather than discovered in an inbox.
 */
const BUILDERS: Record<string, Builder> = {
  welcome_candidate: (f) => {
    const t = copyFor(f.locale).welcomeCandidate;
    return {
      subject: t.subject,
      preheader: t.preheader,
      heading: t.heading,
      blocks: [
        { kind: 'text', value: t.body },
        { kind: 'button', label: t.cta, href: `${env.siteUrl}/dashboard/profile` },
        { kind: 'text', value: t.hint },
      ],
    };
  },

  welcome_employer: (f) => {
    const t = copyFor(f.locale).welcomeEmployer;
    return {
      subject: t.subject,
      preheader: t.preheader,
      heading: t.heading,
      blocks: [
        { kind: 'text', value: t.body },
        { kind: 'button', label: t.cta, href: `${env.siteUrl}/employer/company` },
        { kind: 'text', value: t.hint },
      ],
    };
  },

  password_changed: (f) => {
    const t = copyFor(f.locale).passwordChanged;
    return {
      subject: t.subject,
      preheader: t.preheader,
      heading: t.heading,
      blocks: [
        { kind: 'text', value: t.body },
        { kind: 'facts', rows: [[t.labelWhen, `${day(f)} — 14:32`]] },
        { kind: 'button', label: t.cta, href: `${env.siteUrl}/dashboard/account`, variant: 'secondary' },
        { kind: 'security', value: t.security },
      ],
    };
  },

  profile_ready: (f) => {
    const c = copyFor(f.locale);
    const t = c.profileReady;
    return {
      subject: t.subject,
      preheader: t.preheader,
      heading: t.heading,
      blocks: [
        { kind: 'text', value: t.body },
        { kind: 'facts', rows: [[t.labelVisibility, c.visibilityChanged.visibility.public]] },
        { kind: 'button', label: t.cta, href: `${env.siteUrl}/agents/ahmed-mahmoud` },
      ],
    };
  },

  profile_incomplete: (f) => {
    const t = copyFor(f.locale).profileIncomplete;
    return {
      subject: t.subject,
      preheader: t.preheader,
      heading: t.heading,
      blocks: [
        { kind: 'text', value: t.body },
        { kind: 'button', label: t.cta, href: `${env.siteUrl}/dashboard/profile` },
        { kind: 'text', value: t.hint },
      ],
    };
  },

  visibility_changed: (f) => {
    const t = copyFor(f.locale).visibilityChanged;
    return {
      subject: t.subject,
      preheader: t.preheader,
      heading: t.heading,
      blocks: [
        { kind: 'text', value: t.body },
        { kind: 'facts', rows: [[t.labelVisibility, t.visibility.verified_employers_only]] },
        { kind: 'button', label: t.cta, href: `${env.siteUrl}/dashboard/account` },
        { kind: 'security', value: t.security },
      ],
    };
  },

  application_receipt: (f) => {
    const w = words(f);
    const t = copyFor(f.locale).applicationReceived;
    return {
      subject: t.subject(w.job),
      preheader: t.preheader,
      heading: t.heading,
      blocks: [
        { kind: 'text', value: t.body(w.job, w.company) },
        { kind: 'job', title: w.job, company: w.company, href: `${env.siteUrl}/jobs/example` },
        {
          kind: 'facts',
          rows: [
            [t.labelDate, day(f)],
            [t.labelRef, 'a3f91c04'],
          ],
        },
        { kind: 'button', label: t.cta, href: `${env.siteUrl}/dashboard/applications` },
        { kind: 'text', value: t.note },
      ],
    };
  },

  new_application: (f) => {
    const w = words(f);
    const t = copyFor(f.locale).newApplication;
    return {
      subject: t.subject(w.job),
      preheader: t.preheader,
      heading: t.heading,
      blocks: [
        { kind: 'text', value: t.body(w.name, w.job) },
        {
          kind: 'facts',
          rows: [
            [t.labelJob, w.job],
            [t.labelApplicant, w.name],
          ],
        },
        { kind: 'button', label: t.cta, href: `${env.siteUrl}/employer/applicants` },
      ],
    };
  },

  application_status: (f) => {
    const w = words(f);
    const c = copyFor(f.locale);
    const t = c.statusChanged;
    const note = optional(f, w.note);
    return {
      subject: t.subject(w.job),
      preheader: t.preheader,
      heading: t.heading,
      blocks: [
        { kind: 'text', value: t.body(w.job, w.company) },
        { kind: 'status', label: c.status.interview, tone: 'caution' },
        {
          kind: 'facts',
          rows: [
            [t.labelJob, w.job],
            [t.labelCompany, w.company],
          ],
        },
        ...(note ? [{ kind: 'text' as const, value: note }] : []),
        { kind: 'button', label: t.cta, href: `${env.siteUrl}/dashboard/applications` },
      ],
    };
  },

  application_rejected: (f) => {
    const w = words(f);
    const t = copyFor(f.locale).applicationRejected;
    const note = optional(f, w.note);
    return {
      subject: t.subject(w.job),
      preheader: t.preheader,
      heading: t.heading,
      blocks: [
        { kind: 'text', value: t.body(w.job, w.company) },
        ...(note ? [{ kind: 'text' as const, value: note }] : []),
        { kind: 'divider' },
        { kind: 'text', value: t.encouragement },
        { kind: 'button', label: t.cta, href: `${env.siteUrl}/jobs` },
      ],
    };
  },

  application_withdrawn: (f) => {
    const w = words(f);
    const t = copyFor(f.locale).applicationWithdrawn;
    return {
      subject: t.subject(w.job),
      preheader: t.preheader,
      heading: t.heading,
      blocks: [
        { kind: 'text', value: t.body(w.job) },
        { kind: 'facts', rows: [[t.labelJob, w.job]] },
        { kind: 'button', label: t.cta, href: `${env.siteUrl}/jobs` },
      ],
    };
  },

  job_submitted: (f) => {
    const w = words(f);
    const t = copyFor(f.locale).jobSubmitted;
    return {
      subject: t.subject(w.job),
      preheader: t.preheader,
      heading: t.heading,
      blocks: [
        { kind: 'text', value: t.body(w.job) },
        {
          kind: 'facts',
          rows: [
            [t.labelJob, w.job],
            [t.labelDate, day(f)],
            [t.labelStatus, t.statusPending],
          ],
        },
        { kind: 'button', label: t.cta, href: `${env.siteUrl}/employer/jobs` },
      ],
    };
  },

  job_approved: (f) => {
    const w = words(f);
    const t = copyFor(f.locale).jobApproved;
    const expires = optional(f, day(f));
    return {
      subject: t.subject(w.job),
      preheader: t.preheader,
      heading: t.heading,
      blocks: [
        { kind: 'text', value: t.body(w.job) },
        {
          kind: 'facts',
          rows: [
            [t.labelJob, w.job],
            [t.labelPublished, day(f)],
            ...(expires ? ([[t.labelExpires, expires]] as [string, string][]) : []),
          ],
        },
        { kind: 'button', label: t.cta, href: `${env.siteUrl}/jobs/example` },
      ],
    };
  },

  job_rejected: (f) => {
    const w = words(f);
    const t = copyFor(f.locale).jobRejected;
    const note = optional(f, w.note);
    return {
      subject: t.subject(w.job),
      preheader: t.preheader,
      heading: t.heading,
      blocks: [
        { kind: 'text', value: t.body(w.job) },
        ...(note ? [{ kind: 'text' as const, value: t.reason(note) }] : []),
        { kind: 'facts', rows: [[t.labelJob, w.job]] },
        { kind: 'button', label: t.cta, href: `${env.siteUrl}/employer/jobs` },
      ],
    };
  },

  job_expiring: (f) => {
    const w = words(f);
    const t = copyFor(f.locale).jobExpiring;
    return {
      subject: t.subject(w.job),
      preheader: t.preheader,
      heading: t.heading,
      blocks: [
        { kind: 'text', value: t.body(w.job, 3) },
        {
          kind: 'facts',
          rows: [
            [t.labelJob, w.job],
            [t.labelExpires, day(f)],
            [t.labelApplicants, '14'],
          ],
        },
        { kind: 'button', label: t.cta, href: `${env.siteUrl}/employer/jobs` },
      ],
    };
  },

  job_expired: (f) => {
    const w = words(f);
    const t = copyFor(f.locale).jobExpired;
    return {
      subject: t.subject(w.job),
      preheader: t.preheader,
      heading: t.heading,
      blocks: [
        { kind: 'text', value: t.body(w.job) },
        {
          kind: 'facts',
          rows: [
            [t.labelJob, w.job],
            [t.labelExpired, day(f)],
            [t.labelApplicants, '14'],
          ],
        },
        { kind: 'button', label: t.cta, href: `${env.siteUrl}/employer/jobs` },
      ],
    };
  },

  account_approved: (f) => {
    const t = copyFor(f.locale).accountApproved;
    return {
      subject: t.subject,
      preheader: t.preheader,
      heading: t.heading,
      blocks: [
        { kind: 'text', value: t.body },
        { kind: 'button', label: t.cta, href: `${env.siteUrl}/employer/jobs/new` },
      ],
    };
  },

  account_rejected: (f) => {
    const w = words(f);
    const t = copyFor(f.locale).accountRejected;
    const note = optional(f, w.note);
    return {
      subject: t.subject,
      preheader: t.preheader,
      heading: t.heading,
      blocks: [
        { kind: 'text', value: t.body },
        ...(note ? [{ kind: 'text' as const, value: t.reason(note) }] : []),
        { kind: 'security', value: t.contact },
      ],
    };
  },

  company_verified: (f) => {
    const w = words(f);
    const t = copyFor(f.locale).companyVerified;
    return {
      subject: t.subject,
      preheader: t.preheader,
      heading: t.heading,
      blocks: [
        { kind: 'text', value: t.body(w.company) },
        {
          kind: 'company',
          name: w.company,
          logoUrl: optional(f, `${env.siteUrl}/brand/logo-mark.png`),
          href: `${env.siteUrl}/companies/example`,
        },
        { kind: 'button', label: t.cta, href: `${env.siteUrl}/companies/example` },
      ],
    };
  },

  company_verification_needed: (f) => {
    const w = words(f);
    const t = copyFor(f.locale).companyVerificationNeeded;
    const note = optional(f, w.note);
    return {
      subject: t.subject,
      preheader: t.preheader,
      heading: t.heading,
      blocks: [
        { kind: 'text', value: t.body(w.company) },
        { kind: 'company', name: w.company, href: `${env.siteUrl}/companies/example` },
        ...(note ? [{ kind: 'text' as const, value: t.reason(note) }] : []),
        { kind: 'button', label: t.cta, href: `${env.siteUrl}/employer/company` },
      ],
    };
  },

  saved_search_digest: (f) => {
    const w = words(f);
    const t = copyFor(f.locale).digest;
    const label = f.locale === 'ar' ? 'primary في التجمع' : 'Primary in Tagamoa';
    const meta = optional(f, [
      f.locale === 'ar' ? 'التجمع الخامس' : 'Fifth Settlement',
      f.locale === 'ar' ? 'دوام كامل' : 'Full time',
      f.locale === 'ar' ? '12,000 – 18,000 ج.م' : 'EGP 12,000 – 18,000',
    ]);
    return {
      subject: t.subject(3, label),
      preheader: t.preheader,
      heading: t.heading,
      blocks: [
        { kind: 'text', value: t.body(label) },
        { kind: 'job', title: w.job, company: w.company, meta, href: `${env.siteUrl}/jobs/a` },
        { kind: 'job', title: SHORT[f.locale].job, company: SHORT[f.locale].company, meta, href: `${env.siteUrl}/jobs/b` },
        { kind: 'button', label: t.cta, href: `${env.siteUrl}/jobs` },
      ],
    };
  },

  /*
    The same template, sent with different words.

    A follow and a saved search are one row, one weekly job and one outbox
    template — so `deliver()` still stamps this `saved_search_digest`, which is
    what the dedupe key and the outbox entity are built on. But it is a
    distinct rendering, chosen from the stored query, and a preview that showed
    only one of the two wordings would leave half of what this template can
    send unlooked-at. Which is the whole point of this file.
  */
  company_follow_digest: (f) => {
    const w = words(f);
    const t = copyFor(f.locale).follow;
    const label = f.locale === 'ar' ? 'نايل بروكرز' : 'Nile Brokers';
    const meta = optional(f, [
      f.locale === 'ar' ? 'المعادي' : 'Maadi',
      f.locale === 'ar' ? 'دوام كامل' : 'Full time',
      f.locale === 'ar' ? '8,000 – 11,000 ج.م' : 'EGP 8,000 – 11,000',
    ]);
    return {
      subject: t.subject(2, label),
      preheader: t.preheader,
      heading: t.heading,
      blocks: [
        { kind: 'text', value: t.body(label) },
        { kind: 'job', title: w.job, company: label, meta, href: `${env.siteUrl}/jobs/a` },
        { kind: 'job', title: SHORT[f.locale].job, company: label, meta, href: `${env.siteUrl}/jobs/b` },
        { kind: 'button', label: t.cta, href: `${env.siteUrl}/jobs?company=nile-brokers-410256` },
      ],
    };
  },

  applicant_digest: (f) => {
    const w = words(f);
    const t = copyFor(f.locale).applicantDigest;
    return {
      subject: t.subject(7),
      preheader: t.preheader,
      heading: t.heading,
      blocks: [
        { kind: 'text', value: t.body(7) },
        { kind: 'job', title: w.job, company: w.company, href: `${env.siteUrl}/employer/jobs` },
        { kind: 'button', label: t.cta, href: `${env.siteUrl}/employer/applicants` },
      ],
    };
  },
};

export const PREVIEW_TEMPLATES = Object.keys(BUILDERS).sort();

/**
 * Which templates carry an unsubscribe link — the same split the live code
 * makes, restated here so the preview shows the real footer rather than a
 * plausible one.
 */
const OPTIONAL_TEMPLATES = new Set([
  'new_application',
  'application_status',
  'application_rejected',
  'job_approved',
  'job_rejected',
  'job_expiring',
  'job_expired',
  'saved_search_digest',
  'company_follow_digest',
  'applicant_digest',
  'profile_incomplete',
]);

export function renderPreview(
  template: string,
  locale: 'ar' | 'en',
  variant: PreviewCase,
): Envelope | null {
  const build = BUILDERS[template];
  if (!build) return null;

  const parts = build({ locale, case: variant });

  return buildEnvelope({
    audience: {
      locale,
      unsubscribe: OPTIONAL_TEMPLATES.has(template)
        ? `${env.siteUrl}/unsubscribe?token=preview-token&kind=notify_status`
        : undefined,
    },
    ...parts,
  });
}
