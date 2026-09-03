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
 * The CV half of a consultant profile.
 *
 * Nothing here decides who may see it. Every row arrives from a query that ran
 * under the reader's own session, and row-level security already dropped the
 * ones belonging to a profile they cannot see — including, for a consultant
 * hiding from their employer, the row naming that employer. An empty section
 * renders as nothing rather than as a gap.
 */
export async function AgentCv({
  locale,
  summary,
  unitsClosed,
  volumeEgp,
  experience,
  education,
  certifications,
  districts,
}: {
  locale: string;
  summary: string | null;
  unitsClosed: number | null;
  volumeEgp: number | null;
  experience: AgentExperienceRow[];
  education: AgentEducationRow[];
  certifications: AgentCertificationRow[];
  districts: Map<number, DistrictRow>;
}) {
  const t = await getTranslations('cv');
  const tTrack = await getTranslations('track');

  const hasRecord = unitsClosed != null || volumeEgp != null;
  if (!summary && !hasRecord && !experience.length && !education.length && !certifications.length) {
    return null;
  }

  const month = (value: string) => value.slice(0, 7);

  return (
    <div className="mt-10 space-y-10">
      {summary ? (
        <section aria-labelledby="cv-objective">
          <h2 id="cv-objective" className="flex items-center gap-2 text-sm font-semibold">
            <Quote className="size-4 text-muted-foreground" aria-hidden />
            {t('objective')}
          </h2>
          <p className="mt-3 leading-relaxed text-muted-foreground">{summary}</p>
        </section>
      ) : null}

      {/* The record leads, because in this market it is what an employer reads
          first — and it is self-reported, which the label says out loud. */}
      {hasRecord ? (
        <section aria-labelledby="cv-record">
          <h2 id="cv-record" className="text-sm font-semibold">
            {t('record')}
          </h2>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            {unitsClosed != null ? (
              <div className="rounded-xl border border-border bg-card p-4">
                <dt className="text-xs text-muted-foreground">{t('unitsClosed')}</dt>
                <dd className="numeral mt-1 text-2xl font-bold">
                  {formatNumber(unitsClosed, locale)}
                </dd>
              </div>
            ) : null}
            {volumeEgp != null ? (
              <div className="rounded-xl border border-border bg-card p-4">
                <dt className="text-xs text-muted-foreground">{t('volumeEgp')}</dt>
                <dd className="numeral mt-1 text-2xl font-bold">{formatEgp(volumeEgp, locale)}</dd>
              </div>
            ) : null}
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">{t('recordHint')}</p>
        </section>
      ) : null}

      {experience.length ? (
        <section aria-labelledby="cv-experience">
          <h2 id="cv-experience" className="flex items-center gap-2 text-sm font-semibold">
            <Briefcase className="size-4 text-muted-foreground" aria-hidden />
            {t('experience')}
          </h2>

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
                    <p className="numeral mt-1 text-xs text-muted-foreground">
                      {month(job.started)} — {job.ended ? month(job.ended) : t('present')}
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
      ) : null}

      {education.length ? (
        <section aria-labelledby="cv-education">
          <h2 id="cv-education" className="flex items-center gap-2 text-sm font-semibold">
            <GraduationCap className="size-4 text-muted-foreground" aria-hidden />
            {t('education')}
          </h2>
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
      ) : null}

      {certifications.length ? (
        <section aria-labelledby="cv-certifications">
          <h2 id="cv-certifications" className="flex items-center gap-2 text-sm font-semibold">
            <Award className="size-4 text-muted-foreground" aria-hidden />
            {t('certifications')}
          </h2>
          <ul className="mt-4 flex flex-wrap gap-2">
            {certifications.map((row) => (
              <li
                key={row.id}
                className="rounded-xl border border-border bg-card px-3.5 py-2 text-sm"
              >
                <span className="font-medium">{row.name}</span>
                {row.issuer ? (
                  <span className="text-muted-foreground"> · {row.issuer}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
