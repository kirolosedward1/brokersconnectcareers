import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Logo } from '@/components/logo';
import { JOB_TRACKS } from '@/lib/taxonomy';

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

  const linkClass = 'transition-colors hover:text-foreground';

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
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
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
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
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
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
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

      <div className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        <span className="numeral">{new Date().getFullYear()}</span> · {tMeta('siteName')} ·{' '}
        {t('rights')}
      </div>
    </footer>
  );
}
