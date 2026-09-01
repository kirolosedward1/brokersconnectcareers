import { getTranslations } from 'next-intl/server';
import { ChevronDown } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Logo } from '@/components/logo';
import { JOB_TRACKS } from '@/lib/taxonomy';

/**
 * One footer column.
 *
 * A disclosure on phones, a plain column from sm up — the switch is in
 * globals.css under .footer-section, because CSS cannot add an `open`
 * attribute and this needs to work without JavaScript. Stacked open on a
 * phone, these four lists put most of a screen between the reader and the
 * bottom of the page.
 */
function FooterSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <details className="footer-section group border-b border-border/70 pb-3 sm:border-0 sm:pb-0">
      <summary
        className="flex cursor-pointer list-none items-center justify-between py-2 text-sm font-medium [&::-webkit-details-marker]:hidden"
        aria-controls={id}
      >
        {title}
        <ChevronDown
          className="size-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
          aria-hidden
        />
      </summary>

      <p className="hidden text-sm font-medium sm:block" aria-hidden>
        {title}
      </p>

      <nav id={id} className="footer-section-body" aria-label={title}>
        {children}
      </nav>
    </details>
  );
}

function FooterLinks({ children }: { children: React.ReactNode }) {
  return <ul className="mt-3 space-y-2 pb-1 text-sm text-muted-foreground">{children}</ul>;
}

export async function SiteFooter() {
  const t = await getTranslations('footer');
  const tNav = await getTranslations('nav');
  const tTrack = await getTranslations('track');
  const tMeta = await getTranslations('meta');

  return (
    <footer className="mt-16 border-t border-border bg-muted/40">
      <div className="mx-auto grid max-w-6xl gap-x-8 gap-y-2 px-4 py-12 sm:grid-cols-2 sm:gap-y-8 lg:grid-cols-4">
        <div className="mb-4 sm:mb-0">
          <Logo name={tMeta('siteName')} />
          <p className="mt-2 text-sm text-muted-foreground">{tMeta('tagline')}</p>
        </div>

        <FooterSection id="footer-product" title={t('product')}>
          <FooterLinks>
            <li>
              <Link href="/jobs" className="transition-colors hover:text-foreground">
                {tNav('jobs')}
              </Link>
            </li>
            <li>
              <Link href="/companies" className="transition-colors hover:text-foreground">
                {tNav('companies')}
              </Link>
            </li>
            <li>
              <Link href="/agents" className="transition-colors hover:text-foreground">
                {tNav('agents')}
              </Link>
            </li>
            <li>
              <Link href="/blog" className="transition-colors hover:text-foreground">
                {tNav('blog')}
              </Link>
            </li>
            <li>
              <Link href="/employer/jobs/new" className="transition-colors hover:text-foreground">
                {tNav('postJob')}
              </Link>
            </li>
          </FooterLinks>
        </FooterSection>

        <FooterSection id="footer-tracks" title={t('forCandidates')}>
          <FooterLinks>
            {JOB_TRACKS.slice(0, 5).map((track) => (
              <li key={track}>
                <Link
                  href={{ pathname: '/jobs', query: { track } }}
                  className="transition-colors hover:text-foreground"
                >
                  {tTrack(track)}
                </Link>
              </li>
            ))}
          </FooterLinks>
        </FooterSection>

        <FooterSection id="footer-legal" title={t('about')}>
          <FooterLinks>
            <li>
              <Link href="/privacy" className="transition-colors hover:text-foreground">
                {t('privacy')}
              </Link>
            </li>
            <li>
              <Link href="/terms" className="transition-colors hover:text-foreground">
                {t('terms')}
              </Link>
            </li>
          </FooterLinks>
        </FooterSection>
      </div>

      <div className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        <span className="numeral">{new Date().getFullYear()}</span> · {tMeta('siteName')} ·{' '}
        {t('rights')}
      </div>
    </footer>
  );
}
