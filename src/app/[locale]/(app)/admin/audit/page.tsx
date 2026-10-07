import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { asLocale } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { FilterTabs, PageHeader, Pager, auditLabel } from '@/components/admin/kit';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { mustPage } from '@/lib/admin/read';
import { UUID_RE, hrefWith, oneOf, pageOf, param, rangeOf, type SearchParams } from '@/lib/admin/params';
import { formatDate } from '@/lib/utils';
import type { AdminAuditRow, AuditTargetType } from '@/lib/supabase/database.types';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'admin' });
  return { title: t('auditLog'), robots: { index: false, follow: false } };
}

const TYPES = ['all', 'user', 'company', 'job', 'agent', 'application', 'taxonomy', 'direct'] as const;
const AUDIT_PAGE = 50;

const TARGET_HREF: Partial<Record<AuditTargetType, (id: string) => string>> = {
  user: (id) => `/admin/users/${id}`,
  company: (id) => `/admin/companies/${id}`,
  job: (id) => `/admin/jobs/${id}`,
  agent: (id) => `/admin/agents/${id}`,
  application: (id) => `/admin/applications/${id}`,
  taxonomy: () => '/admin/taxonomy',
};

/**
 * Every decision, newest first, and nothing that can be edited.
 *
 * The table is append-only for everybody including the service role
 * (migration 316), so this page is a record rather than a report somebody could
 * tidy. `direct` isolates changes an admin made through the API rather than
 * through a lever — each one worth a second look, because it skipped the
 * transition rules and the reason prompt.
 */
export default async function AdminAuditPage({
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
  const type = oneOf(param(sp, 'type'), TYPES, 'all');
  const actor = param(sp, 'actor');
  const target = param(sp, 'target');
  const page = pageOf(sp);
  const [from, to] = rangeOf(page, AUDIT_PAGE);

  const supabase = await createClient();
  let query = supabase
    .from('admin_audit_log')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, to);

  if (type === 'direct') query = query.eq('via', 'direct');
  else if (type !== 'all') query = query.eq('target_type', type);
  if (actor && UUID_RE.test(actor)) query = query.eq('actor_id', actor);
  if (target) query = query.eq('target_id', target);

  const current = { type: type === 'all' ? undefined : type, actor, target };
  const read = await mustPage(await query, 'loading the audit log', locale, {
    page,
    size: AUDIT_PAGE,
    href: (n) => hrefWith('/admin/audit', current, { page: n }),
  });
  const rows = read.data as AdminAuditRow[];

  const t = await getTranslations('admin');

  const time = (at: string) =>
    `${formatDate(at, locale)} ${new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Africa/Cairo',
    }).format(new Date(at))}`;

  /** The status move, when the entry recorded one — the most useful line of metadata. */
  const move = (row: AdminAuditRow) => {
    const m = row.metadata as { from?: unknown; to?: unknown; columns?: unknown };
    if (typeof m.from === 'string' && typeof m.to === 'string') return `${m.from} → ${m.to}`;
    if (Array.isArray(m.columns)) return m.columns.join(', ');
    return null;
  };

  return (
    <div className="space-y-5">
      <PageHeader title={t('auditLog')} lede={t('auditLede')} />

      <FilterTabs
        label={t('reportTarget')}
        items={TYPES.map((value) => ({
          key: value,
          label: value === 'all' ? t('filterAll') : value === 'direct' ? t('viaDirect') : value === 'taxonomy' ? t('taxonomy') : t(`kind.${value}`),
          href: hrefWith('/admin/audit', current, { type: value === 'all' ? undefined : value }),
          active: type === value,
        }))}
      />

      {actor || target ? (
        <p className="text-sm text-muted-foreground">
          {t('filteredToOne')}{' '}
          <Link href={hrefWith('/admin/audit', { type: current.type }, {})} className="text-primary hover:underline">
            {t('clearFilter')}
          </Link>
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
          {t('trailEmpty')}
        </p>
      ) : (
        <ol className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {rows.map((row) => {
            const href = TARGET_HREF[row.target_type]?.(row.target_id);
            const change = move(row);
            return (
              <li key={row.id} className="grid gap-1 px-4 py-3 text-sm md:grid-cols-[10rem_minmax(0,1fr)_12rem] md:gap-4">
                <span className="text-xs text-muted-foreground md:pt-0.5">{time(row.created_at)}</span>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{auditLabel(t, row.action)}</span>
                    {row.via === 'direct' ? <Badge variant="warning">{t('viaDirect')}</Badge> : null}
                  </p>
                  <p className="mt-0.5 break-words text-muted-foreground">
                    {href ? (
                      <Link href={href} className="hover:text-primary hover:underline">
                        {row.target_label ?? row.target_id}
                      </Link>
                    ) : (
                      (row.target_label ?? row.target_id)
                    )}
                    {change ? (
                      <span dir="ltr" className="ms-2 font-mono text-xs">
                        {change}
                      </span>
                    ) : null}
                  </p>
                  {row.reason ? <p className="mt-0.5 text-muted-foreground">«{row.reason}»</p> : null}
                </div>
                <span className="text-xs text-muted-foreground md:text-end">
                  {row.actor_id ? (
                    <Link href={hrefWith('/admin/audit', current, { actor: row.actor_id })} className="hover:underline">
                      {row.actor_name ?? t('unknownActor')}
                    </Link>
                  ) : (
                    t('unknownActor')
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      <Pager
        page={page}
        total={read.count}
        size={AUDIT_PAGE}
        locale={locale}
        buildHref={(next) => hrefWith('/admin/audit', current, { page: next })}
      />
    </div>
  );
}
