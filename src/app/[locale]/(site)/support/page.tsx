import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { alternatesFor, asLocale, type Locale } from '@/i18n/routing';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Where support is reached. Published in the App Store listing as its support URL. */
const SUPPORT_EMAIL = 'info@topsuite.net';

type Copy = {
  title: string;
  intro: string;
  emailLabel: string;
  faqTitle: string;
  other: string;
  faq: { q: string; a: string }[];
};

/*
  Arabic in Modern Standard Arabic, English beside it at `?lang=en` — the same
  pattern the legal pages use while the site's English is switched off.
*/
const COPY: Record<Locale, Copy> = {
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

function pageLanguage(locale: Locale, lang: string | string[] | undefined): Locale {
  return lang === 'en' || lang === 'ar' ? lang : locale;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const lang = pageLanguage(locale, (await searchParams).lang);
  const alternates = alternatesFor('/support', locale);
  return {
    title: COPY[lang].title,
    description: COPY[lang].intro,
    robots: { index: true, follow: true },
    alternates: lang !== locale ? { canonical: `${alternates.canonical}?lang=${lang}` } : alternates,
  };
}

export default async function SupportPage({ params, searchParams }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  const lang = pageLanguage(locale, (await searchParams).lang);
  const copy = COPY[lang];
  const otherLang: Locale = lang === 'ar' ? 'en' : 'ar';
  const otherHref = otherLang === locale ? { pathname: '/support' } : { pathname: '/support', query: { lang: otherLang } };

  return (
    <article lang={lang} dir={lang === 'ar' ? 'rtl' : 'ltr'} className="mx-auto max-w-3xl px-4 py-14">
      <header className="mb-10 border-b border-border pb-6">
        <h1 className="text-3xl font-bold text-balance sm:text-4xl">{copy.title}</h1>
        <div className="mt-3 flex flex-wrap items-center justify-end gap-x-6 gap-y-2 text-sm text-muted-foreground">
          <Link
            href={otherHref}
            lang={otherLang}
            hrefLang={otherLang}
            className="inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline"
          >
            {copy.other}
          </Link>
        </div>
      </header>

      <div className="prose">
        <p>{copy.intro}</p>
        <p>
          <strong>{copy.emailLabel}:</strong>{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} dir="ltr">
            {SUPPORT_EMAIL}
          </a>
        </p>

        <h2>{copy.faqTitle}</h2>
        {copy.faq.map((item) => (
          <section key={item.q}>
            <h3>{item.q}</h3>
            <p>{item.a}</p>
          </section>
        ))}
      </div>
    </article>
  );
}
