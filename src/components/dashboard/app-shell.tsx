'use client';

import { useEffect, useState } from 'react';
import {
  Bell,
  Bookmark,
  Briefcase,
  Building2,
  CreditCard,
  FileCheck2,
  Flag,
  LayoutDashboard,
  Mail,
  LogOut,
  Menu,
  PanelLeftClose,
  Search,
  Settings,
  ShieldCheck,
  UserCog,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { Avatar } from '@/components/ui/avatar';
import { dirOf, localeHref, type Locale } from '@/i18n/routing';
import { LogoMark } from '@/components/logo';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

/**
 * Icons are named, not passed.
 *
 * The rail is built in a server layout and rendered here in the browser, and a
 * component is a function — React cannot send one across that boundary. So the
 * server names the icon and this side looks it up.
 */
const ICONS = {
  overview: LayoutDashboard,
  applications: Briefcase,
  applicants: Users,
  saved: Bookmark,
  browse: Search,
  profile: UserRound,
  company: Building2,
  billing: CreditCard,
  queue: FileCheck2,
  reports: Flag,
  admin: ShieldCheck,
  users: UserCog,
  email: Mail,
  notifications: Bell,
  settings: Settings,
} as const;

export type AppIcon = keyof typeof ICONS;

export type AppNavGroup = {
  label: string;
  items: {
    href: string;
    label: string;
    icon: AppIcon;
    /**
     * How many things are waiting behind this link.
     *
     * Derived state, never an event log: it is counted at render and it goes
     * down when the work is done. That rules out anything cumulative — a
     * candidate's total replies would sit there forever, teaching people to
     * ignore the badges that do mean something.
     */
    badge?: number;
  }[];
};

/**
 * The dashboard's own chrome — deliberately not the marketing site's.
 *
 * A job board and an admin console are different products for the same person.
 * The site is a wide, airy page you read; this is a dense surface you operate,
 * so it gets a fixed rail, a tinted canvas behind white cards, and none of the
 * site's header or footer. Sharing chrome between the two would mean every
 * decision about one is a compromise about the other.
 *
 * The rail collapses to icons on desktop and becomes an overlay on phones.
 * That is the opposite of the reasoning on the section nav, and for a reason:
 * this list is long enough not to fit across a phone, so a drawer is buying
 * space rather than hiding a row that fits.
 */
export function AppShell({
  groups,
  name,
  avatarUrl,
  roleLabel,
  locale,
  bell,
  children,
}: {
  groups: AppNavGroup[];
  name: string;
  avatarUrl: string | null;
  roleLabel: string;
  locale: Locale;
  /**
   * Server-rendered, and passed in rather than fetched here. The count and the
   * list are read under the viewer's own session in the layout; duplicating
   * that in client state would be a second source of truth that goes stale the
   * moment anything else marks one read.
   */
  bell?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useTranslations('dashboard');
  const tNav = useTranslations('nav');
  const pathname = usePathname();

  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  /*
    The label for a collapsed rail item, drawn beside it.

    `title` was doing this, which is the browser's tooltip: about a second of
    hover before it appears, nothing at all on keyboard focus, and no way to
    style it — so on a rail of seven identical icons the only way to learn what
    one does was to hover and wait, or click and find out.

    Fixed rather than absolute, because the rail scrolls: `overflow-y-auto`
    clips horizontally too — CSS resolves a `visible` cross-axis to `auto` — so
    anything positioned beside an item from inside that container is cut off at
    the rail's edge. Positioned from the item's own rect instead, and rendered
    outside the sidebar entirely.
  */
  const [tip, setTip] = useState<{
    label: string;
    top: number;
    left?: number;
    right?: number;
  } | null>(null);

  function showTip(event: React.MouseEvent | React.FocusEvent, label: string) {
    if (!collapsed) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const top = rect.top + rect.height / 2;
    // The rail sits at the inline start, which is the right in Arabic, so the
    // label goes to whichever side is away from it.
    setTip(
      dirOf(locale) === 'rtl'
        ? { label, top, right: window.innerWidth - rect.left + 8 }
        : { label, top, left: rect.right + 8 },
    );
  }

  const hideTip = () => setTip(null);

  // Nothing to point at once the labels are back on screen.
  useEffect(() => {
    if (!collapsed) setTip(null);
  }, [collapsed]);

  // The overlay must not survive arriving somewhere: the App Router keeps this
  // layout mounted across a route change, so nothing closes it on its own.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  async function signOut() {
    await createClient().auth.signOut();
    /*
      A document navigation, not a router push. Signing out changes who the
      server thinks you are, and a client push races the refresh that was
      there to tell it — the sign-in form landed on a blank page that way.
      A full load costs one request and cannot get this wrong.
    */
    window.location.assign(localeHref(locale, '/'));
  }

  const rail = (
    <div className="flex h-full flex-col gap-6 p-4">
      <Link href="/" className="flex min-h-11 items-center gap-2.5 px-2">
        <LogoMark className="size-8" />
        {collapsed ? null : <span className="font-semibold">{tNav('dashboard')}</span>}
      </Link>

      <nav className="flex-1 space-y-6 overflow-y-auto">
        {groups.map((group) => (
          <div key={group.label}>
            {collapsed ? null : (
              <p className="mb-2 px-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {group.label}
              </p>
            )}
            <ul className="space-y-1">
              {group.items.map(({ href, label, icon, badge }) => {
                const Icon = ICONS[icon];
                const active = pathname === href;
                const waiting = badge && badge > 0 ? badge : null;

                return (
                  <li key={href}>
                    <Link
                      href={href}
                      aria-current={active ? 'page' : undefined}
                      onMouseEnter={(event) => showTip(event, label)}
                      onFocus={(event) => showTip(event, label)}
                      onMouseLeave={hideTip}
                      onBlur={hideTip}
                      className={cn(
                        'relative flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors',
                        active
                          ? 'bg-brand-gradient text-primary-foreground shadow-[var(--shadow-primary)]'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                        collapsed && 'justify-center px-2',
                      )}
                    >
                      <Icon className="size-[1.15rem] shrink-0" aria-hidden />
                      {collapsed ? <span className="sr-only">{label}</span> : label}

                      {/* Collapsed, the count has nowhere to sit, so it becomes
                          a dot on the icon — still says "something here",
                          which is the whole job at that width. */}
                      {waiting ? (
                        collapsed ? (
                          <span
                            aria-hidden
                            className="absolute end-2 top-2 size-2 rounded-full bg-destructive"
                          />
                        ) : (
                          <span
                            className={cn(
                              'numeral ms-auto rounded-full px-1.5 text-xs font-semibold leading-5',
                              active
                                ? 'bg-white/25 text-primary-foreground'
                                : 'bg-destructive/12 text-destructive',
                            )}
                          >
                            {waiting > 99 ? '99+' : waiting}
                          </span>
                        )
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <button
        type="button"
        onClick={signOut}
        onMouseEnter={(event) => showTip(event, tNav('signOut'))}
        onFocus={(event) => showTip(event, tNav('signOut'))}
        onMouseLeave={hideTip}
        onBlur={hideTip}
        className={cn(
          'flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-destructive',
          collapsed && 'justify-center px-2',
        )}
      >
        <LogOut className="size-[1.15rem] shrink-0" aria-hidden />
        {collapsed ? <span className="sr-only">{tNav('signOut')}</span> : tNav('signOut')}
      </button>
    </div>
  );

  return (
    <div className="min-h-dvh bg-muted/40">
      {/* Desktop rail */}
      <aside
        className={cn(
          'fixed inset-y-0 start-0 z-30 hidden border-e border-border bg-card lg:block',
          collapsed ? 'w-[5.25rem]' : 'w-64',
        )}
      >
        {rail}
      </aside>

      {/* Phone overlay */}
      {open ? (
        <>
          <button
            type="button"
            aria-label={tNav('menu')}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 bg-slate-950/40 lg:hidden"
          />
          <aside className="fixed inset-y-0 start-0 z-50 w-72 border-e border-border bg-card lg:hidden">
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={tNav('menu')}
              className="absolute end-2 top-2 grid size-11 place-items-center rounded-lg text-muted-foreground hover:bg-muted"
            >
              <X className="size-5" aria-hidden />
            </button>
            {rail}
          </aside>
        </>
      ) : null}

      <div className={cn('flex min-h-dvh flex-col', collapsed ? 'lg:ps-[5.25rem]' : 'lg:ps-64')}>
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-card px-4">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={tNav('menu')}
            className="grid size-11 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted lg:hidden"
          >
            <Menu className="size-5" aria-hidden />
          </button>

          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? tNav('expandMenu') : tNav('collapseMenu')}
            aria-pressed={collapsed}
            className="hidden size-11 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted lg:grid"
          >
            <PanelLeftClose className={cn('size-5 transition-transform', collapsed && 'rotate-180')} aria-hidden />
          </button>

          <div className="ms-auto flex items-center gap-3">
            {bell}

            <div className="text-end">
              <p className="text-sm font-medium leading-tight">{name}</p>
              <p className="text-xs text-muted-foreground">{roleLabel}</p>
            </div>
            <Avatar name={name} src={avatarUrl} />
          </div>
        </header>

        {/*
          Centred, with a ceiling.

          The console had no maximum width, so on a 27-inch monitor a profile
          form ran the full 1600px: a single column of Arabic pinned to the
          right edge with half a metre of empty page beside it. The rail is
          already fixed-width, so everything past about 1280px was being spent
          on nothing. 7xl rather than the marketing pages' 6xl because this
          side is denser — the candidate dashboard lays out six stat tiles in
          a row, and squeezing those to fit a reading measure would trade one
          bad layout for another.
        */}
        <main id="main" tabIndex={-1} className="flex-1 p-4 sm:p-6 lg:p-8">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
      </div>

      {/* aria-hidden: every rail item already carries its label in an sr-only
          span, so announcing this too would read the name twice. */}
      {collapsed && tip ? (
        <div
          aria-hidden
          className="pointer-events-none fixed z-50 hidden -translate-y-1/2 rounded-lg bg-foreground px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-background shadow-lg lg:block"
          style={{ top: tip.top, left: tip.left, right: tip.right }}
        >
          {tip.label}
        </div>
      ) : null}
    </div>
  );
}
