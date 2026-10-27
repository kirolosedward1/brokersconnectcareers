import { getTranslations } from 'next-intl/server';
import { Search } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { ENGLISH_ENABLED, type Locale } from '@/i18n/routing';
import { postJobHref, siteNavFor, type SiteNavItem } from '@/lib/permissions';
import { SITELINK_AREAS, SITELINK_PAGES, areaLandingPath } from '@/lib/seo/area-links';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { MobileNav } from '@/components/mobile-nav';
import { NavLink } from '@/components/nav-link';
import { HeaderShell } from '@/components/header-shell';
import { HeaderAccount, HeaderWordmark, LiveAgentsLink } from '@/components/session/header-account';

/**
 * The public header, drawn for nobody in particular.
 *
 * Who is signed in used to be read here, and that called cookies() on every
 * public page, which is what forced them to `no-store`. The HTML is the
 * visitor's header. HeaderAccount swaps the cluster when a session cookie is
 * already in the browser, before paint, from /api/chrome — so a cached page
 * never contains one person's name.
 */
export async function SiteHeader({ locale }: { locale: Locale }) {
  const t = await getTranslations('nav');
  const tFooter = await getTranslations('footer');
  const tMeta = await getTranslations('meta');
  const tAccount = await getTranslations('account');
  const tNotifications = await getTranslations('notifications');

  // The visitor's list. The directory link is added in the browser, and only
  // for a reader the directory will open for.
  const nav = siteNavFor(null);
  const anonymousPost = postJobHref(null) ?? '/sign-in/employer?next=/employer/jobs/new';

  // The board and the directory keep their routes. The words are the ones a
  // result can use as a sitelink: الوظائف، الشركات.
  function navLabel(key: SiteNavItem['key']) {
    if (key === 'searchJobs') return t('jobs');
    if (key === 'companies') return t('companiesShort');
    return t(key);
  }

  const labels = {
    locale,
    signIn: t('signIn'),
    signUp: t('signUp'),
    postJob: t('postJob'),
    admin: t('admin'),
    employerArea: t('employerArea'),
    dashboard: t('dashboard'),
    signOut: t('signOut'),
    account: tAccount('title'),
    notifications: tNotifications('title'),
    anonymousPostHref: anonymousPost,
  };

  return (
    <HeaderShell hasHomeHero>
      <div className="shell grid h-14 grid-cols-[minmax(max-content,1fr)_auto_minmax(max-content,1fr)] items-center gap-2 sm:h-16 md:flex">
        <Link
          href="/jobs"
          aria-label={t('searchJobs')}
          className="grid size-11 place-items-center justify-self-start rounded-lg transition-colors hover:bg-muted group-data-[over-hero]/header:hover:bg-white/15 md:hidden"
        >
          <Search className="size-4" aria-hidden />
        </Link>

        <Link href="/" className="flex min-h-11 shrink-0 items-center justify-self-center">
          {/* Below 360px the three controls and the wordmark do not fit
              together, so a signed-in reader keeps the mark and hears the
              name. A visitor keeps both at every width. */}
          <HeaderWordmark name={tMeta('siteName')} />
        </Link>

        <nav className="ms-2 hidden items-center gap-1 text-sm md:flex">
          {nav.map((link) => (
            <NavLink key={link.href} href={link.href} className={link.href === '/app' ? 'hidden lg:inline-flex' : undefined}>
              {navLabel(link.key)}
            </NavLink>
          ))}
          <LiveAgentsLink label={t('agents')} />
          {SITELINK_PAGES.filter((item) => item.key === 'forEmployers' || item.key === 'announceJob').map((item) => (
            <NavLink key={item.key} href={item.href} className="hidden 2xl:inline-flex">
              {t(item.key)}
            </NavLink>
          ))}
        </nav>

        <div className="ms-auto flex shrink-0 items-center justify-self-end gap-0.5 sm:gap-2">
          {ENGLISH_ENABLED ? <LocaleSwitcher locale={locale} label={t('language')} /> : null}
          <HeaderAccount variant="bar" {...labels} />

          <MobileNav label={t('menu')}>
            {nav.map((item) => (
              <NavLink key={item.href} href={item.href} block>
                {navLabel(item.key)}
              </NavLink>
            ))}
            <LiveAgentsLink label={t('agents')} block />
            {SITELINK_PAGES.filter((item) => item.key === 'forEmployers' || item.key === 'announceJob').map((item) => (
              <NavLink key={item.key} href={item.href} block>
                {t(item.key)}
              </NavLink>
            ))}
            {SITELINK_AREAS.map((area) => (
              <NavLink key={area.slug} href={areaLandingPath(area.slug)} block>
                {tFooter(area.key)}
              </NavLink>
            ))}

            <div className="my-1 h-px bg-border" />

            <HeaderAccount variant="menu" {...labels} />
          </MobileNav>
        </div>
      </div>
    </HeaderShell>
  );
}
