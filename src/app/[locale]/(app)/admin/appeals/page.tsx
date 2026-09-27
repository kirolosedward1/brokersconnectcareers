import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Gavel, Undo2 } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { asLocale, localized } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { ConfirmAction } from '@/components/admin/confirm-action';
import { FilterTabs, PageHeader, Pager } from '@/components/admin/kit';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { mustPage } from '@/lib/admin/read';
import { hrefWith, oneOf, pageOf, param, rangeOf, type SearchParams } from '@/lib/admin/params';
import { formatDate } from '@/lib/utils';
import type { AppealRow, AppealSubjectType } from '@/lib/supabase/database.types';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'admin' });
  return { title: t('appeals'), robots: { index: false, follow: false } };
}

const VIEWS = ['open', 'decided'] as const;
const PAGE = 20;

type Row = AppealRow & {
  appellant: { id: string; full_name: string } | null;
  decider: { full_name: string } | null;
};

const SUBJECT_HREF: Record<AppealSubjectType, (id: string) => string> = {
  job: (id) => `/admin/jobs/${id}`,
  company: (id) => `/admin/companies/${id}`,
  account: (id) => `/admin/users/${id}`,
  agent: (id) => `/admin/agents/${id}`,
};

/**
 * Appeals: one message about one decision, and one answer (migration 210).
 *
 * Oldest first, because the person waiting longest has been without their
 * listing, company or account longest. Each shows the decision as it stood
 * when appealed — the reason the moderator gave at the time — beside what
 * the person says was wrong with it, so the answer is read against both.
 *
 * Reversing goes through the same lever a moderator would pull by hand (the
 * post cap, the credit and a company's suspension still apply to a restored
 * listing), in one transaction with the answer; letting the decision stand
 * needs a reason, because that reason is what the person is sent.
 */
export default async function AdminAppealsPage({
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
  const view = oneOf(param(sp, 'status'), VIEWS, 'open');
  const page = pageOf(sp);
  const [from, to] = rangeOf(page, PAGE);
  const current = { status: view === 'open' ? undefined : view };

  const supabase = await createClient();
  let query = supabase
    .from('moderation_appeals')
    .select(
      `*, appellant:profiles!moderation_appeals_appellant_id_fkey (id, full_name),
          decider:profiles!moderation_appeals_decided_by_fkey (full_name)`,
      { count: 'exact' },
    );
  query =
    view === 'open'
      ? query.eq('status', 'open').order('created_at', { ascending: true })
      : query.neq('status', 'open').order('decided_at', { ascending: false });
  query = query.order('id').range(from, to);

  const read = await mustPage(await query, 'loading appeals', locale, hrefWith('/admin/appeals', current, {}));
  const rows = read.data as unknown as Row[];

  const t = await getTranslations('admin');
  const tJob = await getTranslations('jobStatus');

  const decision = (row: Row): string => {
    const snapshot = row.decision_snapshot;
    switch (row.subject_type) {
      case 'job':
        return snapshot.status ? tJob(snapshot.status as never) : '';
      case 'company':
        return t('suspended');
      case 'agent':
        return t('restricted');
      case 'account':
        return snapshot.status ? t(`approval.${snapshot.status}` as never) : '';
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader title={t('appeals')} lede={t('appealsLede')} />

      <FilterTabs
        label={t('colStatus')}
        items={VIEWS.map((value) => ({
          key: value,
          label: t(`appealView.${value}`),
          href: hrefWith('/admin/appeals', current, { status: value === 'open' ? undefined : value }),
          active: view === value,
        }))}
      />

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
          {t('emptyQueue')}
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => {
            const label =
              localized(locale, row.decision_snapshot.label_ar ?? '', row.decision_snapshot.label_en ?? null) ||
              t('untitled');
            return (
              <li key={row.id} className="rounded-xl border border-border bg-card p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">{t(`appealSubject.${row.subject_type}`)}</p>
                    <h2 className="font-semibold break-words">
                      <Link href={SUBJECT_HREF[row.subject_type](row.subject_id)} className="hover:text-primary hover:underline">
                        {label}
                      </Link>
                    </h2>
                  </div>
                  <span className="flex flex-wrap items-center gap-1.5">
                    {row.status === 'open' ? (
                      <Badge variant="warning">{t('appealView.open')}</Badge>
                    ) : (
                      <Badge variant={row.status === 'overturned' ? 'success' : 'outline'}>
                        {t(`appealOutcome.${row.status}`)}
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground">{formatDate(row.created_at, locale)}</span>
                  </span>
                </div>

                <div className="mt-3 border-s-2 border-border ps-3 text-sm">
                  <p className="text-xs text-muted-foreground">{t('appealDecision', { state: decision(row) })}</p>
                  {row.decision_snapshot.note ? (
                    <p className="mt-0.5 text-muted-foreground" dir="auto">
                      «{row.decision_snapshot.note}»
                    </p>
                  ) : null}
                </div>

                <div className="mt-3 rounded-lg border border-border/60 bg-muted/40 p-3 text-sm">
                  <p className="text-xs text-muted-foreground">
                    {row.appellant ? (
                      <Link href={`/admin/users/${row.appellant.id}`} className="hover:underline">
                        {row.appellant.full_name}
                      </Link>
                    ) : (
                      t('reporterGone')
                    )}
                  </p>
                  <p className="mt-1 whitespace-pre-line leading-relaxed" dir="auto">
                    {row.message}
                  </p>
                </div>

                {row.status === 'open' ? (
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <ConfirmAction
                      lever={{ do: 'appeal', appealId: row.id, overturn: true }}
                      label={t('appealOverturn')}
                      title={t('appealOverturn')}
                      body={t(`appealOverturnBody.${row.subject_type}`)}
                      reason="optional"
                      reasonLabel={t('appealNoteToPerson')}
                      variant="success"
                      icon={<Undo2 />}
                    />
                    <ConfirmAction
                      lever={{ do: 'appeal', appealId: row.id, overturn: false }}
                      label={t('appealUphold')}
                      title={t('appealUphold')}
                      body={t('appealUpholdBody')}
                      reason="required"
                      reasonLabel={t('appealNoteToPerson')}
                      variant="outline"
                      icon={<Gavel />}
                    />
                  </div>
                ) : (
                  <div className="mt-3 text-sm">
                    <p className="text-xs text-muted-foreground">
                      {t('appealDecidedBy', {
                        name: row.decider?.full_name ?? t('unknownActor'),
                        date: row.decided_at ? formatDate(row.decided_at, locale) : '',
                      })}
                    </p>
                    {row.decision_note ? (
                      <p className="mt-0.5" dir="auto">
                        «{row.decision_note}»
                      </p>
                    ) : null}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Pager
        page={page}
        total={read.count}
        size={PAGE}
        locale={locale}
        buildHref={(next) => hrefWith('/admin/appeals', current, { page: next })}
      />
    </div>
  );
}
