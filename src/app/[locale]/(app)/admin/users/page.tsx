import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Ban, FlaskConical, Mail, ShieldCheck } from 'lucide-react';
import { asLocale, localized } from '@/i18n/routing';
import { EntityLink } from '@/components/admin/entity-link';
import { RowActions, type RowAction } from '@/components/admin/row-actions';
import { FilterBar } from '@/components/admin/filter-bar';
import { AdminTable, FilterTabs, PageHeader, Pager, SearchForm, type Column } from '@/components/admin/kit';
import { ApprovalBadge } from '@/components/admin/badges';
import { TestBadge } from '@/components/admin/crm';
import { Badge } from '@/components/ui/badge';
import { FIRST_SOURCES, isFirstSource } from '@/lib/attribution';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { leaveAnEmptyPage, must } from '@/lib/admin/read';
import { PAGE_SIZE, UUID_RE, cairoDayStart, dayOf, hrefWith, oneOf, pageOf, param, type SearchParams } from '@/lib/admin/params';
import { SOURCE_GROUPS } from '@/lib/admin/sources';
import { looseArabicNeedle } from '@/lib/search/needle';
import { formatDate } from '@/lib/utils';
import type { ApprovalStatus, UserRole } from '@/lib/supabase/database.types';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'admin' });
  return { title: t('users'), robots: { index: false, follow: false } };
}

/**
 * The approval states, and one view that is not one: `blocked` lists the
 * accounts the auth server will not let in (migration 355), whatever their
 * standing — the door, not the account's standing, is what the view is for.
 */
const STATUSES = ['all', 'pending', 'approved', 'rejected', 'blocked'] as const;
const ROLES = ['all', 'candidate', 'employer', 'admin'] as const;
const TEST = ['all', 'hide', 'only'] as const;
const SOURCES = ['all', 'unknown', ...FIRST_SOURCES] as const;

type JoinedProfile = {
  id: string;
  role: UserRole;
  full_name: string;
  approval_status: ApprovalStatus;
  created_at: string;
  is_test?: boolean;
  first_source?: string | null;
  company_members?: {
    company_id: string;
    companies: { id: string; name_ar: string; name_en: string | null } | null;
  }[] | null;
};

type UserListRow = {
  id: string;
  role: UserRole;
  full_name: string;
  approval_status: ApprovalStatus;
  created_at: string;
  company_id: string | null;
  company_name_ar: string | null;
  company_name_en: string | null;
  agent_slug: string | null;
  agent_restricted: boolean;
  last_sign_in_at: string | null;
  sign_in_blocked: boolean;
  /** Absent when this database has not learned the mark yet, so the toggle stays hidden. */
  is_test?: boolean;
  first_source?: string | null;
};

