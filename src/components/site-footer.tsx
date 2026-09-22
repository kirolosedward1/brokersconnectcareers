import { getTranslations } from 'next-intl/server';
import { ArrowRight } from 'lucide-react';
import { FooterGroup } from '@/components/footer-group';
import { Link } from '@/i18n/navigation';
import { localized } from '@/i18n/routing';
import { Logo } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { JOB_TRACKS } from '@/lib/taxonomy';
import { getDistricts } from '@/lib/queries/taxonomy';
import { optional } from '@/lib/queries/error';
import { getViewer } from '@/lib/auth';
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
  /*
    Signed in, the two doors below are a question already answered.

    They ask "are you looking for work, or hiring?" — which is the choice
    somebody makes at the sign-up door and then lives inside. Shown to a
    consultant who is three applications in, it reads as a site that has
    forgotten who they are; and its employer half links to
    /employer/jobs/new, which that consultant cannot use at all.

    Cached per request and already read by SiteHeader above, so this costs
    nothing.
  */
  const viewer = await getViewer();

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
   *
   * From `lg` it relaxes to 32px. The 44px rule is about thumbs, and at that
   * width the reader has a pointer; held to 44 there, four short lists made a
   * footer taller than the viewport above it.
   */
  const linkClass =
    'inline-flex min-h-11 items-center py-1 text-sm text-muted-foreground transition-colors hover:text-foreground lg:min-h-8';

  return (
    <footer className="mt-12 border-t border-border bg-muted/40">
      <div className="shell">
        {/* The two doors, for visitors only. Same words as the landing page's
            segmented control, so a reader who scrolled past it meets the same
            choice here — and the landing page makes the same swap, showing a
            signed-in reader their own dashboard instead of the pitch. */}
        {viewer ? null : (
          /* Two lines, not two cards. Each door was a bordered panel with an
             icon tile, a heading, a paragraph and a button, above the footer
             of every public page — a second call to action under whatever the
             page itself had just asked for. The choice is worth keeping at the
             foot of a long read; it does not need two hundred pixels. */
          <div className="grid gap-x-10 sm:grid-cols-2">
            <Link
              href="/jobs"
              className="group flex min-h-14 items-center justify-between gap-3 border-b border-border py-3 sm:border-b-0"
            >
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{t('doorCandidateTitle')}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {t('doorCandidateBody')}
                </span>
              </span>
              <span className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary group-hover:underline">
                {t('doorCandidateCta')}
                <ArrowRight className="rtl-flip size-3.5" aria-hidden />
              </span>
            </Link>

            {/* The employer's own sign-in, carrying them on to the wizard —
                the same door the landing page uses. Pointed straight at the
                protected route, a visitor was bounced to the consultants'
                sign-in instead. */}
            <Link
              href={{ pathname: '/sign-in/employer', query: { next: '/employer/jobs/new' } }}
              className="group flex min-h-14 items-center justify-between gap-3 py-3"
            >
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{t('doorEmployerTitle')}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {t('doorEmployerBody')}
                </span>
              </span>
              <span className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary group-hover:underline">
                {tNav('postJob')}
                <ArrowRight className="rtl-flip size-3.5" aria-hidden />
              </span>
            </Link>
          </div>
        )}

        {/* The index. Two groups to a row on a phone, four on a desktop. The
            top border is the doors' bottom edge when they are there and the
            page's when they are not, so a visitor and a signed-in reader both
            get one rule above this and not two or none. */}
        <div className="grid border-t border-border py-4 lg:grid-cols-4 lg:gap-x-6 lg:py-8">
          <FooterGroup title={t('product')}>
            <ul className="lg:mt-2">
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
          </FooterGroup>

          <FooterGroup title={t('byTrack')}>
            <ul className="lg:mt-2">
              {JOB_TRACKS.map((track) => (
                <li key={track}>
                  <Link href={{ pathname: '/jobs', query: { track } }} className={linkClass}>
                    {tTrack(track)}
                  </Link>
                </li>
              ))}
            </ul>
          </FooterGroup>

          {areas.length ? (
            <FooterGroup title={t('byArea')}>
              <ul className="lg:mt-2">
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
            </FooterGroup>
          ) : null}

          <FooterGroup title={t('about')}>
            <ul className="lg:mt-2">
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
          </FooterGroup>
        </div>
      </div>

      <div className="border-t border-border py-5">
        {/* Centred and stacked on a phone — mark, tagline, copyright, then the
            theme switch under them — where the two-column arrangement left the
            switch floating beside a line of small print. The row returns from
            `sm`, where there is room for the two ends to be two ends. */}
        <div className="shell flex flex-col items-center gap-3 text-center sm:flex-row sm:items-center sm:justify-between sm:text-start">
          <div className="flex flex-col items-center sm:items-start">
            <Logo name={tMeta('siteName')} />
            <p className="mt-1 text-sm text-muted-foreground">{tMeta('tagline')}</p>
          </div>

          <div className="flex flex-col items-center gap-3 text-xs text-muted-foreground sm:flex-row sm:gap-x-4">
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
