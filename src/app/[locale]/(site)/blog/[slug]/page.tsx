import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ArrowLeft, CalendarDays, Clock } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { asLocale, routing, activeLocales, ENGLISH_ENABLED, type Locale } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { JsonLd } from '@/components/json-ld';
import { CoverArt } from '@/components/blog/cover-art';
import { getAllPosts, getPost, getPostLocales, getPostSlugs } from '@/lib/blog';
import { env } from '@/lib/env';
import { formatDate, isoDate } from '@/lib/utils';

type Params = { locale: string; slug: string };

/** Posts are files, so every one of them can be built ahead of time. */
export function generateStaticParams() {
  return activeLocales.flatMap((locale) =>
    getPostSlugs().map((slug) => ({ locale, slug })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { locale: rawLocale, slug } = await params;
  const locale = asLocale(rawLocale);
  const post = getPost(slug, locale);
  if (!post) return {};

  const path = `/blog/${slug}`;
  // Only advertise a translation that both exists as a file and is published.
  const available = getPostLocales(slug).filter((item) => activeLocales.includes(item));
  const languages: Record<string, string> = {};
  if (available.includes('ar')) languages.ar = path;
  if (available.includes('en')) languages.en = `/en${path}`;

  return {
    title: post.title,
    description: post.description,
    alternates: ENGLISH_ENABLED
      ? { canonical: locale === routing.defaultLocale ? path : `/${locale}${path}`, languages }
      : { canonical: path },
    openGraph: {
      type: 'article',
      title: post.title,
      description: post.description,
      publishedTime: isoDate(post.date),
      authors: [post.author],
    },
  };
}

export default async function BlogPostPage({ params }: { params: Promise<Params> }) {
  const { locale: rawLocale, slug } = await params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);

  const post = getPost(slug, locale);
  if (!post) notFound();

  const t = await getTranslations('blog');
  const more = getAllPosts(locale)
    .filter((item) => item.slug !== slug)
    .slice(0, 2);

  return (
    <>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'BlogPosting',
          headline: post.title,
          description: post.description,
          datePublished: isoDate(post.date),
          inLanguage: post.locale,
          author: { '@type': 'Organization', name: post.author },
          publisher: { '@type': 'Organization', name: 'Brokers Connect' },
          mainEntityOfPage: `${env.siteUrl}${locale === 'ar' ? '' : `/${locale}`}/blog/${slug}`,
        }}
      />

      <div className="mx-auto max-w-2xl px-4 py-14">
        <Button asChild variant="ghost" size="sm" className="mb-8 -ms-3">
          <Link href="/blog">
            <ArrowLeft className="rtl-flip" />
            {t('backToBlog')}
          </Link>
        </Button>

        <article>
          <header className="mb-10">
            <CoverArt
              slug={post.slug}
              variant={post.cover}
              className="mb-8 h-44 w-full rounded-2xl border border-border sm:h-56"
            />

            <div className="flex flex-wrap gap-1.5">
              {post.tags.map((tag) => (
                <Badge key={tag} variant="primary">
                  {tag}
                </Badge>
              ))}
            </div>

            <h1 className="mt-4 text-3xl font-bold leading-[1.3] text-balance sm:text-4xl">
              {post.title}
            </h1>

            <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
              {post.description}
            </p>

            <p className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-5 text-sm text-muted-foreground">
              <span>{t('writtenBy', { author: post.author })}</span>
              <time dateTime={isoDate(post.date)} className="numeral inline-flex items-center gap-1">
                <CalendarDays className="size-3.5" aria-hidden />
                {formatDate(post.date, locale)}
              </time>
              <span className="numeral inline-flex items-center gap-1">
                <Clock className="size-3.5" aria-hidden />
                {t('readingTime', { count: post.readingMinutes })}
              </span>
            </p>
          </header>

          {/* The markdown comes from files in this repository, not from users. */}
          <div className="prose" dangerouslySetInnerHTML={{ __html: post.html }} />
        </article>

        <aside className="bg-brand-gradient mt-16 rounded-[1.75rem] p-8 text-center text-primary-foreground shadow-lg">
          <h2 className="text-xl font-bold">{t('ctaTitle')}</h2>
          <p className="mx-auto mt-2 max-w-sm leading-relaxed opacity-90">{t('ctaBody')}</p>
          <Button asChild variant="secondary" size="lg" className="mt-6">
            <Link href="/jobs">{t('ctaButton')}</Link>
          </Button>
        </aside>

        {more.length ? (
          <section className="mt-16" aria-labelledby="more-reading">
            <h2 id="more-reading" className="text-lg font-semibold">
              {t('moreReading')}
            </h2>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {more.map((item) => (
                <li key={item.slug}>
                  <Link
                    href={`/blog/${item.slug}`}
                    className="lift block h-full rounded-2xl border border-border bg-card p-5 shadow-sm hover:border-primary/30"
                  >
                    <p className="font-medium leading-snug">{item.title}</p>
                    <p className="numeral mt-2 text-xs text-muted-foreground">
                      {t('readingTime', { count: item.readingMinutes })}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </>
  );
}
