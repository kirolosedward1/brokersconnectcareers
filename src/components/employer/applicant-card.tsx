'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowLeft, Download, FileX2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { Link } from '@/i18n/navigation';
import { localized } from '@/i18n/routing';
import { formatDate, formatEgp, formatList, formatNumber, isoDate, whatsappLink } from '@/lib/utils';
import { employerOpener } from '@/lib/whatsapp';
import { setApplicationStatus } from '@/lib/actions/applications';
import type { ApplicationStatus, ExperienceBand, JobTrack } from '@/lib/supabase/database.types';
import type { Locale } from '@/i18n/routing';
import { WhatsAppMark } from '@/components/brand-marks';
import { Avatar } from '@/components/ui/avatar';

export type ApplicantProfile = {
  slug: string;
  headline_ar: string | null;
  headline_en: string | null;
  years_experience: number;
  tracks: JobTrack[];
  district_ids: number[];
  units_closed: number | null;
  volume_egp: number | null;
};

const STATUSES: ApplicationStatus[] = ['new', 'shortlisted', 'interview', 'hired', 'rejected'];

const STATUS_VARIANT: Record<ApplicationStatus, 'default' | 'primary' | 'success' | 'destructive'> = {
  new: 'default',
  shortlisted: 'primary',
  interview: 'primary',
  hired: 'success',
  rejected: 'destructive',
};