/**
 * Every account, found the way support gets asked about them.
 *
 * Search is the database's (admin_search_users): a name fragment through a
 * trigram index, or an exact email, phone or account id — matched without the
 * results ever carrying a phone number or an email. Contact details are on the
 * account's own page.
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
  const viewer = await requireAdmin(locale);

  const sp = await searchParams;
  const q = param(sp, 'q');
  const status = oneOf(param(sp, 'status'), STATUSES, 'all');
  const role = oneOf(param(sp, 'role'), ROLES, 'all');
  const test = oneOf(param(sp, 'test'), TEST, 'all');
  const source = oneOf(param(sp, 'source'), SOURCES, 'all');
  const joined = dayOf(param(sp, 'joined'));
  const page = pageOf(sp);

  const supabase = await createClient();
  let rows: UserListRow[] = [];
  let total = 0;

  if (joined) {
    const start = cairoDayStart(joined);
    const end = cairoDayStart(joined, 1);
    let query = supabase
      .from('profiles')
      .select(
        'id, role, full_name, approval_status, created_at, is_test, first_source, company_members (company_id, companies (id, name_ar, name_en))',
        { count: 'exact' },
      )
      .gte('created_at', start)
      .lt('created_at', end)
      .order('created_at', { ascending: false })
      .order('id')
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
    if (role !== 'all') query = query.eq('role', role);
    if (status === 'pending' || status === 'approved' || status === 'rejected') query = query.eq('approval_status', status);
    if (q && UUID_RE.test(q)) query = query.eq('id', q);
    else if (q) {
      const needle = looseArabicNeedle(q);
      if (needle) query = query.ilike('full_name', `%${needle}%`);
    }
    if (source === 'unknown') query = query.is('first_source', null);
    else if (source !== 'all') query = query.eq('first_source', source);
    if (test === 'hide') query = query.eq('is_test', false);
    else if (test === 'only') query = query.eq('is_test', true);
    const read = must(await query, 'loading accounts that joined that day');
    total = read.count ?? 0;
    rows = ((read.data ?? []) as unknown as JoinedProfile[]).map((profile) => {
      const membership = profile.company_members?.[0];
      return {
        id: profile.id,
        role: profile.role,
        full_name: profile.full_name,
        approval_status: profile.approval_status,
        created_at: profile.created_at,
        company_id: membership?.companies?.id ?? membership?.company_id ?? null,
        company_name_ar: membership?.companies?.name_ar ?? null,
        company_name_en: membership?.companies?.name_en ?? null,
        agent_slug: null,
        agent_restricted: false,
        last_sign_in_at: null,
        sign_in_blocked: false,
        is_test: profile.is_test,
        first_source: profile.first_source ?? null,
      };
    });
  } else {
    // The blocked view asks for the block alone; every other view leaves
    // p_blocked out, which a database from before the column knows how to take.
    // The test and source filters are the same: named only when they are set,
    // so a database from before migration 368 still answers the list.
    const base = {
      p_query: q ?? null,
      p_role: role === 'all' ? null : (role as UserRole),
      p_status: status === 'all' || status === 'blocked' ? null : (status as ApprovalStatus),
      p_limit: PAGE_SIZE,
      p_offset: (page - 1) * PAGE_SIZE,
      ...(status === 'blocked' ? { p_blocked: true } : {}),
    };
    const extra: { p_test?: boolean; p_source?: string } = {};
    if (test === 'hide') extra.p_test = false;
    else if (test === 'only') extra.p_test = true;
    if (source !== 'all') extra.p_source = source;
    let searched = await supabase.rpc('admin_search_users', { ...base, ...extra });
    if (
      searched.error &&
      (searched.error.code === 'PGRST202' || searched.error.code === '42883') &&
      (extra.p_test !== undefined || extra.p_source)
    ) {
      searched = await supabase.rpc('admin_search_users', base);
    }
    const found = must(searched, 'searching accounts').data;
    total = Number(found?.[0]?.total_count ?? 0);
    rows = (found ?? []).map((row) => ({
      id: row.id,
      role: row.role,
      full_name: row.full_name,
      approval_status: row.approval_status,
      created_at: row.created_at,
      company_id: row.company_id,
      company_name_ar: row.company_name_ar,
      company_name_en: row.company_name_en,
      agent_slug: row.agent_slug,
      agent_restricted: row.agent_restricted,
      last_sign_in_at: row.last_sign_in_at ?? null,
      sign_in_blocked: Boolean(row.sign_in_blocked),
      is_test: row.is_test,
      first_source: row.first_source ?? null,
    }));
  }

  const t = await getTranslations('admin');
  const tOnboarding = await getTranslations('onboarding');
  const current = {
    q,
    status: status === 'all' ? undefined : status,
    role: role === 'all' ? undefined : role,
    test: test === 'all' ? undefined : test,
    source: source === 'all' ? undefined : source,
    joined,
  };
  await leaveAnEmptyPage(locale, {
    page,
    rows: rows?.length ?? 0,
    total,
    href: (n) => hrefWith('/admin/users', current, { page: n }),
  });

  const roleLabel = (value: UserRole) =>
    value === 'employer' ? tOnboarding('roleEmployer') : value === 'admin' ? t('title') : tOnboarding('roleCandidate');

  const columns: Column<UserListRow>[] = [
    {
      key: 'name',
      header: t('colName'),
      cell: (row) => (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <EntityLink href={`/admin/users/${row.id}`} className="font-medium">
            {row.full_name}
          </EntityLink>
          {row.is_test ? <TestBadge /> : null}
        </span>
      ),
      mobile: 'title',
    },
    { key: 'role', header: t('colRole'), cell: (row) => roleLabel(row.role), mobile: 'meta' },
    {
      key: 'company',
      header: t('colCompany'),
      cell: (row) =>
        row.company_id ? (
          <EntityLink href={`/admin/companies/${row.company_id}`}>
            {localized(locale, row.company_name_ar, row.company_name_en)}
          </EntityLink>
        ) : row.agent_slug ? (
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
      key: 'source',
      header: t('colSource'),
      cell: (row) => (isFirstSource(row.first_source) ? t(`source_${row.first_source}`) : t('sourceUnknown')),
      mobile: 'hidden',
    },
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
      // before migration 355, which reads as not blocked.
      cell: (row) => (
        <span className="inline-flex flex-wrap gap-1">
          <ApprovalBadge status={row.approval_status} />
          {row.sign_in_blocked ? <Badge variant="destructive">{t('signInBlocked')}</Badge> : null}
        </span>
      ),
      mobile: 'aside',
    },
    {
      key: 'actions',
      header: t('colActions'),
      className: 'w-px',
      cell: (row) => {
        const self = row.id === viewer.userId;
        const actions: RowAction[] = [];
        if (!self && row.role !== 'admin') {
          if (row.approval_status === 'rejected') {
            actions.push({
              id: 'restore',
              kind: 'lever',
              primary: true,
              tone: 'success',
              label: t('restoreAccount'),
              title: t('restoreAccount'),
              body: row.full_name,
              icon: <ShieldCheck aria-hidden />,
              lever: { do: 'approval', userId: row.id, status: 'approved' },
              reason: 'optional',
              reasonLabel: t('reasonToUser'),
            });
          } else {
            actions.push({
              id: 'suspend',
              kind: 'lever',
              primary: true,
              tone: 'destructive',
              label: t('suspendAccount'),
              title: t('suspendAccount'),
              body: row.role === 'employer' ? t('suspendTakesListingsDown') : t('suspendCandidateBody'),
              icon: <Ban aria-hidden />,
              lever: { do: 'approval', userId: row.id, status: 'rejected' },
              reason: 'optional',
              reasonLabel: t('reasonToUser'),
            });
          }
        }
        if (!self && row.sign_in_blocked) {
          actions.push({
            id: 'allow',
            kind: 'lever',
            primary: true,
            label: t('allowSignIn'),
            title: t('allowSignIn'),
            body: t('unblockSignInBody'),
            icon: <ShieldCheck aria-hidden />,
            lever: { do: 'signInBlock', userId: row.id, block: false },
            reason: 'optional',
            reasonLabel: t('reasonOnRecord'),
          });
        }
        if (!self && typeof row.is_test === 'boolean') {
          actions.push({
            id: 'test',
            kind: 'lever',
            label: row.is_test ? t('unmarkTest') : t('markTest'),
            title: row.is_test ? t('unmarkTest') : t('markTest'),
            body: row.full_name,
            icon: <FlaskConical aria-hidden />,
            lever: { do: 'testFlag', userId: row.id, test: !row.is_test },
            reason: 'optional',
            reasonLabel: t('reasonOnRecord'),
          });
        }
        if (!self) {
          actions.push({
            id: 'email',
            kind: 'contact',
            label: t('emailContact'),
            icon: <Mail aria-hidden />,
            userId: row.id,
            channel: 'email',
          });
          actions.push({
            id: 'whatsapp',
            kind: 'contact',
            label: t('whatsAppContact'),
            icon: null,
            userId: row.id,
            channel: 'whatsapp',
          });
        }
        return <RowActions actions={actions} />;
      },
      mobile: 'meta',
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title={t('users')} lede={t('usersLede')} />

      <FilterTabs
        label={t('colStatus')}
        items={STATUSES.map((value) => ({
          key: value,
          label: value === 'all' ? t('filterAll') : value === 'blocked' ? t('signInBlocked') : t(`approval.${value}`),
          href: hrefWith('/admin/users', current, { status: value === 'all' ? undefined : value }),
          active: status === value,
        }))}
      />

      <FilterBar
        filters={[
          {
            kind: 'select',
            key: 'role',
            label: t('accountType'),
            valueLabel: role === 'all' ? undefined : role === 'candidate' ? t('accountTypeCandidate') : role === 'employer' ? t('accountTypeEmployer') : t('accountTypeAdmin'),
            all: { value: 'all', label: t('filterAll'), href: hrefWith('/admin/users', current, { role: undefined }) },
            options: [
              { value: 'candidate', label: t('accountTypeCandidate'), href: hrefWith('/admin/users', current, { role: 'candidate' }) },
              { value: 'employer', label: t('accountTypeEmployer'), href: hrefWith('/admin/users', current, { role: 'employer' }) },
              { value: 'admin', label: t('accountTypeAdmin'), href: hrefWith('/admin/users', current, { role: 'admin' }) },
            ],
          },
          {
            kind: 'grouped',
            key: 'source',
            label: t('accountSource'),
            valueLabel: source === 'all' ? undefined : t(`source.${source}`),
            searchPlaceholder: t('accountSourceSearch'),
            empty: t('filterEmpty'),
            all: { value: 'all', label: t('filterAll'), href: hrefWith('/admin/users', current, { source: undefined }) },
            groups: SOURCE_GROUPS.map((group) => ({
              id: group.id,
              label: t(`sourceGroup.${group.id}`),
              options: group.sources.map((id) => ({
                value: id,
                label: t(`source.${id}`),
                href: hrefWith('/admin/users', current, { source: id }),
              })),
            })),
          },
          {
            kind: 'select',
            key: 'test',
            label: t('testBadge'),
            valueLabel: test === 'hide' ? t('hideTest') : test === 'only' ? t('onlyTest') : undefined,
            all: { value: 'all', label: t('filterAll'), href: hrefWith('/admin/users', current, { test: undefined }) },
            options: [
              { value: 'hide', label: t('hideTest'), href: hrefWith('/admin/users', current, { test: 'hide' }) },
              { value: 'only', label: t('onlyTest'), href: hrefWith('/admin/users', current, { test: 'only' }) },
            ],
          },
        ]}
        chips={[
          ...(q ? [{ key: 'q', label: t('searchChip', { q }), href: hrefWith('/admin/users', current, { q: undefined }), remove: t('removeFilter', { filter: t('search') }) }] : []),
          ...(role !== 'all'
            ? [{
                key: 'role',
                label: `${t('accountType')}: ${role === 'candidate' ? t('accountTypeCandidate') : role === 'employer' ? t('accountTypeEmployer') : t('accountTypeAdmin')}`,
                href: hrefWith('/admin/users', current, { role: undefined }),
                remove: t('removeFilter', { filter: t('accountType') }),
              }]
            : []),
          ...(source !== 'all'
            ? [{
                key: 'source',
                label: `${t('accountSource')}: ${t(`source.${source}`)}`,
                href: hrefWith('/admin/users', current, { source: undefined }),
                remove: t('removeFilter', { filter: t('accountSource') }),
              }]
            : []),
          ...(test !== 'all'
            ? [{
                key: 'test',
                label: test === 'hide' ? t('hideTest') : t('onlyTest'),
                href: hrefWith('/admin/users', current, { test: undefined }),
                remove: t('removeFilter', { filter: test === 'hide' ? t('hideTest') : t('onlyTest') }),
              }]
            : []),
          ...(joined
            ? [{
                key: 'joined',
                label: t('filteredToDay'),
                href: hrefWith('/admin/users', current, { joined: undefined }),
                remove: t('removeFilter', { filter: t('filteredToDay') }),
              }]
            : []),
        ]}
        clearHref={hrefWith('/admin/users', { status: current.status }, {})}
        clearLabel={t('clearListFilters')}
      >
        <SearchForm
          locale={locale}
          path="/admin/users"
          q={q}
          keep={{ status: current.status, role: current.role, source: current.source, test: current.test, joined: current.joined }}
          placeholder={t('usersSearchPlaceholder')}
          label={t('search')}
        />
      </FilterBar>

      <AdminTable
        caption={t('users')}
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        rowHref={(row) => `/admin/users/${row.id}`}
        rowLabel={(row) => row.full_name}
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
