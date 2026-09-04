import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Building2, ShieldCheck, UserRound } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { asLocale } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { ApprovalActions } from '@/components/admin/approval-actions';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { formatDate } from '@/lib/utils';
import type { ApprovalStatus, ProfileRow, UserRole } from '@/lib/supabase/database.types';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'admin' });
  return { title: t('users'), robots: { index: false, follow: false } };
}

const ROLE_ICON: Record<UserRole, React.ComponentType<{ className?: string }>> = {
  candidate: UserRound,
  employer: Building2,
  admin: ShieldCheck,
};

const STATUS_VARIANT: Record<ApprovalStatus, 'success' | 'warning' | 'destructive'> = {
  approved: 'success',
  pending: 'warning',
  rejected: 'destructive',
};

/**
 * Every account, and the one lever that matters for each.
 *
 * Sorted so the queue leads: anything waiting on a person comes first, then
 * everything else newest-first. An admin opening this page in the morning
 * should not have to search for the work.
 *
 * Filters are links rather than a form, so each view is a URL somebody can
 * bookmark or send to a colleague.
 */
export default async function AdminUsersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ role?: string; status?: string }>;
}) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  await requireAdmin(locale);

  const { role, status } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);

  if (role === 'candidate' || role === 'employer' || role === 'admin') query = query.eq('role', role);
  if (status === 'approved' || status === 'pending' || status === 'rejected') {
    query = query.eq('approval_status', status);
  }

  const { data } = await query;
  const profiles = (data ?? []) as ProfileRow[];

  // Pending first, whatever the sort. The database can order by a CASE, but the
  // list is capped at 200 rows and this keeps the query one plain select.
  const sorted = [...profiles].sort((a, b) => {
    const weight = (row: ProfileRow) => (row.approval_status === 'pending' ? 0 : 1);
    return weight(a) - weight(b);
  });

  const t = await getTranslations('admin');
  const tOnboarding = await getTranslations('onboarding');

  const roleLabel = (value: UserRole) =>
    value === 'employer'
      ? tOnboarding('roleEmployer')
      : value === 'admin'
        ? t('title')
        : tOnboarding('roleCandidate');

  const filters: { key: string; label: string; href: string; active: boolean }[] = [
    { key: 'all', label: t('filterAll'), href: '/admin/users', active: !role && !status },
    {
      key: 'pending',
      label: t('filterPending'),
      href: '/admin/users?status=pending',
      active: status === 'pending',
    },
    {
      key: 'employers',
      label: tOnboarding('roleEmployer'),
      href: '/admin/users?role=employer',
      active: role === 'employer' && !status,
    },
    {
      key: 'candidates',
      label: tOnboarding('roleCandidate'),
      href: '/admin/users?role=candidate',
      active: role === 'candidate' && !status,
    },
    {
      key: 'rejected',
      label: t('filterRejected'),
      href: '/admin/users?status=rejected',
      active: status === 'rejected',
    },
  ];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">{t('users')}</h1>
        <p className="mt-1 text-muted-foreground">{t('usersLede')}</p>
      </header>

      <nav className="flex flex-wrap gap-2" aria-label={t('users')}>
        {filters.map((filter) => (
          <Link
            key={filter.key}
            href={filter.href}
            aria-current={filter.active ? 'page' : undefined}
            className={
              filter.active
                ? 'rounded-full bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground'
                : 'rounded-full border border-border px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
            }
          >
            {filter.label}
          </Link>
        ))}
      </nav>

      {sorted.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border py-16 text-center text-muted-foreground">
          {t('emptyQueue')}
        </p>
      ) : (
        <ul className="space-y-3">
          {sorted.map((profile) => {
            const Icon = ROLE_ICON[profile.role];
            return (
              <li
                key={profile.id}
                className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-border bg-card p-4"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    aria-hidden
                    className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"
                  >
                    <Icon className="size-4" />
                  </span>

                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      <span className="truncate">{profile.full_name}</span>
                      <Badge variant={STATUS_VARIANT[profile.approval_status]}>
                        {t(`approval.${profile.approval_status}`)}
                      </Badge>
                    </p>

                    <p className="numeral mt-1 text-sm text-muted-foreground" dir="ltr">
                      {profile.whatsapp_phone}
                    </p>

                    <p className="mt-1 text-xs text-muted-foreground">
                      {roleLabel(profile.role)}
                      <span aria-hidden> · </span>
                      <span className="numeral">{formatDate(profile.created_at, locale)}</span>
                    </p>

                    {profile.approval_note ? (
                      <p className="mt-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                        {profile.approval_note}
                      </p>
                    ) : null}
                  </div>
                </div>

                {/* An admin's own row carries no lever. The database refuses it
                    either way — set_account_approval will not touch an admin —
                    so offering the button would only produce an error. */}
                {profile.role === 'admin' ? null : (
                  <ApprovalActions userId={profile.id} status={profile.approval_status} />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
