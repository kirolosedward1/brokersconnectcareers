import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale, localized } from '@/i18n/routing';
import { AdminTable, FilterTabs, PageHeader, Pager, SearchForm, type Column } from '@/components/admin/kit';
import { ApprovalBadge } from '@/components/admin/badges';
import { Badge } from '@/components/ui/badge';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { leaveAnEmptyPage, must } from '@/lib/admin/read';
import { PAGE_SIZE, hrefWith, oneOf, pageOf, param, type SearchParams } from '@/lib/admin/params';
import { formatDate } from '@/lib/utils';
import type { AdminUserSearchRow, ApprovalStatus, UserRole } from '@/lib/supabase/database.types';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'admin' });
  return { title: t('users'), robots: { index: false, follow: false } };
}

/**
 * The approval states, and one view that is not one: `blocked` lists the
 * accounts the auth server will not let in (migration 352), whatever their
 * standing — the door, not the account's standing, is what the view is for.
 */
const STATUSES = ['all', 'pending', 'approved', 'rejected', 'blocked'] as const;
const ROLES = ['all', 'candidate', 'employer', 'admin'] as const;

/**
 * Every account, found the way support gets asked about them.
 *
 * Search is the database's (admin_search_users): a name fragment through a
 * trigram index, or an exact email, phone or account id — matched without the
 * results ever carrying a phone number or an email. Contact details are on the
 * account's own page, one at a time, behind a reason.
 *
 * Pending accounts sort first within any filter, because they are the work.
 */
export default async function AdminUsersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  await requireAdmin(locale);

  const sp = await searchParams;
  const q = param(sp, 'q');
  const status = oneOf(param(sp, 'status'), STATUSES, 'all');
  const role = oneOf(param(sp, 'role'), ROLES, 'all');
  const page = pageOf(sp);

  const supabase = await createClient();
  // The blocked view asks for the block alone; every other view leaves
  // p_blocked out, which a database from before the column knows how to take.
  const rows = must(
    await supabase.rpc('admin_search_users', {
      p_query: q ?? null,
      p_role: role === 'all' ? null : (role as UserRole),
      p_status: status === 'all' || status === 'blocked' ? null : (status as ApprovalStatus),
      p_limit: PAGE_SIZE,
      p_offset: (page - 1) * PAGE_SIZE,
      ...(status === 'blocked' ? { p_blocked: true } : {}),
    }),
    'searching accounts',
  ).data;
  const total = Number(rows[0]?.total_count ?? 0);

  const t = await getTranslations('admin');
  const tOnboarding = await getTranslations('onboarding');
  const current = { q, status: status === 'all' ? undefined : status, role: role === 'all' ? undefined : role };
  await leaveAnEmptyPage(locale, {
    page,
    rows: rows?.length ?? 0,
    total,
    href: (n) => hrefWith('/admin/users', current, { page: n }),
  });

  const roleLabel = (value: UserRole) =>
    value === 'employer' ? tOnboarding('roleEmployer') : value === 'admin' ? t('title') : tOnboarding('roleCandidate');

  const columns: Column<AdminUserSearchRow>[] = [
    { key: 'name', header: t('colName'), cell: (row) => row.full_name, mobile: 'title' },
    { key: 'role', header: t('colRole'), cell: (row) => roleLabel(row.role), mobile: 'meta' },
    {
      key: 'company',
      header: t('colCompany'),
      cell: (row) =>
        row.company_id ? localized(locale, row.company_name_ar, row.company_name_en) : row.agent_slug ? (
          <span className="inline-flex items-center gap-1">
            {t('hasAgentProfile')}
            {row.agent_restricted ? <Badge variant="destructive">{t('restricted')}</Badge> : null}
          </span>
        ) : (
          '—'
        ),
      mobile: 'meta',
    },
    { key: 'joined', header: t('colJoined'), cell: (row) => formatDate(row.created_at, locale), mobile: 'meta' },
    {
      key: 'lastSignIn',
      header: t('lastSignIn'),
      cell: (row) => (row.last_sign_in_at ? formatDate(row.last_sign_in_at, locale) : '—'),
      mobile: 'hidden',
    },
    {
      key: 'status',
      header: t('colStatus'),
      // The block rides beside the standing rather than replacing it: a
      // suspended account whose door is also shut is both, and an admin
      // deciding what to lift wants to see both. Absent on a database from
      // before migration 352, which reads as not blocked.
      cell: (row) => (
        <span className="inline-flex flex-wrap gap-1">
          <ApprovalBadge status={row.approval_status} />
          {row.sign_in_blocked ? <Badge variant="destructive">{t('signInBlocked')}</Badge> : null}
        </span>
      ),
      mobile: 'aside',
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title={t('users')} lede={t('usersLede')} />

      <SearchForm
        locale={locale}
        path="/admin/users"
        q={q}
        keep={{ status: current.status, role: current.role }}
        placeholder={t('usersSearchPlaceholder')}
        label={t('search')}
      />

      <FilterTabs
        label={t('colStatus')}
        items={STATUSES.map((value) => ({
          key: value,
          label: value === 'all' ? t('filterAll') : value === 'blocked' ? t('signInBlocked') : t(`approval.${value}`),
          href: hrefWith('/admin/users', current, { status: value === 'all' ? undefined : value }),
          active: status === value,
        }))}
      />
      <FilterTabs
        label={t('colRole')}
        items={ROLES.map((value) => ({
          key: value,
          label: value === 'all' ? t('filterAllRoles') : roleLabel(value),
          href: hrefWith('/admin/users', current, { role: value === 'all' ? undefined : value }),
          active: role === value,
        }))}
      />

      <AdminTable
        caption={t('users')}
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        rowHref={(row) => `/admin/users/${row.id}`}
        empty={q ? t('searchNothing') : t('emptyQueue')}
      />

      <Pager
        page={page}
        total={total}
        size={PAGE_SIZE}
        locale={locale}
        buildHref={(next) => hrefWith('/admin/users', current, { page: next })}
      />
    </div>
  );
}
