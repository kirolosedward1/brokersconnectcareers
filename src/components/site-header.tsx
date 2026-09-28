import { getTranslations } from 'next-intl/server';
import { LayoutDashboard, Search, ShieldCheck, Users } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { ENGLISH_ENABLED, type Locale } from '@/i18n/routing';
import { actorOf, getViewer } from '@/lib/auth';
import { canAccessEmployerArea, homeFor, postJobHref, siteNavFor } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/logo';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { UserMenu } from '@/components/user-menu';
import { MobileNav } from '@/components/mobile-nav';
import { NavLink } from '@/components/nav-link';
import { NotificationMenu } from '@/components/notifications/notification-menu';
import { HeaderShell } from '@/components/header-shell';

export async function SiteHeader({ locale }: { locale: Locale }) {
  const t = await getTranslations('nav');
  const tMeta = await getTranslations('meta');
  const tAccount = await getTranslations('account');
  const tNotifications = await getTranslations('notifications');
  const viewer = await getViewer();
  const actor = actorOf(viewer);
  const role = viewer?.profile?.role;

  /*
    One list for both bars.

    The desktop nav and the phone menu read the same `siteNavFor`, and it is
    role-aware: the consultant directory is offered to the people who can
    open it and to nobody else. A candidate never sees a link that would turn
    them away, and the two menus cannot disagree because there is one source.
  */
  const nav = siteNavFor(actor);
  const dashboardHref = homeFor(actor);
  const hiring = canAccessEmployerArea(actor);
  const postJob = postJobHref(actor);

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
          two outer cells the same width whenever they can be, so the mark sits
          at the true centre of the bar. From `md` it is the ordinary row: mark
          at the start, nav beside it, controls pushed to the end.

          `minmax(max-content, 1fr)`, not `minmax(0, 1fr)`. The zero minimum
          kept the mark centred by letting the end cell shrink below its
          contents, which was fine while those were one button. Signed in they
          are three — the bell, the account and the menu, 144px — and a 106px
          cell on a 375px phone spilled them 22px off the page, on every public
          page, for everybody signed in. Now each outer cell is at least what
          it holds and they share what is left: equal, and the mark centred,
          wherever that fits; off centre by the difference where it does not,
          which beats a page that scrolls sideways. */}
      <div className="shell grid h-14 grid-cols-[minmax(max-content,1fr)_auto_minmax(max-content,1fr)] items-center gap-2 sm:h-16 md:flex">
        <Link
          href="/jobs"
          aria-label={t('jobs')}
          className="grid size-11 place-items-center justify-self-start rounded-lg transition-colors hover:bg-muted group-data-[over-hero]/header:hover:bg-white/15 md:hidden"
        >
          <Search className="size-4" />
        </Link>

        <Link href="/" className="flex min-h-11 shrink-0 items-center justify-self-center">
          {/* Below 360px the three controls and the wordmark do not fit
              together, so a signed-in reader — who knows where they are —
              keeps the mark and hears the name. A visitor keeps both at every
              width; theirs is the one-button row. */}
          <Logo
            name={tMeta('siteName')}
            nameClassName={viewer?.profile ? 'max-[359px]:sr-only' : undefined}
          />
        </Link>

        {/* Full nav from md up. Below that it moves into the disclosure at the
            end of the row — three links plus auth plus a CTA does not fit on a
            360px phone, and this market is overwhelmingly mobile. */}
        <nav className="ms-2 hidden items-center gap-1 text-sm md:flex">
          {nav.map((link) => (
            <NavLink key={link.href} href={link.href}>
              {t(link.key)}
            </NavLink>
          ))}
        </nav>

        <div className="ms-auto flex shrink-0 items-center justify-self-end gap-0.5 sm:gap-2">
          {ENGLISH_ENABLED ? <LocaleSwitcher locale={locale} label={t('language')} /> : null}

          {role === 'admin' ? (
            <Button asChild variant="ghost" className={`hidden lg:inline-flex ${ghostOnFilm}`}>
              <Link href="/admin">
                <ShieldCheck /> {t('admin')}
              </Link>
            </Button>
          ) : null}

          {viewer?.profile ? (
            <>
              {/* An admin's home is the admin button beside this one; a second
                  button to the same place is noise. */}
              {role === 'admin' ? null : (
                <Button asChild variant="ghost" className={`hidden lg:inline-flex ${ghostOnFilm}`}>
                  <Link href={dashboardHref}>
                    {hiring ? <Users /> : <LayoutDashboard />}
                    {hiring ? t('employerArea') : t('dashboard')}
                  </Link>
                </Button>
              )}
              {/* The same bell the console has. An employer reading their own
                  company page is where an application lands, and until now the
                  only place that said so was a screen they had navigated away
                  from. It never sits on the hero film: HeaderShell floats only
                  when nobody is signed in, and nobody signed out has a bell. */}
              <NotificationMenu locale={locale} userId={viewer.userId} />
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
              {postJob ? (
                <Button asChild className="hidden sm:inline-flex">
                  <Link href={postJob}>{t('postJob')}</Link>
                </Button>
              ) : null}
            </>
          )}

          {/* Still a disclosure, so it works server-rendered with no JavaScript.
              MobileNav adds what a bare <details> cannot do: close on a
              client-side navigation, on an outside tap, and on Escape. */}
          <MobileNav label={t('menu')}>
              {nav.map((item) => (
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
                    {role === 'admin' ? t('admin') : hiring ? t('employerArea') : t('dashboard')}
                  </Link>
                  {/* The admin's console is the link above (homeFor sends
                      them to /admin), so no second admin link here. */}
                  <Link
                    href="/notifications"
                    className="flex min-h-11 items-center rounded-lg px-3 py-2 text-sm transition-colors hover:bg-muted"
                  >
                    {tNotifications('title')}
                  </Link>
                </>
              ) : (
                <Link
                  href="/sign-in"
                  className="flex min-h-11 items-center rounded-lg px-3 py-2 text-sm transition-colors hover:bg-muted"
                >
                  {t('signIn')}
                </Link>
              )}

            {/* Only for somebody who can post — a visitor, through the
                employer door, or an employer. It was here for every role,
                and a candidate who tapped it was bounced to their dashboard. */}
            {postJob ? (
              <Link
                href={postJob}
                className="mt-1 flex min-h-11 bg-primary items-center justify-center rounded-lg px-3 text-center text-sm font-medium text-primary-foreground"
              >
                {t('postJob')}
              </Link>
            ) : null}
          </MobileNav>
        </div>
      </div>
    </HeaderShell>
  );
}
