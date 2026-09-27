import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { asLocale } from '@/i18n/routing';
import { CONSOLE_MESSAGES, PUBLIC_MESSAGES, pick } from '@/i18n/client-messages';
import { AppShell, type AppNavGroup } from '@/components/dashboard/app-shell';
import { MailOffBanner } from '@/components/admin/mail-off-banner';
import { NotificationMenu } from '@/components/notifications/notification-menu';
import { createClient } from '@/lib/supabase/server';
import { optional } from '@/lib/queries/error';
import type { AdminSummary, EmployerSummary } from '@/lib/supabase/database.types';
import { getViewer } from '@/lib/auth';

/**
 * Everything behind a sign-in, under its own chrome.
 *
 * A route group, so no URL changes — /dashboard and /employer are where they
 * always were. What changes is the layout above them: no site header, no
 * footer, no marketing page width. A console and a job board are different
 * products for the same person, and sharing a shell would make every decision
 * about one a compromise about the other.
 *
 * The rail is built from the viewer's role rather than from the section they
 * happen to be in, so an admin can see the moderation queues and their own
 * employer area at once instead of navigating between two separate menus.
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
  if (!viewer!.profile) redirect({ href: '/onboarding', locale });

  // redirect() throws, but its return type does not narrow, so this is the
  // one place the assertion is made rather than repeated at every use.
  const profile = viewer!.profile!;
  const role = profile.role;

  const supabase = await createClient();

  /**
   * What is waiting, for the badges on the rail.
   *
   * One summary call, chosen by role, and only for the two roles that have
   * queues. A candidate gets none: the numbers available for them — total
   * applications, total replies — only ever go up, and a badge that never
   * clears teaches people to ignore the badges that do.
   *
   * Wrapped so the console still renders if the call fails. A rail without
   * counts is a rail; a rail that throws is a locked-out user.
   */
  const [adminSummary, employerSummary] = await Promise.all([
    role === 'admin'
      ? optional(supabase.rpc('admin_summary').then((r) => r.data), null)
      : Promise.resolve(null),
    // Admins get this one too. The rail shows them both areas, so scoping the
    // applicant count to `role === 'employer'` would leave an admin who also
    // runs a company with a badge on the moderation queues and none on their
    // own applicants — a rule with a hole in it rather than a rule.
    role === 'admin' || role === 'employer'
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
        href: '/admin/appeals',
        label: tAdmin('appeals'),
        icon: 'appeals',
        badge: adminCounts?.appeals_open,
      },
      {
        href: '/admin/users',
        label: tAdmin('users'),
        icon: 'users',
        badge: adminCounts?.accounts_pending,
      },
      { href: '/admin/applications', label: tAdmin('applications'), icon: 'inbox' },
      { href: '/admin/agents', label: tAdmin('agents'), icon: 'agents' },
      { href: '/admin/search', label: tAdmin('search'), icon: 'search' },
      { href: '/admin/audit', label: tAdmin('auditLog'), icon: 'audit' },
      { href: '/admin/taxonomy', label: tAdmin('taxonomy'), icon: 'taxonomy' },
      { href: '/admin/email', label: tAdmin('emailActivity'), icon: 'email' },
    ],
  };

  const accountGroup: AppNavGroup = {
    label: tAccount('title'),
    items: [
      { href: '/notifications', label: tNotifications('title'), icon: 'notifications' },
      { href: '/dashboard/account', label: tAccount('title'), icon: 'settings' },
    ],
  };

  const groups =
    role === 'admin'
      ? [adminGroup, employerGroup, accountGroup]
      : role === 'employer'
        ? [employerGroup, accountGroup]
        : [candidateGroup, accountGroup];

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
      groups={groups}
      bell={<NotificationMenu locale={locale} />}
      name={profile.full_name}
      avatarUrl={profile.avatar_url}
      roleLabel={role === 'employer' ? tOnboarding('roleEmployer') : role === 'admin' ? tAdmin('title') : tOnboarding('roleCandidate')}
      locale={locale}
    >
      {/* Admins only: a platform that cannot send email should say so on every
          console page, not only the one page about email. */}
      {role === 'admin' ? <MailOffBanner /> : null}
      {children}
    </AppShell>
    </NextIntlClientProvider>
  );
}
