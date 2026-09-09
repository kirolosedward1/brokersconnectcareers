import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { asLocale, localized, type Locale } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ApplicantCard, type ApplicantProfile } from '@/components/employer/applicant-card';
import { getDistricts } from '@/lib/queries/taxonomy';
import { optional } from '@/lib/queries/error';
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
  candidate: {
    full_name: string;
    whatsapp_phone: string;
    avatar_url: string | null;
    agent_profiles: ApplicantProfile | null;
  } | null;
};

const PIPELINE: ApplicationStatus[] = ['new', 'shortlisted', 'interview', 'hired', 'rejected'];

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'employer' });
  // This page is one listing's applicants; allApplicants belongs to the
  // cross-listing inbox, and using it here titled both pages the same.
  return { title: t('applicants'), robots: { index: false, follow: false } };
}

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
      candidate:profiles (
        full_name,
        whatsapp_phone,
        avatar_url,
        agent_profiles (
          slug, headline_ar, headline_en, years_experience,
          tracks, district_ids, units_closed, volume_egp
        )
      )
    `,
    )
    .eq('job_id', id)
    .order('created_at', { ascending: false });

  const applications = (data ?? []) as unknown as ApplicantRow[];

  // Resolved once and passed down. Each profile carries district ids; turning
  // them into names is a lookup every card would otherwise repeat.
  const districts = await optional(getDistricts(), []);
  const districtName = new Map(districts.map((d) => [d.id, localized(locale, d.name_ar, d.name_en)]));
  const namesFor = (ids: number[] | undefined) =>
    (ids ?? []).map((id) => districtName.get(id)).filter((name): name is string => Boolean(name));

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
          <h1 className="text-xl font-bold">{jobTitle}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t.rich('pipelineCount', {
              count: applications.length,
              v: (chunks) => <span className="numeral">{chunks}</span>,
            })}
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
                <h2 id={`stage-${stage}`} className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  {tStatus(stage)}
                  <Badge className="numeral">{inStage.length}</Badge>
                </h2>
                <ul className="space-y-3">
                  {inStage.map((application) => (
                    <li key={application.id}>
                      <ApplicantCard
                        application={application}
                        jobTitle={jobTitle}
                        companyName={companyName}
                        locale={locale}
                        districtNames={namesFor(application.candidate?.agent_profiles?.district_ids)}
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
