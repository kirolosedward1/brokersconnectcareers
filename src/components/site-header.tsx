import { getTranslations } from 'next-intl/server';
import { LayoutDashboard, Search, ShieldCheck, Users } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { ENGLISH_ENABLED, type Locale } from '@/i18n/routing';
import { getViewer } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/logo';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { UserMenu } from '@/components/user-menu';
import { MobileNav } from '@/components/mobile-nav';
import { NavLink } from '@/components/nav-link';
import { HeaderShell } from '@/components/header-shell';

const NAV = [
  { href: '/jobs', key: 'jobs' },
  { href: '/companies', key: 'companies' },
  { href: '/agents', key: 'agents' },
  { href: '/blog', key: 'blog' },
] as const;

export async function SiteHeader({ locale }: { locale: Locale }) {
  const t = await getTranslations('nav');
  const tMeta = await getTranslations('meta');
  const tAccount = await getTranslations('account');
  const viewer = await getViewer();
  const role = viewer?.profile?.role;

  const dashboardHref = role === 'employer' ? '/employer/jobs' : '/dashboard/applications';

  // Ghost buttons inherit their colour, which is white while the header sits on
  // the film — and their default hover is `bg-muted`, a near-white. White text
  // on a near-white pill is invisible, so the hover has to invert with the
  // header rather than staying the page's.
  const ghostOnFilm = 'group-data-[over-hero]/header:hover:bg-white/15';

  // The home page swaps its hero for a listings feed once you are signed in,
  // and the header has to stop floating when it does.
  return (
    <HeaderShell hasHomeHero={!viewer?.profile}>
      {/* Three cells below `md` — search, the mark, menu and account — with the
          two outer cells the same width, so the mark sits at the true centre
          of the bar. `minmax(0, 1fr)` rather than `1fr`: the bare form has an
          `auto` minimum, so the heavier end cell widened itself and dragged
          the mark off centre. From `md` it is the ordinary row: mark at the
          start, nav beside it, controls pushed to the end. */}
      <div className="shell grid h-14 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:h-16 md:flex">
        <Link
          href="/jobs"
          aria-label={t('jobs')}
          className="grid size-11 place-items-center justify-self-start rounded-lg transition-colors hover:bg-muted group-data-[over-hero]/header:hover:bg-white/15 md:hidden"
        >
          <Search className="size-4" />
        </Link>

        <Link href="/" className="flex min-h-11 shrink-0 items-center justify-self-center">
          <Logo name={tMeta('siteName')} />
        </Link>

        {/* Full nav from md up. Below that it moves into the disclosure at the
            end of the row — three links plus auth plus a CTA does not fit on a
            360px phone, and this market is overwhelmingly mobile. */}
        <nav className="ms-2 hidden items-center gap-1 text-sm md:flex">
          {NAV.map((link) => (
            <NavLink key={link.href} href={link.href}>
              {t(link.key)}
            </NavLink>
          ))}
        </nav>

        <div className="ms-auto flex shrink-0 items-center justify-self-end gap-0.5 sm:gap-2">
          {ENGLISH_ENABLED ? <LocaleSwitcher locale={locale} label={t('language')} /> : null}

          {role === 'admin' ? (
            <Button asChild variant="ghost" className={`hidden lg:inline-flex ${ghostOnFilm}`}>
              <Link href="/admin/jobs">
                <ShieldCheck /> {t('admin')}
              </Link>
            </Button>
          ) : null}

          {viewer?.profile ? (
            <>
              <Button asChild variant="ghost" className={`hidden lg:inline-flex ${ghostOnFilm}`}>
                <Link href={dashboardHref}>
                  {role === 'employer' ? <Users /> : <LayoutDashboard />}
                  {role === 'employer' ? t('employerArea') : t('dashboard')}
                </Link>
              </Button>
              <UserMenu
                name={viewer.profile.full_name}
                avatarUrl={viewer.profile.avatar_url}
                signOutLabel={t('signOut')}
                accountLabel={tAccount('title')}
                locale={locale}
              />
            </>
          ) : (
            <>
              <Button asChild variant="ghost" className={`hidden sm:inline-flex ${ghostOnFilm}`}>
                <Link href="/sign-in">{t('signIn')}</Link>
              </Button>
              <Button asChild className="hidden sm:inline-flex">
                <Link href="/employer/jobs/new">{t('postJob')}</Link>
              </Button>
            </>
          )}

          {/* Still a disclosure, so it works server-rendered with no JavaScript.
              MobileNav adds what a bare <details> cannot do: close on a
              client-side navigation, on an outside tap, and on Escape. */}
          <MobileNav label={t('menu')}>
              {NAV.map((item) => (
                <NavLink key={item.href} href={item.href} block>
                  {t(item.key)}
                </NavLink>
              ))}

              <div className="my-1 h-px bg-border" />

              {viewer?.profile ? (
                <>
                  <Link
                    href={dashboardHref}
                    className="flex min-h-11 items-center rounded-lg px-3 py-2 text-sm transition-colors hover:bg-muted"
                  >
                    {role === 'employer' ? t('employerArea') : t('dashboard')}
                  </Link>
                  {role === 'admin' ? (
                    <Link
                      href="/admin/jobs"
                      className="flex min-h-11 items-center rounded-lg px-3 py-2 text-sm transition-colors hover:bg-muted"
                    >
                      {t('admin')}
                    </Link>
                  ) : null}
                </>
              ) : (
                <Link
                  href="/sign-in"
                  className="flex min-h-11 items-center rounded-lg px-3 py-2 text-sm transition-colors hover:bg-muted"
                >
                  {t('signIn')}
                </Link>
              )}

            <Link
              href="/employer/jobs/new"
              className="mt-1 flex min-h-11 bg-primary items-center justify-center rounded-lg px-3 text-center text-sm font-medium text-primary-foreground"
            >
              {t('postJob')}
            </Link>
          </MobileNav>
        </div>
      </div>
    </HeaderShell>
  );
}
