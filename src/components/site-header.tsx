import { getTranslations } from 'next-intl/server';
import { LayoutDashboard, Menu, Search, ShieldCheck, Users } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { ENGLISH_ENABLED, type Locale } from '@/i18n/routing';
import { getViewer } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/logo';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { UserMenu } from '@/components/user-menu';

const NAV = [
  { href: '/jobs', key: 'jobs' },
  { href: '/companies', key: 'companies' },
  { href: '/agents', key: 'agents' },
  { href: '/blog', key: 'blog' },
] as const;

export async function SiteHeader({ locale }: { locale: Locale }) {
  const t = await getTranslations('nav');
  const tMeta = await getTranslations('meta');
  const viewer = await getViewer();
  const role = viewer?.profile?.role;

  const dashboardHref = role === 'employer' ? '/employer/jobs' : '/dashboard/applications';

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 shadow-xs backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4">
        <Link href="/" className="shrink-0">
          <Logo name={tMeta('siteName')} />
        </Link>

        {/* Full nav from md up. Below that it moves into the disclosure at the
            end of the row — three links plus auth plus a CTA does not fit on a
            360px phone, and this market is overwhelmingly mobile. */}
        <nav className="ms-2 hidden items-center gap-1 text-sm md:flex">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="rounded-lg px-3 py-2 transition-colors hover:bg-muted">
              {t(item.key)}
            </Link>
          ))}
        </nav>

        <div className="ms-auto flex shrink-0 items-center gap-1 sm:gap-2">
          <Link
            href="/jobs"
            aria-label={t('jobs')}
            className="rounded-lg p-2 transition-colors hover:bg-muted md:hidden"
          >
            <Search className="size-4" />
          </Link>

          {ENGLISH_ENABLED ? <LocaleSwitcher locale={locale} label={t('language')} /> : null}

          {role === 'admin' ? (
            <Button asChild variant="ghost" size="sm" className="hidden lg:inline-flex">
              <Link href="/admin/jobs">
                <ShieldCheck /> {t('admin')}
              </Link>
            </Button>
          ) : null}

          {viewer?.profile ? (
            <>
              <Button asChild variant="ghost" size="sm" className="hidden lg:inline-flex">
                <Link href={dashboardHref}>
                  {role === 'employer' ? <Users /> : <LayoutDashboard />}
                  {role === 'employer' ? t('employerArea') : t('dashboard')}
                </Link>
              </Button>
              <UserMenu
                name={viewer.profile.full_name}
                signOutLabel={t('signOut')}
                locale={locale}
              />
            </>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
                <Link href="/sign-in">{t('signIn')}</Link>
              </Button>
              <Button asChild size="sm" className="hidden sm:inline-flex">
                <Link href="/employer/jobs/new">{t('postJob')}</Link>
              </Button>
            </>
          )}

          {/* Disclosure rather than a JS drawer: it works server-rendered, needs
              no client state, and closes on navigation. */}
          <details className="group relative md:hidden">
            <summary
              className="grid size-9 cursor-pointer list-none place-items-center rounded-lg transition-colors hover:bg-muted"
              aria-label={t('menu')}
            >
              <Menu className="size-5" aria-hidden />
            </summary>

            <div className="absolute end-0 top-full z-50 mt-2 w-56 rounded-2xl border border-border bg-popover p-1.5 shadow-lg">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="block rounded-lg px-3 py-2 text-sm transition-colors hover:bg-muted"
                >
                  {t(item.key)}
                </Link>
              ))}

              <div className="my-1 h-px bg-border" />

              {viewer?.profile ? (
                <>
                  <Link
                    href={dashboardHref}
                    className="block rounded-lg px-3 py-2 text-sm transition-colors hover:bg-muted"
                  >
                    {role === 'employer' ? t('employerArea') : t('dashboard')}
                  </Link>
                  {role === 'admin' ? (
                    <Link
                      href="/admin/jobs"
                      className="block rounded-lg px-3 py-2 text-sm transition-colors hover:bg-muted"
                    >
                      {t('admin')}
                    </Link>
                  ) : null}
                </>
              ) : (
                <Link
                  href="/sign-in"
                  className="block rounded-lg px-3 py-2 text-sm transition-colors hover:bg-muted"
                >
                  {t('signIn')}
                </Link>
              )}

              <Link
                href="/employer/jobs/new"
                className="bg-brand-gradient mt-1 block rounded-lg px-3 py-2 text-center text-sm font-medium text-primary-foreground"
              >
                {t('postJob')}
              </Link>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}
