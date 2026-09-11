import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { asLocale, localized, type Locale } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ApplicantCard, type ApplicantProfile } from '@/components/employer/applicant-card';
import { getDistricts } from '@/lib/queries/taxonomy';
import { markApplicantsSeen } from '@/lib/applicants-seen';
import { optional, raise } from '@/lib/queries/error';
import { requireEmployer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import type {
  ApplicationNoteRow,
  ApplicationStatus,
  ExperienceBand,
} from '@/lib/supabase/database.types';

type ApplicantRow = {
  id: string;
  status: ApplicationStatus;
  created_at: string;
  note: string | null;
  decision_note: string | null;
  cv_path: string | null;
  /** Null until the inbox has had this card on screen. */
  employer_viewed_at: string | null;
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

  /*
    Unreadable is not the same as absent.

    Both used to arrive as `job: null` and both became a 404 — so a database
    blip told an employer their own listing did not exist. `maybeSingle()`
    returns no error for no row, so an error here is a real failure and
    belongs in the error boundary, where Retry means something.
  */
  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select('id, slug, title_ar, title_en, status')
    .eq('id', id)
    .maybeSingle();

  if (jobError) raise(jobError, 'loading the listing');
  if (!job) notFound();

  const { data, error } = await supabase
    .from('applications')
    .select(
      `
      id, status, created_at, note, decision_note, cv_path, experience_band, employer_viewed_at,
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

  // And the pipeline itself: "nobody has applied" is the wrong thing to tell
  // an employer whose listing has five applicants and a badge counting them.
  if (error) raise(error, 'loading this listing\'s applicants');

  const applications = (data ?? []) as unknown as ApplicantRow[];

  /*
    Seen, because they are on the screen.

    The card below carries the name, the experience band, the note and the link
    to the CV. If it has rendered, the application has been opened — which is
    the one thing a candidate wants to know after applying, and which
    employer_viewed_at could not honestly say while only a pipeline move wrote
    it.
  */
  await markApplicantsSeen(
    applications.filter((row) => !row.employer_viewed_at).map((row) => row.id),
  );

  /*
    The company's own notes, fetched once for the page rather than per card.

    application_notes has no policy for the candidate at all, so nothing here
    needs to be careful about what it selects — the rule is the database's. The
    explicit `in` is an index hint, not the authorisation.
  */
  const noteRows = applications.length
    ? (((
        await supabase
          .from('application_notes')
          .select('*')
          .in('application_id', applications.map((row) => row.id))
          .order('created_at', { ascending: true })
      ).data ?? []) as ApplicationNoteRow[])
    : [];

  const notesByApplication = new Map<string, ApplicationNoteRow[]>();
  for (const note of noteRows) {
    const list = notesByApplication.get(note.application_id) ?? [];
    list.push(note);
    notesByApplication.set(note.application_id, list);
  }

  // The colleagues who wrote them, by name. An author whose account has closed
  // resolves to nothing and the card says so.
  const authorIds = [...new Set(noteRows.map((note) => note.author_id).filter(Boolean))] as string[];
  const noteAuthors: Record<string, string> = {};
  if (authorIds.length) {
    // Allowed to fail quietly: the notes fall back to "a former colleague",
    // which is the same thing they show when an author's account is gone.
    const { data: members } = await supabase
      .from('company_members')
      .select('user_id, profile:profiles (full_name)')
      .in('user_id', authorIds);

    for (const member of (members ?? []) as unknown as {
      user_id: string;
      profile: { full_name: string } | null;
    }[]) {
      if (member.profile?.full_name) noteAuthors[member.user_id] = member.profile.full_name;
    }
  }

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
        /*
          Nobody has applied to this listing *yet*, which is a different thing
          from nobody applying. The two useful moves are reading the advert the
          way a consultant reads it, and checking whether other listings are
          getting applicants — so both are offered rather than neither.
        */
        <div className="rounded-xl border border-dashed border-border px-6 py-16 text-center">
          <p className="font-medium">{t('noApplicants')}</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            {t('noApplicantsHint')}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button asChild variant="outline">
              <Link href={`/jobs/${job.slug}`}>{t('viewListing')}</Link>
            </Button>
            <Button asChild variant="ghost">
              <Link href="/employer/applicants">{t('allApplicants')}</Link>
            </Button>
          </div>
        </div>
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
                        notes={notesByApplication.get(application.id) ?? []}
                        noteAuthors={noteAuthors}
                        viewerId={viewer.userId}
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
