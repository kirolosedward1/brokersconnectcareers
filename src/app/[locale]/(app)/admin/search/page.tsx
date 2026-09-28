import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { asLocale } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { PageHeader, SearchForm, Section } from '@/components/admin/kit';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { must } from '@/lib/admin/read';
import { param, type SearchParams } from '@/lib/admin/params';
import type { AdminSearchKind, AdminSearchRow } from '@/lib/supabase/database.types';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'admin' });
  return { title: t('search'), robots: { index: false, follow: false } };
}

const HREF: Record<AdminSearchKind, (id: string) => string> = {
  user: (id) => `/admin/users/${id}`,
  company: (id) => `/admin/companies/${id}`,
  job: (id) => `/admin/jobs/${id}`,
  agent: (id) => `/admin/agents/${id}`,
  application: (id) => `/admin/applications/${id}`,
};

const ORDER: AdminSearchKind[] = ['user', 'company', 'job', 'agent', 'application'];

/**
 * One box for "somebody wrote to support about X".
 *
 * Names and titles by fragment, accounts by exact email or phone digits, and
 * anything by its id. Six of each kind at most — this finds a thing to open,
 * it is not a list to scroll; each list page has its own search for that.
 */
export default async function AdminSearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  await requireAdmin(locale);

  const q = param(await searchParams, 'q');
  const t = await getTranslations('admin');
  const tJob = await getTranslations('jobStatus');
  const tVisibility = await getTranslations('visibility');
  const tApplication = await getTranslations('applicationStatus');

  /** Every state the search returns is an enum value; this says it in words. */
  const stateLabel = (kind: AdminSearchKind, state: string) => {
    switch (kind) {
      case 'user':
        return t(`approval.${state as 'approved'}`);
      case 'company':
        return state === 'suspended' ? t('suspended') : t(`verification.${state as 'verified'}`);
      case 'job':
        return tJob(state as 'active');
      case 'agent':
        return state === 'restricted' ? t('restricted') : tVisibility(state as 'public');
      case 'application':
        return tApplication(state as 'new');
    }
  };

  let rows: AdminSearchRow[] = [];
  if (q && q.length >= 2) {
    const supabase = await createClient();
    rows = must(await supabase.rpc('admin_search', { p_query: q }), 'searching the console').data;
  }

  const groups = ORDER.map((kind) => ({ kind, rows: rows.filter((row) => row.kind === kind) })).filter(
    (group) => group.rows.length > 0,
  );

  return (
    <div className="space-y-6">
      <PageHeader title={t('search')} lede={t('searchLede')} />
      <SearchForm locale={locale} path="/admin/search" q={q} placeholder={t('searchEverythingPlaceholder')} label={t('search')} />

      {!q ? null : q.length < 2 ? (
        <p className="text-sm text-muted-foreground">{t('searchTooShort')}</p>
      ) : groups.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
          {t('searchNothing')}
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {groups.map((group) => (
            <Section key={group.kind} title={t(`kind.${group.kind}`)}>
              <ul className="divide-y divide-border">
                {group.rows.map((row) => (
                  <li key={row.id}>
                    <Link
                      href={HREF[group.kind](row.id)}
                      className="flex min-h-11 items-center justify-between gap-3 py-2 hover:text-primary"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{row.label ?? row.id}</span>
                        {row.sublabel ? (
                          <span className="block truncate text-xs text-muted-foreground">{row.sublabel}</span>
                        ) : null}
                      </span>
                      {row.state ? <Badge variant="outline">{stateLabel(group.kind, row.state)}</Badge> : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          ))}
        </div>
      )}
    </div>
  );
}
