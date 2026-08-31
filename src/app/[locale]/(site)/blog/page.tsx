import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CalendarDays, Clock } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { alternatesFor, routing, type Locale } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { getAllPosts } from '@/lib/blog';
import { formatDate, isoDate } from '@/lib/utils';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'blog' });
  const path = '/blog';

  return {
    title: t('title'),
    description: t('subtitle'),
    alternates: alternatesFor(path, locale),
  };
}

export default async function BlogIndexPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const posts = getAllPosts(locale);
  const t = await getTranslations('blog');

  return (
    <div className="mx-auto max-w-4xl px-4 py-14">
      <header className="mb-12 text-center">
        <h1 className="text-3xl font-bold text-balance sm:text-4xl">{t('title')}</h1>
        <p className="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-muted-foreground">
          {t('subtitle')}
        </p>
      </header>

      {posts.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border py-20 text-center text-muted-foreground">
          {t('empty')}
        </p>
      ) : (
        <ul className="space-y-4">
          {posts.map((post) => (
            <li key={post.slug}>
              <article className="lift relative rounded-2xl border border-border bg-card p-6 shadow-sm hover:border-primary/30">
                <div className="flex flex-wrap gap-1.5">
                  {post.tags.map((tag) => (
                    <Badge key={tag} variant="primary">
                      {tag}
                    </Badge>
                  ))}
                </div>

                <h2 className="mt-3 text-xl font-semibold leading-snug">
                  <Link
                    href={`/blog/${post.slug}`}
                    className="after:absolute after:inset-0 hover:text-primary"
                  >
                    {post.title}
                  </Link>
                </h2>

                <p className="mt-2 leading-relaxed text-muted-foreground">{post.description}</p>

                <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <time dateTime={isoDate(post.date)} className="numeral inline-flex items-center gap-1">
                    <CalendarDays className="size-3.5" aria-hidden />
                    {formatDate(post.date, locale)}
                  </time>
                  <span className="numeral inline-flex items-center gap-1">
                    <Clock className="size-3.5" aria-hidden />
                    {t('readingTime', { count: post.readingMinutes })}
                  </span>
                </p>
              </article>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
