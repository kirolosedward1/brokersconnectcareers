import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { Avatar } from '@/components/ui/avatar';
import { AdminTable, FilterTabs, PageHeader, Pager, SearchForm, type Column } from '@/components/admin/kit';
import { ApprovalBadge, VisibilityBadge } from '@/components/admin/badges';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { mustPage } from '@/lib/admin/read';
import { PAGE_SIZE, hrefWith, oneOf, pageOf, param, rangeOf, type SearchParams } from '@/lib/admin/params';
import { looseArabicNeedle } from '@/lib/search/needle';
import { formatDate, formatNumber } from '@/lib/utils';
import type { AgentAvailability, AgentVisibility, ApprovalStatus } from '@/lib/supabase/database.types';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'admin' });
  return { title: t('agents'), robots: { index: false, follow: false } };
}

const VIEWS = ['all', 'public', 'verified_employers_only', 'hidden', 'restricted'] as const;

type AgentListRow = {
  id: string;
  slug: string;
  years_experience: number;
  visibility: AgentVisibility;
  availability: AgentAvailability;
  restricted_at?: string | null;
  created_at: string;
  profile: { id: string; full_name: string; avatar_url: string | null; approval_status: ApprovalStatus };
};

/**
 * Every consultant profile, whatever its visibility.
 *
 * The directory itself hides and anonymises; this list does not, because an
 * admin investigating an impersonation report needs to find the profile. What
 * it still does not carry is a phone number or an email — those are on the
 * owner's account page, one recorded click away.
 */
export default async function AdminAgentsPage({
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
  const view = oneOf(param(sp, 'visibility'), VIEWS, 'all');
  const page = pageOf(sp);
  const [from, to] = rangeOf(page);

  const supabase = await createClient();
  let query = supabase
    .from('agent_profiles')
    .select(
      'id, slug, years_experience, visibility, availability, restricted_at, created_at, profile:profiles!inner (id, full_name, avatar_url, approval_status)',
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .order('id')
    .range(from, to);

  if (view === 'restricted') query = query.not('restricted_at', 'is', null);
  else if (view !== 'all') query = query.eq('visibility', view);

  const needle = q ? looseArabicNeedle(q) : '';
  if (needle) {
    // Either the owner's name or the slug. Two filters on two tables cannot be
    // one `or`, so a slug-shaped query is taken as a slug.
    query = /^[a-z0-9-]+$/.test(needle)
      ? query.ilike('slug', `%${needle}%`)
      : query.ilike('profile.full_name', `%${needle}%`);
  }

  const current = { q, visibility: view === 'all' ? undefined : view };
  const read = await mustPage(await query, 'loading consultant profiles', locale, {
    page,
    href: (n) => hrefWith('/admin/agents', current, { page: n }),
  });
  const rows = read.data as unknown as AgentListRow[];

  const t = await getTranslations('admin');
  const tVisibility = await getTranslations('visibility');
  const tAvailability = await getTranslations('availability');

  const columns: Column<AgentListRow>[] = [
    {
      key: 'name',
      header: t('colName'),
      cell: (row) => (
        <span className="inline-flex items-center gap-2">
          <Avatar src={row.profile.avatar_url} name={row.profile.full_name} size="xs" />
          {row.profile.full_name}
        </span>
      ),
      mobile: 'title',
    },
    { key: 'slug', header: t('colSlug'), cell: (row) => <code dir="ltr" className="text-xs">{row.slug}</code>, mobile: 'hidden' },
    {
      key: 'years',
      header: t('colYears'),
      cell: (row) => t('yearsN', { count: formatNumber(row.years_experience, locale) }),
      mobile: 'meta',
    },
    { key: 'availability', header: t('colAvailability'), cell: (row) => tAvailability(row.availability), mobile: 'meta' },
    { key: 'account', header: t('colAccount'), cell: (row) => <ApprovalBadge status={row.profile.approval_status} />, mobile: 'hidden' },
    {
      key: 'visibility',
      header: t('colVisibility'),
      cell: (row) => <VisibilityBadge visibility={row.visibility} restricted={Boolean(row.restricted_at)} />,
      mobile: 'aside',
    },
    { key: 'joined', header: t('colJoined'), cell: (row) => formatDate(row.created_at, locale), mobile: 'hidden' },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title={t('agents')} lede={t('agentsLede')} />

      <SearchForm
        locale={locale}
        path="/admin/agents"
        q={q}
        keep={{ visibility: current.visibility }}
        placeholder={t('agentsSearchPlaceholder')}
        label={t('search')}
      />

      <FilterTabs
        label={t('colVisibility')}
        items={VIEWS.map((value) => ({
          key: value,
          label: value === 'all' ? t('filterAll') : value === 'restricted' ? t('restricted') : tVisibility(value),
          href: hrefWith('/admin/agents', current, { visibility: value === 'all' ? undefined : value }),
          active: view === value,
        }))}
      />

      <AdminTable
        caption={t('agents')}
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        rowHref={(row) => `/admin/agents/${row.id}`}
        empty={q ? t('searchNothing') : t('emptyQueue')}
      />

      <Pager
        page={page}
        total={read.count}
        size={PAGE_SIZE}
        locale={locale}
        buildHref={(next) => hrefWith('/admin/agents', current, { page: next })}
      />
    </div>
  );
}
