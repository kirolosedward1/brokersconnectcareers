import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { ShieldAlert } from 'lucide-react';
import { redirect } from '@/i18n/navigation';
import { asLocale } from '@/i18n/routing';
import { CONSOLE_MESSAGES, PUBLIC_MESSAGES, pick } from '@/i18n/client-messages';
import { AppShell, type AppNavGroup } from '@/components/dashboard/app-shell';
import { MailOffBanner } from '@/components/admin/mail-off-banner';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { NotificationItem } from '@/components/notifications/notification-item';
import { Link } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/server';
import { optional } from '@/lib/queries/error';
import type {
  AdminSummary,
  EmployerSummary,
  NotificationRow,
} from '@/lib/supabase/database.types';
import { getViewer } from '@/lib/auth';
import {
  canAccessAdminArea,
  canAccessCandidateArea,
  canAccessEmployerArea,
  canBrowseAgentDirectory,
  isSuspended,
} from '@/lib/permissions';

/**
 * Everything behind a sign-in, under its own chrome.
 *
 * A route group, so no URL changes — /dashboard and /employer are where they
 * always were. What changes is the layout above them: no site header, no
 * footer, no marketing page width. A console and a job board are different
 * products for the same person, and sharing a shell would make every decision
 * about one a compromise about the other.
 *
 * The rail is built from what the viewer may reach, asked of permissions.ts
 * rather than of the role directly, so an admin who also runs a company sees
 * the moderation queues and their own employer area at once, and an admin
 * with no company sees no employer area at all.
 */
