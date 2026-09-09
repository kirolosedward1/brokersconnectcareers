import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Logo } from '@/components/logo';
import { JOB_TRACKS } from '@/lib/taxonomy';
import { ThemeToggle } from '@/components/theme-toggle';

/**
 * Four columns, every link visible at every width.
 *
 * These were briefly collapsed into an accordion on phones to shorten the
 * page. Reverted: the footer is where the track and directory links live, and
 * on a job board those are navigation people actually use, not boilerplate to
 * be tucked away. A link nobody can see is a link nobody follows.
 */
export async function SiteFooter() {
  const t = await getTranslations('footer');
  const tNav = await getTranslations('nav');
  const tTrack = await getTranslations('track');
  const tMeta = await getTranslations('meta');

  /**
   * Padded to a 36px tap target, not just styled.
   *
   * These were 21px tall in a stack with 8px between them, which is a fiddly
   * thing to hit on a phone and below WCAG 2.2's 24px minimum. The exception
   * for links inline in a sentence does not apply — this is a navigation list,
   * and every item in it is a target in its own right.
   *
   * 36 rather than the 44 the rest of the site now uses. Four stacked columns
   * of six links each is where a blanket 44 stops being an accessibility win:
   * it adds about 300px of footer on a phone, and pushes the links a reader
   * actually wants further from the content they were reading. 36 clears the
   * AA minimum by half again and keeps the footer a footer.
   *
   * `inline-flex` with vertical padding rather than a taller line-height, so
   * the text keeps its own spacing and only the hit area grows.
   */
  const linkClass =
    // min-h-11, matching the header and NavLink. The footer was the only place
    // in the product still on 36px, and it is a column of small links that
    // people tap on a phone — the worst place to be under the target size.
    'inline-flex min-h-11 items-center py-1 transition-colors hover:text-foreground';

  return (
    <footer className="mt-16 border-t border-border bg-muted/40">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Logo name={tMeta('siteName')} />
          <p className="mt-2 text-sm text-muted-foreground">{tMeta('tagline')}</p>
        </div>

        <nav aria-labelledby="footer-product">
          <p id="footer-product" className="text-sm font-medium">
            {t('product')}
          </p>
          <ul className="mt-2 text-sm text-muted-foreground">
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
            <li>
              <Link href="/employer/jobs/new" className={linkClass}>
                {tNav('postJob')}
              </Link>
            </li>
          </ul>
        </nav>

        <nav aria-labelledby="footer-tracks">
          <p id="footer-tracks" className="text-sm font-medium">
            {t('forCandidates')}
          </p>
          <ul className="mt-2 text-sm text-muted-foreground">
            {JOB_TRACKS.slice(0, 5).map((track) => (
              <li key={track}>
                <Link href={{ pathname: '/jobs', query: { track } }} className={linkClass}>
                  {tTrack(track)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-labelledby="footer-legal">
          <p id="footer-legal" className="text-sm font-medium">
            {t('about')}
          </p>
          <ul className="mt-2 text-sm text-muted-foreground">
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
          </ul>
        </nav>
      </div>

      <div className="border-t border-border py-6">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-4 text-xs text-muted-foreground sm:flex-row sm:justify-between">
          <p>
            <span className="numeral">{new Date().getFullYear()}</span> · {tMeta('siteName')} ·{' '}
            {t('rights')}
          </p>

          {/* In the footer rather than the header: it is a preference somebody
              sets once, not a control they reach for on every page. */}
          <ThemeToggle />
        </div>
      </div>
    </footer>
  );
}