export function ApplicantCard({
  application,
  jobTitle,
  companyName,
  locale,
  districtNames,
  headingLevel = 3,
}: {
  application: {
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
      /**
       * Null when this consultant has no directory profile, and also when
       * they have one this employer may not see.
       *
       * Nothing here decides which. The embed runs under the employer's own
       * session and row-level security drops a profile set to hidden, or to
       * verified-employers-only for an unverified company, before it is ever
       * returned — so a card with no profile link is a card where the answer
       * was already no.
       */
      agent_profiles: ApplicantProfile | null;
    } | null;
  };
  jobTitle: string;
  companyName: string;
  locale: Locale;
  /** Names for the districts this consultant works, resolved by the page. */
  districtNames: string[];
  /**
   * The card's own heading level, because the two pages that use it nest it
   * differently: on a listing's applicants the cards sit inside stage sections
   * with their own h2, and on the cross-listing inbox they sit directly under
   * the page's h1. Fixed at h3, the inbox skipped a level.
   */
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const t = useTranslations('employer');
  const tStatus = useTranslations('applicationStatus');
  const tExp = useTranslations('experienceBand');
  const tJobs = useTranslations('jobs');
  const tCommon = useTranslations('common');
  const tAgents = useTranslations('agents');
  const tTrack = useTranslations('track');

  const router = useRouter();
  const [status, setStatus] = useState(application.status);
  const [reason, setReason] = useState(application.decision_note ?? '');
  const [savedReason, setSavedReason] = useState(application.decision_note ?? '');
  const [pending, startTransition] = useTransition();

  const candidate = application.candidate;
  const profile = candidate?.agent_profiles ?? null;
  const headline = profile ? localized(locale, profile.headline_ar, profile.headline_en) : '';

  function save(next: ApplicationStatus, decisionNote: string) {
    const previousStatus = status;
    const previousReason = savedReason;
    setStatus(next);
    setSavedReason(decisionNote);

    startTransition(async () => {
      const result = await setApplicationStatus({
        applicationId: application.id,
        status: next,
        decisionNote,
      });
      if (!result.ok) {
        setStatus(previousStatus);
        setSavedReason(previousReason);
        setReason(previousReason);
        return;
      }
      router.refresh();
    });
  }

  function onStatusChange(event: React.ChangeEvent<HTMLSelectElement>) {
    save(event.target.value as ApplicationStatus, reason);
  }

  return (
    <article className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {/* Seeded on the directory slug where there is one, so the same
              person keeps the same colour across every listing they apply to
              — and on the name otherwise, which is all there is to go on. */}
          <Avatar
            name={candidate?.full_name ?? '—'}
            src={candidate?.avatar_url}
            seed={profile?.slug ?? candidate?.full_name}
            size="md"
          />

          <div className="min-w-0">
            <Heading className="font-semibold">{candidate?.full_name ?? '—'}</Heading>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {application.experience_band ? (
                <Badge variant="outline">{tExp(application.experience_band)}</Badge>
              ) : null}
              <time dateTime={isoDate(application.created_at)}>
                {tJobs('postedOn', { date: formatDate(application.created_at, locale) })}
              </time>
            </p>
          </div>
        </div>

        <Badge variant={STATUS_VARIANT[status]} size="lg">
          {tStatus(status)}
        </Badge>
      </div>

      {/* Who this actually is.
          The site already holds the work history, the districts and the
          record; the hiring screen used to show a name and a phone number and
          leave the rest to a filename. */}
      {profile ? (
        <Link
          href={`/agents/${profile.slug}`}
          title={tAgents('viewProfile')}
          aria-label={tAgents('viewProfile')}
          className="group/profile mt-3 flex items-center gap-3 rounded-xl border border-border p-3 transition-colors hover:border-primary/40 hover:bg-muted/60"
        >
          {/*
            The arrow carries what a line of text used to.

            "شوف الملف الكامل" sat under every applicant panel saying what the
            panel already looks like — a card you can open — and repeated it
            once per applicant down a list of them. The whole panel is the
            link, so the affordance was never the sentence; it is one mark at
            the end of the row, named for a screen reader and on hover.
          */}
          <div className="min-w-0 flex-1">
            {headline ? (
              <p className="text-sm font-medium group-hover/profile:text-primary">{headline}</p>
            ) : null}

            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span>{tAgents('yearsExperience', { count: profile.years_experience })}</span>

              {profile.tracks.length ? (
                <>
                  <span aria-hidden>·</span>
                  <span>{formatList(profile.tracks.map((track) => tTrack(track)), locale)}</span>
                </>
              ) : null}

              {districtNames.length ? (
                <>
                  <span aria-hidden>·</span>
                  <span>{formatList(districtNames, locale)}</span>
                </>
              ) : null}
            </p>

            {/* Self-reported, and the directory says so on the profile itself. */}
            {profile.units_closed != null || profile.volume_egp != null ? (
              <p className="mt-1.5 flex flex-wrap gap-x-3 text-xs font-medium">
                {profile.units_closed != null ? (
                  <span>
                    {tAgents('unitsClosedShort', {
                      count: formatNumber(profile.units_closed, locale),
                    })}
                  </span>
                ) : null}
                {profile.volume_egp != null ? (
                  <span>{formatEgp(profile.volume_egp, locale)} {tCommon('egp')}</span>
                ) : null}
              </p>
            ) : null}
          </div>

          <span
            aria-hidden
            className="grid size-8 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground transition-colors group-hover/profile:border-primary/40 group-hover/profile:bg-primary/5 group-hover/profile:text-primary"
          >
            <ArrowLeft className="rtl-flip size-4" />
          </span>
        </Link>
      ) : (
        /*
          Said, rather than left out.

          A consultant on `hidden` is invisible to the directory and stays
          invisible here — that setting exists so somebody can look without
          their current employer finding out, and the company they work for is
          usually one they applied to. But an absent panel reads as an
          applicant who never filled anything in, which is a different and
          unfair impression. The line says which it is, and points back at what
          they did send.
        */
        <p className="mt-3 rounded-xl border border-dashed border-border p-3 text-xs leading-relaxed text-muted-foreground">
          {t('applicantProfilePrivate')}
        </p>
      )}

      {application.note ? (
        <p className="mt-3 rounded-lg bg-muted p-3 text-sm leading-relaxed">{application.note}</p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {/* Contact in this market is WhatsApp, with the opener already written. */}
        {candidate ? (
          <Button asChild size="sm">
            <a
              href={whatsappLink(
                candidate.whatsapp_phone,
                employerOpener({
                  candidateName: candidate.full_name,
                  jobTitle,
                  companyName,
                  locale,
                }),
              )}
              target="_blank"
              rel="noopener noreferrer"
            >
              <WhatsAppMark />
              {t('whatsappCandidate')}
            </a>
          </Button>
        ) : null}

        {application.cv_path ? (
          <Button asChild variant="outline" size="sm">
            {/* Route handler mints a 5-minute signed URL per click. */}
            <a href={`/api/cv/${application.id}`} target="_blank" rel="noopener noreferrer">
              <Download />
              {t('downloadCv')}
            </a>
          </Button>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <FileX2 className="size-3.5" aria-hidden />
            {t('noCv')}
          </span>
        )}

        <label className="ms-auto flex items-center gap-2 text-xs text-muted-foreground">
          {t('moveTo')}
          <Select value={status} onChange={onStatusChange} disabled={pending} className="h-8 w-auto">
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {tStatus(value)}
              </option>
            ))}
          </Select>
        </label>
      </div>

      {/* Shown once a decision has been made. Not on `new`, where there is
          nothing to explain yet, and never required — a mandatory field here
          fills up with "not a fit", which looks like an answer and is not. */}
      {status !== 'new' ? (
        <div className="mt-4 border-t border-border pt-4">
          <label htmlFor={`reason-${application.id}`} className="text-xs font-medium text-muted-foreground">
            {t('decisionNote')}
          </label>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('decisionNoteHint')}</p>

          <div className="mt-2 flex flex-wrap items-start gap-2">
            <textarea
              id={`reason-${application.id}`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              rows={2}
              placeholder={t('decisionNotePlaceholder')}
              className="min-w-0 flex-1 rounded-lg border border-input bg-background p-2.5 text-sm shadow-xs"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending || reason.trim() === savedReason.trim()}
              onClick={() => save(status, reason)}
            >
              {reason.trim() === savedReason.trim() && savedReason ? t('decisionNoteSaved') : tCommon('save')}
            </Button>
          </div>
        </div>
      ) : null}
    </article>
  );
}
