import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { alternatesFor, asLocale, type Locale } from '@/i18n/routing';
import { SUPPORT_COPY, SUPPORT_EMAIL, supportLanguage } from '../../../../../content/support';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const lang = supportLanguage(locale, (await searchParams).lang);
  const alternates = alternatesFor('/support', locale);
  return {
    title: SUPPORT_COPY[lang].title,
    description: SUPPORT_COPY[lang].intro,
    robots: { index: true, follow: true },
    alternates: lang !== locale ? { canonical: `${alternates.canonical}?lang=${lang}` } : alternates,
  };
}

export default async function SupportPage({ params, searchParams }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  const lang = supportLanguage(locale, (await searchParams).lang);
  const copy = SUPPORT_COPY[lang];
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
