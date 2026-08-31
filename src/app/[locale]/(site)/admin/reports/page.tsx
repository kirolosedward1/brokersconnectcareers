import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { localized, type Locale } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { ResolveReportButton } from '@/components/admin/resolve-report-button';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { formatDate } from '@/lib/utils';
import type { ReportReason } from '@/lib/supabase/database.types';

type ReportRowWithJob = {
  id: string;
  reason: ReportReason;
  detail: string | null;
  created_at: string;
  job: { slug: string; title_ar: string; title_en: string | null; status: string } | null;
};

export default async function AdminReportsPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdmin(locale);

  const supabase = await createClient();
  const { data } = await supabase
    .from('reports')
    .select('id, reason, detail, created_at, job:jobs (slug, title_ar, title_en, status)')
    .eq('resolved', false)
    .order('created_at', { ascending: true });

  const reports = (data ?? []) as unknown as ReportRowWithJob[];

  const t = await getTranslations('admin');
  const tReason = await getTranslations('reportReason');

  if (reports.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border py-16 text-center text-muted-foreground">
        {t('emptyQueue')}
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {reports.map((report) => (
        <li key={report.id} className="rounded-xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">{t('reportedJob')}</p>
              <h2 className="font-semibold">
                {report.job ? (
                  <Link href={`/jobs/${report.job.slug}`} className="hover:underline">
                    {localized(locale, report.job.title_ar, report.job.title_en)}
                  </Link>
                ) : (
                  '—'
                )}
              </h2>
              <p className="numeral mt-1 text-sm text-muted-foreground">
                {formatDate(report.created_at, locale)}
              </p>
            </div>

            <Badge variant="destructive" size="lg">
              {tReason(report.reason)}
            </Badge>
          </div>

          {report.detail ? (
            <p className="mt-3 rounded-lg bg-muted p-3 text-sm leading-relaxed">{report.detail}</p>
          ) : null}

          <div className="mt-4">
            <ResolveReportButton reportId={report.id} label={t('resolve')} />
          </div>
        </li>
      ))}
    </ul>
  );
}
