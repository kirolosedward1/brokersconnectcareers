import 'server-only';
import type { ApplicationStatus } from '@/lib/supabase/database.types';

/**
 * Email copy, deliberately not in messages/*.json.
 *
 * next-intl hands the message bundle to the client provider, so anything added
 * there ships to every browser. Email copy is read by nobody in a browser —
 * putting it in the bundle would send four templates' worth of strings to
 * every visitor to pay for text only the mail server ever sees.
 *
 * Egyptian dialect on the Arabic side, matching the rest of the product.
 */

type Locale = 'ar' | 'en';

export const emailCopy = {
  ar: {
    siteName: 'بروكرز كونكت',
    footerNote: 'وصلتك الرسالة دي لأنك مسجّل في بروكرز كونكت.',
    unsubscribe: 'وقّف الإشعارات دي',

    applicationReceived: {
      subject: (job: string) => `وصل طلبك على ${job}`,
      preheader: 'استلمنا طلبك.',
      heading: 'استلمنا طلبك',
      body: (job: string, company: string) =>
        `بعتنا طلبك على وظيفة «${job}» لشركة ${company}. الشركة هتشوفه وتردّ من خلال المنصة، وهنبلّغك أول ما يتحرّك.`,
      cta: 'تابع طلباتك',
      labelJob: 'الوظيفة',
      labelCompany: 'الشركة',
    },

    newApplication: {
      subject: (job: string) => `متقدم جديد على ${job}`,
      preheader: 'حد قدّم على وظيفة عندك.',
      heading: 'وصلك متقدم جديد',
      body: (name: string, job: string) => `${name} قدّم على وظيفة «${job}».`,
      cta: 'شوف المتقدمين',
      labelJob: 'الوظيفة',
      labelApplicant: 'المتقدم',
      labelExperience: 'الخبرة',
    },

    statusChanged: {
      subject: (job: string) => `تحديث على طلبك في ${job}`,
      preheader: 'في تحديث على طلب التقديم بتاعك.',
      heading: 'طلبك اتحرّك',
      body: (job: string, company: string) =>
        `شركة ${company} حدّثت حالة طلبك على وظيفة «${job}».`,
      cta: 'شوف طلباتك',
      labelJob: 'الوظيفة',
      labelCompany: 'الشركة',
      labelStatus: 'الحالة الجديدة',
    },

    jobApproved: {
      subject: (job: string) => `تم نشر «${job}»`,
      preheader: 'إعلانك بقى ظاهر للمتقدمين.',
      heading: 'إعلانك اتنشر',
      body: (job: string) => `«${job}» عدّى المراجعة وبقى ظاهر في نتايج البحث.`,
      cta: 'شوف الإعلان',
      labelJob: 'الوظيفة',
    },

    jobRejected: {
      subject: (job: string) => `«${job}» محتاج تعديل`,
      preheader: 'إعلانك محتاج تعديل قبل ما يتنشر.',
      heading: 'إعلانك محتاج تعديل',
      body: (job: string) => `«${job}» ماعدّاش المراجعة. عدّله وابعته تاني.`,
      reason: (note: string) => `سبب الرفض: ${note}`,
      cta: 'عدّل الإعلان',
      labelJob: 'الوظيفة',
    },

    accountApproved: {
      subject: 'حسابك اتفعّل',
      preheader: 'تقدر تنشر إعلاناتك دلوقتي.',
      heading: 'حسابك اتفعّل',
      body: 'راجعنا بيانات شركتك، والحساب بقى مفعّل. تقدر تنشر أول إعلان دلوقتي.',
      cta: 'انشر وظيفة',
    },

    accountRejected: {
      subject: 'حسابك متوقف مؤقتاً',
      preheader: 'محتاجين نراجع بيانات الشركة تاني.',
      heading: 'حسابك متوقف مؤقتاً',
      body: 'وقّفنا الحساب مؤقتاً لحد ما نراجع البيانات تاني.',
      reason: (note: string) => `السبب: ${note}`,
      contact: 'لو ده مش صح، ردّ على الرسالة دي وهنراجعها.',
    },

    digest: {
      subject: (count: number, label: string) =>
        count === 1 ? `وظيفة جديدة في «${label}»` : `${count} وظايف جديدة في «${label}»`,
      preheader: 'وظايف جديدة تطابق البحث المحفوظ عندك.',
      heading: 'في جديد في بحثك',
      body: (label: string) => `دي الوظايف اللي نزلت الأسبوع ده وبتطابق «${label}».`,
      cta: 'شوفهم كلهم',
      labelSearch: 'البحث',
    },
    status: {
      new: 'جديد',
      shortlisted: 'في القائمة المختصرة',
      interview: 'مقابلة',
      hired: 'اتقبل',
      rejected: 'مرفوض',
    } satisfies Record<ApplicationStatus, string>,
  },

  en: {
    siteName: 'Brokers Connect',
    footerNote: 'You are receiving this because you have a Brokers Connect account.',
    unsubscribe: 'Turn off these emails',

    applicationReceived: {
      subject: (job: string) => `We have your application for ${job}`,
      preheader: 'Your application was received.',
      heading: 'We have your application',
      body: (job: string, company: string) =>
        `Your application for “${job}” at ${company} is with them now. They review it on the platform, and we will tell you the moment it moves.`,
      cta: 'Track your applications',
      labelJob: 'Job',
      labelCompany: 'Company',
    },

    newApplication: {
      subject: (job: string) => `New applicant for ${job}`,
      preheader: 'Someone applied to one of your roles.',
      heading: 'You have a new applicant',
      body: (name: string, job: string) => `${name} applied to “${job}”.`,
      cta: 'View applicants',
      labelJob: 'Role',
      labelApplicant: 'Applicant',
      labelExperience: 'Experience',
    },

    statusChanged: {
      subject: (job: string) => `Update on your application for ${job}`,
      preheader: 'There is an update on your application.',
      heading: 'Your application moved',
      body: (job: string, company: string) =>
        `${company} updated the status of your application for “${job}”.`,
      cta: 'View your applications',
      labelJob: 'Role',
      labelCompany: 'Company',
      labelStatus: 'New status',
    },

    jobApproved: {
      subject: (job: string) => `“${job}” is live`,
      preheader: 'Your listing is now visible to candidates.',
      heading: 'Your listing is live',
      body: (job: string) => `“${job}” passed review and is now showing in search results.`,
      cta: 'View listing',
      labelJob: 'Role',
    },

    jobRejected: {
      subject: (job: string) => `“${job}” needs changes`,
      preheader: 'Your listing needs changes before it can go live.',
      heading: 'Your listing needs changes',
      body: (job: string) => `“${job}” did not pass review. Edit it and submit again.`,
      reason: (note: string) => `Reason: ${note}`,
      cta: 'Edit listing',
      labelJob: 'Role',
    },

    accountApproved: {
      subject: 'Your account is active',
      preheader: 'You can publish listings now.',
      heading: 'Your account is active',
      body: 'We have reviewed your company details and your account is now active. You can publish your first listing.',
      cta: 'Post a job',
    },

    accountRejected: {
      subject: 'Your account is suspended',
      preheader: 'We need to look at your company details again.',
      heading: 'Your account is suspended',
      body: 'We have suspended the account while we look at the details again.',
      reason: (note: string) => `Reason: ${note}`,
      contact: 'If this looks wrong, reply to this email and we will take another look.',
    },

    digest: {
      subject: (count: number, label: string) =>
        count === 1 ? `A new role in “${label}”` : `${count} new roles in “${label}”`,
      preheader: 'New roles matching your saved search.',
      heading: 'New in your saved search',
      body: (label: string) => `These went live this week and match “${label}”.`,
      cta: 'See them all',
      labelSearch: 'Search',
    },
    status: {
      new: 'New',
      shortlisted: 'Shortlisted',
      interview: 'Interview',
      hired: 'Hired',
      rejected: 'Not selected',
    } satisfies Record<ApplicationStatus, string>,
  },
} as const;

export function copyFor(locale: string | null | undefined) {
  return locale === 'en' ? emailCopy.en : emailCopy.ar;
}

export function localeOf(value: string | null | undefined): Locale {
  return value === 'en' ? 'en' : 'ar';
}
