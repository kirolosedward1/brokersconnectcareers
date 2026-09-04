import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { asLocale } from '@/i18n/routing';
import { AppShell, type AppNavGroup } from '@/components/dashboard/app-shell';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { NotificationItem } from '@/components/notifications/notification-item';
import { Link } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/server';
import type { NotificationRow } from '@/lib/supabase/database.types';
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
      { href: '/dashboard/applications', label: t('applications'), icon: 'applications' },
      { href: '/dashboard/saved', label: t('saved'), icon: 'saved' },
      { href: '/dashboard/profile', label: t('profile'), icon: 'profile' },
    ],
  };

  const employerGroup: AppNavGroup = {
    label: tNav('employerArea'),
    items: [
      { href: '/employer', label: t('overview'), icon: 'overview' },
      { href: '/employer/jobs', label: tEmployer('jobs'), icon: 'applications' },
      { href: '/employer/company', label: tEmployer('company'), icon: 'company' },
      { href: '/employer/billing', label: tEmployer('billing'), icon: 'billing' },
    ],
  };

  const adminGroup: AppNavGroup = {
    label: tAdmin('title'),
    items: [
      { href: '/admin', label: t('overview'), icon: 'admin' },
      { href: '/admin/jobs', label: tAdmin('jobsQueue'), icon: 'queue' },
      { href: '/admin/companies', label: tAdmin('companiesQueue'), icon: 'company' },
      { href: '/admin/reports', label: tAdmin('reports'), icon: 'reports' },
      { href: '/admin/users', label: tAdmin('users'), icon: 'users' },
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

  return (
    <AppShell
      groups={groups}
      bell={
        <NotificationBell label={tNotifications('title')} unread={unread ?? 0}>
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <p className="text-sm font-semibold">{tNotifications('title')}</p>
            <Link href="/notifications" className="text-xs font-medium text-primary hover:underline">
              {tNotifications('seeAll')}
            </Link>
          </div>

          {notifications.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              {tNotifications('empty')}
            </p>
          ) : (
            <ul className="max-h-96 overflow-y-auto p-1">
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
      roleLabel={role === 'employer' ? tOnboarding('roleEmployer') : role === 'admin' ? tAdmin('title') : tOnboarding('roleCandidate')}
      locale={locale}
    >
      {children}
    </AppShell>
  );
}
