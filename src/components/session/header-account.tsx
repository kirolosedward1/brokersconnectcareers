'use client';

import { LayoutDashboard, LogIn, PlusCircle, ShieldCheck, Users } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { SiteBell } from '@/components/notifications/site-bell';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/logo';
import { NavLink } from '@/components/nav-link';
import { UserMenu } from '@/components/user-menu';
import { useSession } from '@/components/session/session-provider';

const ghostOnFilm = 'group-data-[over-hero]/header:hover:bg-white/15';

export function HeaderWordmark({ name }: { name: string }) {
  const session = useSession();
  const signedIn = session.kind !== 'anon';
  return <Logo name={name} nameClassName={signedIn ? 'max-[359px]:sr-only' : undefined} />;
}

/** The directory link, only for a reader the directory will actually open for. */
export function LiveAgentsLink({
  label,
  block = false,
  className,
}: {
  label: string;
  block?: boolean;
  /** Set in the footer, where the link should match the other footer links. */
  className?: string;
}) {
  const session = useSession();
  if (session.kind !== 'user' || !session.showAgents) return null;
  if (className) {
    return (
      <li>
        <Link href="/agents" className={className}>
          {label}
        </Link>
      </li>
    );
  }
  return (
    <NavLink href="/agents" block={block} className={block ? undefined : 'hidden lg:inline-flex'}>
      {label}
    </NavLink>
  );
}

/**
 * The account cluster.
 *
 * Rendered twice: once in the bar, once in the phone menu. The first paint is
 * the signed-out controls, which is also what a crawler sees. A session cookie
 * swaps them before paint.
 */
export function HeaderAccount({
  variant,
  locale,
  signIn,
  postJob,
  admin,
  employerArea,
  dashboard,
  signOut,
  account,
  notifications,
  anonymousPostHref,
}: {
  variant: 'bar' | 'menu';
  locale: Locale;
  signIn: string;
  postJob: string;
  admin: string;
  employerArea: string;
  dashboard: string;
  signOut: string;
  account: string;
  notifications: string;
  anonymousPostHref: string;
}) {
  const session = useSession();

  if (session.kind === 'pending') {
    return variant === 'bar' ? <span className="inline-block size-11" aria-hidden /> : null;
  }

  if (session.kind === 'anon') {
    if (variant === 'menu') {
      return (
        <>
          <Link
            href="/sign-in"
            className="flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-muted"
          >
            <LogIn className="rtl-flip size-4" aria-hidden />
            {signIn}
          </Link>
          <Link
            href={anonymousPostHref}
            className="mt-1 flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-3 text-center text-sm font-medium text-primary-foreground"
          >
            <PlusCircle className="size-4" aria-hidden />
            {postJob}
          </Link>
        </>
      );
    }
    return (
      <>
        <Button asChild variant="ghost" className={`hidden sm:inline-flex ${ghostOnFilm}`}>
          <Link href="/sign-in">
            <LogIn className="rtl-flip" aria-hidden />
            {signIn}
          </Link>
        </Button>
        <Button asChild className="hidden sm:inline-flex">
          <Link href={anonymousPostHref}>
            <PlusCircle aria-hidden />
            {postJob}
          </Link>
        </Button>
      </>
    );
  }

  const hiring = session.role === 'employer' || session.role === 'admin';
  const homeLabel = session.role === 'admin' ? admin : hiring ? employerArea : dashboard;

  if (variant === 'menu') {
    return (
      <>
        <Link
          href={session.homeHref}
          className="flex min-h-11 items-center rounded-lg px-3 py-2 text-sm transition-colors hover:bg-muted"
        >
          {homeLabel}
        </Link>
        <Link
          href="/dashboard/notifications"
          className="flex min-h-11 items-center rounded-lg px-3 py-2 text-sm transition-colors hover:bg-muted"
        >
          {notifications}
          {session.unread > 0 ? <span className="numeral ms-2 text-xs">{session.unread}</span> : null}
        </Link>
        {session.postJobHref ? (
          <Link
            href={session.postJobHref}
            className="mt-1 flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-3 text-center text-sm font-medium text-primary-foreground"
          >
            <PlusCircle className="size-4" aria-hidden />
            {postJob}
          </Link>
        ) : null}
      </>
    );
  }

  return (
    <>
      {session.role === 'admin' ? (
        <Button asChild variant="ghost" className={`hidden lg:inline-flex ${ghostOnFilm}`}>
          <Link href="/admin">
            <ShieldCheck aria-hidden /> {admin}
          </Link>
        </Button>
      ) : (
        <Button asChild variant="ghost" className={`hidden lg:inline-flex ${ghostOnFilm}`}>
          <Link href={session.homeHref}>
            {hiring ? <Users aria-hidden /> : <LayoutDashboard aria-hidden />}
            {hiring ? employerArea : dashboard}
          </Link>
        </Button>
      )}
      <SiteBell locale={locale} initialUnread={session.unread} />
      <UserMenu
        name={session.name}
        avatarUrl={session.avatarUrl}
        signOutLabel={signOut}
        accountLabel={account}
        locale={locale}
      />
    </>
  );
}
