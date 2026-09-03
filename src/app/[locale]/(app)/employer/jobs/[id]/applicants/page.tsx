import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { asLocale, localized, type Locale } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ApplicantCard } from '@/components/employer/applicant-card';
import { requireEmployer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import type { ApplicationStatus, ExperienceBand } from '@/lib/supabase/database.types';

type ApplicantRow = {
  id: string;
  status: ApplicationStatus;
  created_at: string;
  note: string | null;
  decision_note: string | null;
  cv_path: string | null;
  experience_band: ExperienceBand | null;
  candidate: { full_name: string; whatsapp_phone: string } | null;
};

const PIPELINE: ApplicationStatus[] = ['new', 'shortlisted', 'interview', 'hired', 'rejected'];

export default async function ApplicantsPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);

  const viewer = await requireEmployer(locale);
  const supabase = await createClient();

  const { data: job } = await supabase
    .from('jobs')
    .select('id, slug, title_ar, title_en, status')
    .eq('id', id)
    .maybeSingle();

  if (!job) notFound();

  const { data } = await supabase
    .from('applications')
    .select(
      `
      id, status, created_at, note, decision_note, cv_path, experience_band,
      candidate:profiles (full_name, whatsapp_phone)
    `,
    )
    .eq('job_id', id)
    .order('created_at', { ascending: false });

  const applications = (data ?? []) as unknown as ApplicantRow[];

  const t = await getTranslations('employer');
  const tStatus = await getTranslations('applicationStatus');

  const jobTitle = localized(locale, job.title_ar, job.title_en);
  const companyName = viewer.company
    ? localized(locale, viewer.company.name_ar, viewer.company.name_en)
    : '';

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{jobTitle}</h2>
          <p className="numeral mt-1 text-sm text-muted-foreground">
            {t('pipelineCount', { count: applications.length })}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/employer/jobs">{t('jobs')}</Link>
        </Button>
      </header>

      {applications.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border py-16 text-center text-muted-foreground">
          {t('noApplicants')}
        </p>
      ) : (
        <div className="space-y-8">
          {PIPELINE.map((stage) => {
            const inStage = applications.filter((application) => application.status === stage);
            if (inStage.length === 0) return null;

            return (
              <section key={stage} aria-labelledby={`stage-${stage}`}>
                <h3 id={`stage-${stage}`} className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  {tStatus(stage)}
                  <Badge className="numeral">{inStage.length}</Badge>
                </h3>
                <ul className="space-y-3">
                  {inStage.map((application) => (
                    <li key={application.id}>
                      <ApplicantCard
                        application={application}
                        jobTitle={jobTitle}
                        companyName={companyName}
                        locale={locale}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
