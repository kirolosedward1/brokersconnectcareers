import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { asLocale } from '@/i18n/routing';
import { AppShell, type AppNavGroup } from '@/components/dashboard/app-shell';
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

  const t = await getTranslations('dashboard');
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
    ],
  };

  const accountGroup: AppNavGroup = {
    label: tAccount('title'),
    items: [{ href: '/dashboard/account', label: tAccount('title'), icon: 'settings' }],
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
      name={profile.full_name}
      roleLabel={role === 'employer' ? tOnboarding('roleEmployer') : role === 'admin' ? tAdmin('title') : tOnboarding('roleCandidate')}
      locale={locale}
    >
      {children}
    </AppShell>
  );
}
