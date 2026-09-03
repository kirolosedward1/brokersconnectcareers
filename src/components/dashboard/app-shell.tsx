'use client';

import { useEffect, useState } from 'react';
import {
  Bookmark,
  Briefcase,
  Building2,
  CreditCard,
  FileCheck2,
  Flag,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  Settings,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
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
  saved: Bookmark,
  profile: UserRound,
  company: Building2,
  billing: CreditCard,
  queue: FileCheck2,
  reports: Flag,
  admin: ShieldCheck,
  settings: Settings,
} as const;

export type AppIcon = keyof typeof ICONS;

export type AppNavGroup = {
  label: string;
  items: { href: string; label: string; icon: AppIcon }[];
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
  roleLabel,
  locale,
  children,
}: {
  groups: AppNavGroup[];
  name: string;
  roleLabel: string;
  locale: Locale;
  children: React.ReactNode;
}) {
  const t = useTranslations('dashboard');
  const tNav = useTranslations('nav');
  const pathname = usePathname();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

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
    router.replace('/', { locale });
    router.refresh();
  }

  const rail = (
    <div className="flex h-full flex-col gap-6 p-4">
      <Link href="/" className="flex items-center gap-2.5 px-2 py-1">
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
              {group.items.map(({ href, label, icon }) => {
                const Icon = ICONS[icon];
                const active = pathname === href;
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      aria-current={active ? 'page' : undefined}
                      title={collapsed ? label : undefined}
                      className={cn(
                        'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                        active
                          ? 'bg-brand-gradient text-primary-foreground shadow-[var(--shadow-primary)]'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                        collapsed && 'justify-center px-2',
                      )}
                    >
                      <Icon className="size-[1.15rem] shrink-0" aria-hidden />
                      {collapsed ? <span className="sr-only">{label}</span> : label}
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
        className={cn(
          'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-destructive',
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
              className="absolute end-3 top-3 rounded-lg p-2 text-muted-foreground hover:bg-muted"
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
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted lg:hidden"
          >
            <Menu className="size-5" aria-hidden />
          </button>

          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={t('overview')}
            aria-pressed={collapsed}
            className="hidden rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted lg:block"
          >
            <PanelLeftClose className={cn('size-5 transition-transform', collapsed && 'rotate-180')} aria-hidden />
          </button>

          <div className="ms-auto flex items-center gap-3">
            <div className="text-end">
              <p className="text-sm font-medium leading-tight">{name}</p>
              <p className="text-xs text-muted-foreground">{roleLabel}</p>
            </div>
            <span
              aria-hidden
              className="bg-brand-gradient grid size-9 place-items-center rounded-full text-sm font-bold text-primary-foreground"
            >
              {name.trim().charAt(0)}
            </span>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
