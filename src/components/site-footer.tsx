import { getTranslations } from 'next-intl/server';
import { Briefcase, Search } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { localized } from '@/i18n/routing';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { JOB_TRACKS } from '@/lib/taxonomy';
import { getDistricts } from '@/lib/queries/taxonomy';
import { optional } from '@/lib/queries/error';
import { env } from '@/lib/env';

/**
 * The footer is where somebody lands after reading a whole page and doing
 * nothing on it — so it opens with the two things the site is for, in the same
 * two words the landing page uses, and only then becomes navigation.
 *
 * The navigation is the board's own index, not boilerplate: every track and
 * the eight districts that carry most of Egypt's brokerage hiring, each a real
 * filter on /jobs. These are the pages people search for and the pages search
 * engines rank, and a footer is the one place they can be reached from
 * everywhere. Nothing is collapsed on a phone for the same reason as before —
 * a link nobody can see is a link nobody follows — but the groups sit two to a
 * row, which halves the height the old single column took.
 *
 * Every sentence in the two doors is a mechanism the product has: the
 * compensation card renders salary, commission and leads source on every
 * listing; a posted job goes through review; an application carries the
 * applicant's name and WhatsApp number. Nothing here promises reach, speed or
 * quality, because nothing here measures them.
 */

/** The districts worth a permanent link, by slug, in the order they are shown. */
const FEATURED_DISTRICTS = [
  'new-cairo',
  'sheikh-zayed',
  '6th-of-october',
  'new-capital',
  'madinaty',
  'maadi',
  'heliopolis',
  'nasr-city',
] as const;

export async function SiteFooter({ locale }: { locale: string }) {
  const t = await getTranslations('footer');
  const tNav = await getTranslations('nav');
  const tTrack = await getTranslations('track');
  const tMeta = await getTranslations('meta');

  // Names come from the taxonomy the board itself filters on, so a renamed or
  // removed district disappears from here on its own rather than 404ing.
  const districts = await optional(getDistricts(), []);
  const bySlug = new Map(districts.map((district) => [district.slug, district]));
  const areas = FEATURED_DISTRICTS.map((slug) => bySlug.get(slug)).filter(
    (district): district is NonNullable<typeof district> => Boolean(district),
  );

  // Only when somebody has actually set it. A mailto to nowhere is a dead end
  // with a friendlier label.
  const supportEmail = env.supportEmail;

  /**
   * min-h-11, matching the header and NavLink. The footer was the only place
   * in the product still on 36px, and it is a column of small links that
   * people tap on a phone — the worst place to be under the target size.
   * `inline-flex` with vertical padding rather than a taller line-height, so
   * the text keeps its own spacing and only the hit area grows.
   */
  const linkClass =
    'inline-flex min-h-11 items-center py-1 text-sm text-muted-foreground transition-colors hover:text-foreground';
  const headingClass = 'text-sm font-semibold';

  return (
    <footer className="mt-16 border-t border-border bg-muted/40">
      <div className="mx-auto max-w-6xl px-4">
        {/* The two doors. Same words as the landing page's segmented control,
            so a reader who scrolled past it meets the same choice here. */}
        <div className="grid gap-3 py-10 sm:grid-cols-2">
          <div className="flex gap-4 rounded-2xl border border-border bg-card p-5">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <Search className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="font-semibold">{t('doorCandidateTitle')}</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {t('doorCandidateBody')}
              </p>
              <Button asChild size="sm" className="mt-3">
                <Link href="/jobs">{t('doorCandidateCta')}</Link>
              </Button>
            </div>
          </div>

          <div className="flex gap-4 rounded-2xl border border-border bg-card p-5">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <Briefcase className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="font-semibold">{t('doorEmployerTitle')}</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {t('doorEmployerBody')}
              </p>
              <Button asChild size="sm" variant="outline" className="mt-3">
                <Link href="/employer/jobs/new">{tNav('postJob')}</Link>
              </Button>
            </div>
          </div>
        </div>

        {/* The index. Two groups to a row on a phone, four on a desktop. */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 border-t border-border py-10 lg:grid-cols-4">
          <nav aria-labelledby="footer-product">
            <p id="footer-product" className={headingClass}>
              {t('product')}
            </p>
            <ul className="mt-2">
              <li>
                <Link href="/jobs" className={linkClass}>
                  {tNav('jobs')}
                </Link>
              </li>
              <li>
                <Link href="/companies" className={linkClass}>
                  {tNav('companies')}
                </Link>
              </li>
              <li>
                <Link href="/agents" className={linkClass}>
                  {tNav('agents')}
                </Link>
              </li>
              <li>
                <Link href="/blog" className={linkClass}>
                  {tNav('blog')}
                </Link>
              </li>
            </ul>
          </nav>

          <nav aria-labelledby="footer-tracks">
            <p id="footer-tracks" className={headingClass}>
              {t('byTrack')}
            </p>
            <ul className="mt-2">
              {JOB_TRACKS.map((track) => (
                <li key={track}>
                  <Link href={{ pathname: '/jobs', query: { track } }} className={linkClass}>
                    {tTrack(track)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {areas.length ? (
            <nav aria-labelledby="footer-areas">
              <p id="footer-areas" className={headingClass}>
                {t('byArea')}
              </p>
              <ul className="mt-2">
                {areas.map((district) => (
                  <li key={district.slug}>
                    <Link
                      href={{ pathname: '/jobs', query: { district: district.slug } }}
                      className={linkClass}
                    >
                      {localized(locale, district.name_ar, district.name_en)}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}

          <nav aria-labelledby="footer-legal">
            <p id="footer-legal" className={headingClass}>
              {t('about')}
            </p>
            <ul className="mt-2">
              <li>
                <Link href="/privacy" className={linkClass}>
                  {t('privacy')}
                </Link>
              </li>
              <li>
                <Link href="/terms" className={linkClass}>
                  {t('terms')}
                </Link>
              </li>
              {supportEmail ? (
                <li>
                  <a href={`mailto:${supportEmail}`} className={linkClass}>
                    {t('contact')}
                  </a>
                </li>
              ) : null}
            </ul>
          </nav>
        </div>
      </div>

      <div className="border-t border-border py-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Logo name={tMeta('siteName')} />
            <p className="mt-1 text-sm text-muted-foreground">{tMeta('tagline')}</p>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
            <p>
              <span className="numeral">{new Date().getFullYear()}</span> · {tMeta('siteName')} ·{' '}
              {t('rights')}
            </p>
            {/* In the footer rather than the header: it is a preference somebody
                sets once, not a control they reach for on every page. */}
            <ThemeToggle />
          </div>
        </div>
      </div>
    </footer>
  );
}
