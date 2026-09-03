import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Building2, MapPin } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { asLocale, localized, type Locale } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { WithdrawButton } from '@/components/dashboard/withdraw-button';
import { requireCandidate } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { formatDate, isoDate } from '@/lib/utils';
import type { ApplicationStatus } from '@/lib/supabase/database.types';

const STATUS_VARIANT: Record<ApplicationStatus, 'default' | 'primary' | 'success' | 'destructive'> = {
  new: 'default',
  shortlisted: 'primary',
  interview: 'primary',
  hired: 'success',
  rejected: 'destructive',
};

export default async function ApplicationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);
  await requireCandidate(locale);

  const supabase = await createClient();
  const { data } = await supabase
    .from('applications')
    .select(
      `
      id, status, created_at, decision_note,
      job:jobs (
        slug, title_ar, title_en,
        company:companies (name_ar, name_en, slug),
        district:districts (name_ar, name_en)
      )
    `,
    )
    .order('created_at', { ascending: false });

  const applications = (data ?? []) as unknown as {
    id: string;
    status: ApplicationStatus;
    decision_note: string | null;
    created_at: string;
    job: {
      slug: string;
      title_ar: string;
      title_en: string | null;
      company: { name_ar: string; name_en: string | null; slug: string };
      district: { name_ar: string; name_en: string };
    } | null;
  }[];

  const t = await getTranslations('dashboard');
  const tStatus = await getTranslations('applicationStatus');

  if (applications.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border py-16 text-center">
        <p className="font-medium">{t('emptyApplications')}</p>
        <Button asChild className="mt-5">
          <Link href="/jobs">{t('emptyApplicationsCta')}</Link>
        </Button>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {applications.map((application) => {
        const job = application.job;
        if (!job) return null;

        return (
          <li
            key={application.id}
            className="rounded-xl border border-border bg-card p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-semibold">
                  <Link href={`/jobs/${job.slug}`} className="hover:underline">
                    {localized(locale, job.title_ar, job.title_en)}
                  </Link>
                </h2>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Building2 className="size-3.5" aria-hidden />
                    {localized(locale, job.company.name_ar, job.company.name_en)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="size-3.5" aria-hidden />
                    {localized(locale, job.district.name_ar, job.district.name_en)}
                  </span>
                </p>
              </div>

              <Badge variant={STATUS_VARIANT[application.status]} size="lg">
                {tStatus(application.status)}
              </Badge>
            </div>

            {/* The reason, when the company gave one. This is the whole point
                of the board: a decision you can act on rather than guess at. */}
            {application.decision_note ? (
              <div className="mt-4 rounded-lg border border-border bg-muted/50 p-3">
                <p className="text-xs font-medium text-muted-foreground">
                  {t('decisionFromCompany')}
                </p>
                <p className="mt-1 text-sm leading-relaxed">{application.decision_note}</p>
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <time
                dateTime={isoDate(application.created_at)}
                className="numeral text-xs text-muted-foreground"
              >
                {t('appliedOn', { date: formatDate(application.created_at, locale) })}
              </time>

              {/* Withdrawing is only offered while the outcome is still open. */}
              {application.status === 'new' || application.status === 'shortlisted' ? (
                <WithdrawButton applicationId={application.id} label={t('withdraw')} />
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
