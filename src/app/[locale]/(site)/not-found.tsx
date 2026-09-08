import { getTranslations, getLocale } from 'next-intl/server';
import { Briefcase, Building2, Search, Users } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';

/**
 * The 404, treated as a place somebody arrived rather than a wall.
 *
 * On this site a dead URL is usually a listing that closed — links get shared
 * on WhatsApp and opened weeks later, long after the role was filled. Somebody
 * who lands here still wants a job in the same market, so the page offers the
 * search they came to do and the three places worth going next, instead of one
 * button back to the homepage that loses them.
 *
 * The search is a plain GET form, so it works with no JavaScript, and it posts
 * to the board exactly as the header's search does.
 */
export default async function NotFound() {
  const t = await getTranslations('common');
  const tHome = await getTranslations('home');
  const tNav = await getTranslations('nav');
  const locale = await getLocale();

  const action = locale === 'ar' ? '/jobs' : `/${locale}/jobs`;

  const elsewhere = [
    { href: '/jobs', label: tNav('jobs'), icon: Briefcase },
    { href: '/companies', label: tNav('companies'), icon: Building2 },
    { href: '/agents', label: tNav('agents'), icon: Users },
  ] as const;

  return (
    <div className="mx-auto max-w-xl px-4 py-20 text-center sm:py-28">
      <p className="numeral text-6xl font-bold text-muted-foreground/60">404</p>
      <h1 className="mt-4 text-2xl font-bold">{t('notFound')}</h1>
      <p className="mt-2 text-muted-foreground">{t('notFoundBody')}</p>

      <form action={action} className="mt-8 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute inset-y-0 start-4 my-auto size-4 text-muted-foreground"
            aria-hidden
          />
          <input
            type="search"
            name="q"
            placeholder={tHome('searchPlaceholder')}
            aria-label={tHome('searchPlaceholder')}
            className="h-12 w-full rounded-xl border border-border bg-card px-4 ps-11 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary"
          />
        </div>
        <Button type="submit" size="lg" className="h-12 shrink-0 rounded-xl px-8">
          {tHome('searchButton')}
        </Button>
      </form>

      <ul className="mt-8 flex flex-wrap justify-center gap-2">
        {elsewhere.map(({ href, label, icon: Icon }) => (
          <li key={href}>
            <Link
              href={href}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-sm font-medium transition-colors hover:border-primary/40 hover:bg-muted"
            >
              <Icon className="size-4 text-muted-foreground" aria-hidden />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
