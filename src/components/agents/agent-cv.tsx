import { getTranslations } from 'next-intl/server';
import { Award, Briefcase, GraduationCap, Quote } from 'lucide-react';
import { localized } from '@/i18n/routing';
import { formatEgp, formatNumber } from '@/lib/utils';
import type {
  AgentCertificationRow,
  AgentEducationRow,
  AgentExperienceRow,
  DistrictRow,
} from '@/lib/supabase/database.types';

/**
 * The CV half of a consultant profile, in pieces.
 *
 * Nothing here decides who may see it. Every row arrives from a query that ran
 * under the reader's own session, and row-level security already dropped the
 * ones belonging to a profile they cannot see — including, for a consultant
 * hiding from their employer, the row naming that employer. An empty section
 * renders as nothing rather than as a gap.
 *
 * Exported as sections rather than one block so the profile page can put the
 * specialisms and areas between the work history and the education, which is
 * the order a recruiter reads a consultant in.
 */

/** A `YYYY-MM-DD` as `YYYY-MM`, drawn left-to-right whatever the page's direction. */
function Month({ value }: { value: string }) {
  return (
    <bdi dir="ltr" className="numeral">
      {value.slice(0, 7)}
    </bdi>
  );
}

export function SectionHeading({
  id,
  icon,
  children,
}: {
  id: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <h2 id={id} className="flex items-center gap-2 text-sm font-semibold">
      {icon}
      {children}
    </h2>
  );
}

export async function AgentAbout({
  locale,
  summary,
  unitsClosed,
  volumeEgp,
}: {
  locale: string;
  summary: string | null;
  unitsClosed: number | null;
  volumeEgp: number | null;
}) {
  const t = await getTranslations('cv');
  const hasRecord = unitsClosed != null || volumeEgp != null;
  if (!summary && !hasRecord) return null;

  return (
    <div className="space-y-6">
      {summary ? (
        <section aria-labelledby="cv-objective">
          <SectionHeading id="cv-objective" icon={<Quote className="size-4 text-muted-foreground" aria-hidden />}>
            {t('objective')}
          </SectionHeading>
          <p className="mt-3 whitespace-pre-line leading-relaxed text-muted-foreground">{summary}</p>
        </section>
      ) : null}

      {/* The record leads, because in this market it is what an employer reads
          first — and it is self-reported, which the label says out loud. */}
      {hasRecord ? (
        <section aria-labelledby="cv-record">
          <SectionHeading id="cv-record">{t('record')}</SectionHeading>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            {unitsClosed != null ? (
              <div className="rounded-xl border border-border bg-card p-4">
                <dt className="text-xs text-muted-foreground">{t('unitsClosed')}</dt>
                <dd className="mt-1 text-2xl font-bold">
                  <span className="numeral">{formatNumber(unitsClosed, locale)}</span>
                </dd>
              </div>
            ) : null}
            {volumeEgp != null ? (
              <div className="rounded-xl border border-border bg-card p-4">
                <dt className="text-xs text-muted-foreground">{t('volumeEgp')}</dt>
                <dd className="mt-1 text-2xl font-bold">
                  <span className="numeral">{formatEgp(volumeEgp, locale)}</span>
                </dd>
              </div>
            ) : null}
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">{t('recordHint')}</p>
        </section>
      ) : null}
    </div>
  );
}

export async function AgentExperience({
  locale,
  experience,
  districts,
}: {
  locale: string;
  experience: AgentExperienceRow[];
  districts: Map<number, DistrictRow>;
}) {
  const t = await getTranslations('cv');
  const tTrack = await getTranslations('track');
  if (!experience.length) return null;

  return (
    <section aria-labelledby="cv-experience">
      <SectionHeading id="cv-experience" icon={<Briefcase className="size-4 text-muted-foreground" aria-hidden />}>
        {t('experience')}
      </SectionHeading>

      <ol className="mt-4 space-y-0">
        {experience.map((job, index) => {
          const district = job.district_id ? districts.get(job.district_id) : null;
          const last = index === experience.length - 1;

          return (
            <li key={job.id} className="grid grid-cols-[auto_1fr] gap-x-4">
              <div className="flex flex-col items-center">
                <span
                  aria-hidden
                  className={
                    job.ended
                      ? 'mt-1.5 size-2.5 rounded-full bg-border'
                      : 'bg-brand-gradient mt-1.5 size-2.5 rounded-full'
                  }
                />
                {last ? null : <span aria-hidden className="w-px flex-1 bg-border" />}
              </div>

              <div className={last ? '' : 'pb-6'}>
                <p className="font-semibold">{job.title}</p>
                <p className="text-sm text-muted-foreground">
                  {job.company_name}
                  {district ? ` · ${localized(locale, district.name_ar, district.name_en)}` : ''}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  <Month value={job.started} /> — {job.ended ? <Month value={job.ended} /> : t('present')}
                  {job.track ? ` · ${tTrack(job.track)}` : ''}
                </p>
                {job.highlights ? (
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {job.highlights}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export async function AgentEducation({ education }: { education: AgentEducationRow[] }) {
  const t = await getTranslations('cv');
  if (!education.length) return null;

  return (
    <section aria-labelledby="cv-education">
      <SectionHeading id="cv-education" icon={<GraduationCap className="size-4 text-muted-foreground" aria-hidden />}>
        {t('education')}
      </SectionHeading>
      <ul className="mt-4 space-y-3">
        {education.map((row) => (
          <li key={row.id}>
            <p className="font-medium">{row.institution}</p>
            <p className="text-sm text-muted-foreground">
              {[row.degree, row.field].filter(Boolean).join(' · ')}
              {row.graduated ? (
                <span className="numeral">
                  {[row.degree, row.field].filter(Boolean).length ? ' · ' : ''}
                  {row.graduated}
                </span>
              ) : null}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export async function AgentCertifications({
  certifications,
}: {
  certifications: AgentCertificationRow[];
}) {
  const t = await getTranslations('cv');
  if (!certifications.length) return null;

  return (
    <section aria-labelledby="cv-certifications">
      <SectionHeading id="cv-certifications" icon={<Award className="size-4 text-muted-foreground" aria-hidden />}>
        {t('certifications')}
      </SectionHeading>
      <ul className="mt-4 flex flex-wrap gap-2">
        {certifications.map((row) => (
          <li
            key={row.id}
            className="rounded-xl border border-border bg-card px-3.5 py-2 text-sm"
          >
            <span className="font-medium">{row.name}</span>
            {row.issuer ? <span className="text-muted-foreground"> · {row.issuer}</span> : null}
            {row.issued ? (
              <span className="text-muted-foreground">
                {' '}
                · <Month value={row.issued} />
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