export default async function AppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);

  const viewer = await getViewer();
  if (!viewer) redirect({ href: '/sign-in', locale });

  /*
    A read that failed is not an account that has not onboarded — the same
    distinction requireProfile makes, made here too. This layout sent an
    unreadable profile to /onboarding, which then threw, so a database blip
    lost the console shell on the way to the error it was about to show.
  */
  if (viewer!.profileUnreadable) {
    throw new Error('the profile row could not be read');
  }
  if (!viewer!.profile) redirect({ href: '/onboarding', locale });

  // redirect() throws, but its return type does not narrow, so this is the
  // one place the assertion is made rather than repeated at every use.
  const profile = viewer!.profile!;
  const role = profile.role;
  const actor = viewer!;

  // The feed and its count, read under the viewer's own session — RLS is what
  // scopes them, not a filter written here. Six is what fits in the panel
  // without it becoming a page of its own.
  const supabase = await createClient();
  const [{ data: recent }, { count: unread }] = await Promise.all([
    supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(6),
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .is('read_at', null),
  ]);
  const notifications = (recent ?? []) as NotificationRow[];

  const showEmployer = canAccessEmployerArea(actor);
  const showAdmin = canAccessAdminArea(actor);
  const showCandidate = canAccessCandidateArea(actor);

  /**
   * What is waiting, for the badges on the rail.
   *
   * One summary call per area the viewer actually has. A candidate gets none:
   * the numbers available for them — total applications, total replies —
   * only ever go up, and a badge that never clears teaches people to ignore
   * the badges that do.
   *
   * Wrapped so the console still renders if the call fails. A rail without
   * counts is a rail; a rail that throws is a locked-out user.
   */
  const [adminSummary, employerSummary] = await Promise.all([
    showAdmin
      ? optional(supabase.rpc('admin_summary').then((r) => r.data), null)
      : Promise.resolve(null),
    showEmployer
      ? optional(supabase.rpc('employer_summary').then((r) => r.data), null)
      : Promise.resolve(null),
  ]);

  const adminCounts = adminSummary as AdminSummary | null;
  const employer = employerSummary as EmployerSummary | null;
  const employerCounts = employer && employer.has_company ? employer : null;

  const t = await getTranslations('dashboard');
  const tNotifications = await getTranslations('notifications');
  const tEmployer = await getTranslations('employer');
  const tAdmin = await getTranslations('admin');
  const tAccount = await getTranslations('account');
  const tNav = await getTranslations('nav');
  const tOnboarding = await getTranslations('onboarding');

  const candidateGroup: AppNavGroup = {
    label: t('title'),
    items: [
      { href: '/dashboard', label: t('overview'), icon: 'overview' },
      /*
        The way out to the board, which the console did not have.

        Every other item here is somewhere a candidate's own things live —
        their applications, their saved jobs, their profile — and the one thing
        they came to do, look for work, was reachable only from the empty
        state on the overview, which disappears the moment they apply once.
      */
      { href: '/jobs', label: tNav('browseJobs'), icon: 'browse' },
      { href: '/dashboard/applications', label: t('applications'), icon: 'applications' },
      { href: '/dashboard/saved', label: t('saved'), icon: 'saved' },
      { href: '/dashboard/profile', label: t('profile'), icon: 'profile' },
    ],
  };

  const employerGroup: AppNavGroup = {
    label: tNav('employerArea'),
    items: [
      { href: '/employer', label: t('overview'), icon: 'overview' },
      {
        href: '/employer/applicants',
        label: tEmployer('allApplicants'),
        icon: 'applicants',
        badge: employerCounts?.applicants_new,
      },
      { href: '/employer/jobs', label: tEmployer('jobs'), icon: 'applications' },
      /*
        The directory, from the console. It was reachable only through the
        public site's header, so an employer working the inbox had to leave
        the console to find the one page that answers "who else is out
        there". Offered only to accounts the directory answers — an employer
        still awaiting approval sees the item the day they are approved.
      */
      ...(canBrowseAgentDirectory(actor)
        ? [{ href: '/agents' as const, label: tNav('agents'), icon: 'directory' as const }]
        : []),
      { href: '/employer/talent', label: tEmployer('shortlist'), icon: 'shortlist' },
      { href: '/employer/company', label: tEmployer('company'), icon: 'company' },
      { href: '/employer/billing', label: tEmployer('billing'), icon: 'billing' },
    ],
  };

  const adminGroup: AppNavGroup = {
    label: tAdmin('title'),
    items: [
      { href: '/admin', label: t('overview'), icon: 'admin' },
      {
        href: '/admin/jobs',
        label: tAdmin('jobsQueue'),
        icon: 'queue',
        badge: adminCounts?.queue_total,
      },
      {
        href: '/admin/companies',
        label: tAdmin('companiesQueue'),
        icon: 'company',
        badge: adminCounts?.companies_pending,
      },
      {
        href: '/admin/reports',
        label: tAdmin('reports'),
        icon: 'reports',
        badge: adminCounts?.reports_open,
      },
      {
        href: '/admin/users',
        label: tAdmin('users'),
        icon: 'users',
        badge: adminCounts?.accounts_pending,
      },
      { href: '/admin/email', label: tAdmin('emailActivity'), icon: 'email' },
      // The directory, for review. Admins read it whole.
      { href: '/agents', label: tNav('agents'), icon: 'directory' },
    ],
  };

  const accountGroup: AppNavGroup = {
    label: tAccount('title'),
    items: [
      { href: '/notifications', label: tNotifications('title'), icon: 'notifications' },
      { href: '/dashboard/account', label: tAccount('title'), icon: 'settings' },
    ],
  };

  const groups: AppNavGroup[] = [
    ...(showAdmin ? [adminGroup] : []),
    ...(showEmployer ? [employerGroup] : []),
    ...(showCandidate ? [candidateGroup] : []),
    accountGroup,
  ];

  /*
    A suspended account.

    An admin turned this account off, and until now the console did not say
    so: the pages rendered, the database quietly returned nothing, and the
    person was left with empty lists and buttons that did not work. The
    reason for suspending somebody is that they should not be doing any of
    this, so the console says that instead of the pages — with the account
    settings and sign-out still reachable, because their own data is still
    theirs.
  */
  const suspended = isSuspended(actor);

  /*
    A second provider, nested inside the public one.

    The root layout ships only what the public site's client components read,
    because a visitor to the job board has no use for the job wizard's copy or
    the moderation queue's. Everything under here does, so this adds the other
    half — inheriting locale, formats and the rest from the provider above.
  */
  return (
    <NextIntlClientProvider
      messages={pick(await getMessages(), [...PUBLIC_MESSAGES, ...CONSOLE_MESSAGES])}
    >
    <AppShell
      groups={suspended ? [accountGroup] : groups}
      bell={
        <NotificationBell label={tNotifications('title')} unread={unread ?? 0}>
          <div className="flex items-center justify-between gap-2 border-b border-border ps-3 pe-1.5 py-1">
            <p className="text-sm font-semibold">{tNotifications('title')}</p>
            <Link
              href="/notifications"
              className="inline-flex min-h-11 items-center rounded-lg px-2.5 text-xs font-medium text-primary hover:underline"
            >
              {tNotifications('seeAll')}
            </Link>
          </div>

          {/* The list caps at 24rem, or at whatever is left below the header —
              the panel is pinned under a 64px bar on a phone, and a landscape
              screen is shorter than this list wants to be. */}
          {notifications.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              {tNotifications('empty')}
            </p>
          ) : (
            <ul className="max-h-[min(24rem,calc(100vh-9rem))] overflow-y-auto p-1">
              {notifications.map((notification) => (
                <li key={notification.id}>
                  <NotificationItem notification={notification} locale={locale} compact />
                </li>
              ))}
            </ul>
          )}
        </NotificationBell>
      }
      name={profile.full_name}
      avatarUrl={profile.avatar_url}
      roleLabel={role === 'employer' ? tOnboarding('roleEmployer') : role === 'admin' ? tAdmin('title') : tOnboarding('roleCandidate')}
      locale={locale}
    >
      {/* Admins only: a platform that cannot send email should say so on every
          console page, not only the one page about email. */}
      {showAdmin ? <MailOffBanner /> : null}

      {suspended ? (
        <div
          role="alert"
          className="mx-auto max-w-2xl rounded-xl border border-destructive/30 bg-destructive/5 p-6"
        >
          <p className="flex items-center gap-2 text-lg font-semibold">
            <ShieldAlert className="size-5 shrink-0 text-destructive" aria-hidden />
            {tAccount('suspendedTitle')}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {tAccount('suspendedBody')}
          </p>
          {profile.approval_note ? (
            <p className="mt-3 rounded-lg bg-card px-4 py-3 text-sm">{profile.approval_note}</p>
          ) : null}
        </div>
      ) : (
        children
      )}
    </AppShell>
    </NextIntlClientProvider>
  );
}
