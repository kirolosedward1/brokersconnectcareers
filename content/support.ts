import type { Locale } from '@/lib/locale';

/**
 * Support page copy, kept out of the page component.
 *
 * Arabic in `src/app` or `src/components` fails the catalogue check. This page
 * still needs both languages: English is unpublished (`ENGLISH_ENABLED`), and
 * `?lang=en` serves the English text the way the legal pages do. The words
 * live here, beside `content/legal`, and the page only renders them.
 *
 * Arabic is Modern Standard Arabic.
 */

/** Where support is reached. Published in the App Store listing as its support URL. */
export const SUPPORT_EMAIL = 'info@topsuite.net';

export type SupportCopy = {
  title: string;
  intro: string;
  emailLabel: string;
  faqTitle: string;
  other: string;
  faq: { q: string; a: string }[];
};

export const SUPPORT_COPY: Record<Locale, SupportCopy> = {
  ar: {
    title: 'الدعم والمساعدة',
    intro: 'نحن هنا لمساعدتك. إذا كان لديك سؤال أو واجهتك مشكلة في الموقع أو التطبيق، راسلنا عبر البريد الإلكتروني وسنرد عليك في أقرب وقت ممكن.',
    emailLabel: 'البريد الإلكتروني للدعم',
    faqTitle: 'الأسئلة الشائعة',
    other: 'Read in English',
    faq: [
      {
        q: 'ما هي منصة بروكرز كونكت؟',
        a: 'بروكرز كونكت منصة توظيف متخصصة في قطاع العقارات في مصر، تربط الاستشاريين العقاريين ومسؤولي المبيعات والتسويق بشركات التسويق والوساطة العقارية. يوضّح كل إعلان الراتب والعمولة ومصدر العملاء.',
      },
      {
        q: 'كيف أنشئ حسابًا؟',
        a: 'اضغط على «تسجيل» في الموقع أو التطبيق، واختر نوع الحساب (باحث عن عمل أو شركة)، ثم أكمل بياناتك وأكّد بريدك الإلكتروني.',
      },
      {
        q: 'كيف أتقدّم إلى وظيفة؟',
        a: 'تصفّح الوظائف وصفِّها حسب التخصص والمنطقة، ثم افتح الإعلان واضغط على «تقدّم الآن». تصل بياناتك إلى الشركة مباشرة، ويمكنك متابعة حالة طلباتك من حسابك.',
      },
      {
        q: 'كيف تنشر الشركات الوظائف؟',
        a: 'تسجّل الشركة الدخول بحساب الشركات، وتنشئ ملفها، ثم تضيف الوظيفة من لوحة التحكم. يُراجَع كل إعلان قبل نشره للتأكد من اكتمال بياناته.',
      },
      {
        q: 'كيف أحذف حسابي وبياناتي؟',
        a: 'يمكنك حذف حسابك من إعدادات الحساب في الموقع أو التطبيق، أو مراسلتنا عبر البريد الإلكتروني لطلب الحذف. التفاصيل الكاملة في صفحة «حذف الحساب».',
      },
      {
        q: 'كيف أتواصل مع الدعم؟',
        a: `راسلنا على ${SUPPORT_EMAIL} واذكر البريد الإلكتروني المسجَّل في حسابك ووصفًا موجزًا للمشكلة.`,
      },
    ],
  },
  en: {
    title: 'Help & support',
    intro: 'We are here to help. If you have a question or run into a problem with the website or the app, email us and we will reply as soon as we can.',
    emailLabel: 'Support email',
    faqTitle: 'Frequently asked questions',
    other: 'اقرأ بالعربية',
    faq: [
      {
        q: 'What is Brokers Connect?',
        a: 'Brokers Connect is a job board for the real estate industry in Egypt. It connects property consultants and sales and marketing staff with real estate brokerages and marketing companies. Every listing shows the salary, the commission and who supplies the leads.',
      },
      {
        q: 'How do I create an account?',
        a: 'Tap “Sign up” on the website or in the app, choose the account type (job seeker or company), then complete your details and confirm your email address.',
      },
      {
        q: 'How do I apply for a job?',
        a: 'Browse the jobs and filter them by specialisation and area, open a listing and tap “Apply”. Your details go straight to the company, and you can follow your applications from your account.',
      },
      {
        q: 'How do companies post jobs?',
        a: 'A company signs in with an employer account, sets up its profile and adds the job from its dashboard. Every listing is reviewed before it goes live.',
      },
      {
        q: 'How do I delete my account and data?',
        a: 'You can delete your account from the account settings on the website or in the app, or email us to ask for deletion. The full details are on the “Deleting your account” page.',
      },
      {
        q: 'How do I contact support?',
        a: `Email ${SUPPORT_EMAIL} with the email address on your account and a short description of the problem.`,
      },
    ],
  },
};

/** The language the page is read in: the site's, unless `?lang=` asks for the other one. */
export function supportLanguage(locale: Locale, lang: string | string[] | undefined): Locale {
  return lang === 'en' || lang === 'ar' ? lang : locale;
}
