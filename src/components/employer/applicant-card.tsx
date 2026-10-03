'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Download, FileX2, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { FactLine } from '@/components/ui/fact-line';
import { Button, ICON_HIT_AREA } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { Link } from '@/i18n/navigation';
import { localized } from '@/i18n/routing';
import { formatDate, formatEgp, formatList, formatNumber, isoDate, whatsappLink, cn } from '@/lib/utils';
import { employerOpener } from '@/lib/whatsapp';
import { setApplicationStatus } from '@/lib/actions/applications';
import { reach } from '@/lib/reach';
import { clean } from '@/lib/security/sanitize';
import type {
  ApplicationNoteRow,
  ApplicationStatus,
  ExperienceBand,
  JobTrack,
} from '@/lib/supabase/database.types';
import type { Locale } from '@/i18n/routing';
import { WhatsAppMark } from '@/components/brand-marks';
import { ApplicantNotes } from '@/components/employer/applicant-notes';
import { Avatar } from '@/components/ui/avatar';
import { useSessionRecovery } from '@/lib/session-expired';

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
  notes,
  noteAuthors,
  viewerId,
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
  /** This application's own notes, oldest first. Never sent to the candidate. */
  notes: ApplicationNoteRow[];
  /** Author id → display name, resolved once by the page rather than per card. */
  noteAuthors: Record<string, string>;
  /** Whose delete link shows on which note. */
  viewerId: string;
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
  const tCommon = useTranslations('common');
  const tAgents = useTranslations('agents');
  const tTrack = useTranslations('track');

  const router = useRouter();
  const [status, setStatus] = useState(application.status);
  const [reason, setReason] = useState(application.decision_note ?? '');
  const [savedReason, setSavedReason] = useState(application.decision_note ?? '');
  const [conflict, setConflict] = useState(false);
  // The save that did not come back, until the server is seen holding it.
  const [failed, setFailed] = useState<{ status: ApplicationStatus; reason: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const recoverSession = useSessionRecovery();

  /*
    What the server holds, followed after every refresh. The inbox keys a card
    by its application, so a refresh brings this card new props rather than a
    new card, and a copy taken when it mounted went stale: after a colleague's
    move it went on showing the old stage, and every move from it was refused
    as theirs. The box follows only while nobody has typed in it.
  */
  const storedReason = application.decision_note ?? '';
  const [stored, setStored] = useState({ status: application.status, reason: storedReason });
  if (stored.status !== application.status || stored.reason !== storedReason) {
    setStored({ status: application.status, reason: storedReason });
    setStatus(application.status);
    setSavedReason(storedReason);
    if (reason === savedReason) setReason(storedReason);
    // A save with no answer that landed after all: the server holds what was
    // sent (the reason as it stores it), so it did not fail.
    if (failed && failed.status === application.status && (clean(failed.reason.trim(), true) || '') === storedReason) {
      setFailed(null);
    }
  }

  const candidate = application.candidate;
  const profile = candidate?.agent_profiles ?? null;
  const headline = profile ? localized(locale, profile.headline_ar, profile.headline_en) : '';

  function save(next: ApplicationStatus, decisionNote: string, restoreBox?: string) {
    const previousStatus = status;
    const previousReason = savedReason;
    setStatus(next);
    setSavedReason(decisionNote);
    setConflict(false);
    setFailed(null);

    startTransition(async () => {
      const result = await reach(setApplicationStatus({
        applicationId: application.id,
        status: next,
        decisionNote,
        // What this card was showing. A colleague who moved the same applicant
        // in the meantime wins, and this one is told rather than overwriting
        // them — a company is a team, and two people in the same inbox is an
        // ordinary Tuesday.
        from: previousStatus,
      }));
      if (recoverSession(result)) return;

      if (!result.ok) {
        setStatus(previousStatus);
        setSavedReason(previousReason);
        // A move that emptied the box for the new stage puts back what it showed.
        if (restoreBox !== undefined) setReason(restoreBox);
        // What they typed stays in the box, and the card says it was not
        // saved. Put back to the stored words, a failed save took their
        // sentence away and the button then read "Saved" over nothing new —
        // the notes below keep a draft the same way.
        if (result.error === 'moved_already') {
          setConflict(true);
          // Their move is the one that stands, and it is already on the
          // server — so re-read rather than describe it from here.
          router.refresh();
        } else {
          setFailed({ status: next, reason: decisionNote });
          // No answer: the move may have landed and only the answer been
          // lost, so read what the server holds.
          if (result.error === 'network') router.refresh();
        }
        return;
      }
      router.refresh();
    });
  }

  function onStatusChange(event: React.ChangeEvent<HTMLSelectElement>) {
    /*
      A reason belongs to the decision it was written for, and the candidate
      reads it beside that stage. So a move carries a reason only when one was
      typed for it — words in the box that are not the saved ones. The saved
      reason stays with its own stage: sent along, a rejection's "not enough
      experience" reached the candidate again under "shortlisted". And at
      "new" the box is hidden, so nothing in it is on screen to send.
    */
    const typed = status !== 'new' && reason.trim() !== savedReason.trim();
    if (typed) {
      save(event.target.value as ApplicationStatus, reason);
    } else {
      const shown = reason;
      setReason('');
      save(event.target.value as ApplicationStatus, '', shown);
    }
  }

  return (
    <article className="rounded-xl border border-border bg-card px-4 py-3.5 sm:px-5">
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
            <FactLine className="mt-0.5 text-sm text-muted-foreground">
              {application.experience_band ? <span>{tExp(application.experience_band)}</span> : null}
              <time dateTime={isoDate(application.created_at)}>
                {t('applicantReceivedOn', { date: formatDate(application.created_at, locale) })}
              </time>
            </FactLine>
          </div>
        </div>

        <Badge variant={STATUS_VARIANT[status]}>{tStatus(status)}</Badge>
      </div>

      {/* Who this actually is.
          The site already holds the work history, the districts and the
          record; the hiring screen used to show a name and a phone number and
          leave the rest to a filename. */}
      {profile ? (
        <Link
          href={`/agents/${profile.slug}`}
          // Named by what it shows, with "view profile" as its description:
          // an aria-label of those two words replaced the visible text, so
          // every applicant's link had the same name and voice control could
          // not reach it by what is on screen.
          title={tAgents('viewProfile')}
          // A rule down the leading edge, not a box. Inside a card that is
          // already bordered, a second border around the record, a third around
          // the magnifier and a fill behind the note made every applicant four
          // nested rectangles deep.
          className="group/profile mt-2.5 flex items-center gap-3 border-s-2 border-border ps-3 transition-colors hover:border-primary"
        >
          {/*
            The arrow carries what a line of text used to.

            "شوف الملف الكامل" sat under every applicant panel saying what the
            panel already looks like — a card you can open — and repeated it
            once per applicant down a list of them. The whole panel is the
            link, so the affordance was never the sentence; it is one mark at
            the end of the row, described for a screen reader and on hover.

            A magnifier rather than an arrow: an arrow says "onward", which is
            true of every link on the page, and what this one actually offers
            is a closer look at the person whose name is beside it. No
            rtl-flip — a magnifier has a handed shape of its own and mirroring
            it produces a glyph nobody draws.
          */}
          <div className="min-w-0 flex-1">
            {headline ? (
              <p className="text-sm font-medium group-hover/profile:text-primary">{headline}</p>
            ) : null}

            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
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
              <p className="mt-1 flex flex-wrap gap-x-3 text-xs font-medium">
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
            className={cn(
              ICON_HIT_AREA,
              'shrink-0 rounded-lg text-muted-foreground transition-colors',
              'group-hover/profile:bg-primary/5 group-hover/profile:text-primary',
            )}
          >
            <Search className="size-4" aria-hidden />
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
        <p className="mt-2.5 border-s-2 border-dashed border-border ps-3 text-xs leading-relaxed text-muted-foreground">
          {t('applicantProfilePrivate')}
        </p>
      )}

      {application.note ? (
        <p className="mt-2.5 text-sm leading-relaxed">
          <span aria-hidden className="text-muted-foreground">«</span>
          {application.note}
          <span aria-hidden className="text-muted-foreground">»</span>
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
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
              <Download aria-hidden />
              {t('downloadCv')}
            </a>
          </Button>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <FileX2 className="size-3.5" aria-hidden />
            {t('noCv')}
          </span>
        )}

        {conflict ? (
          <p role="alert" className="w-full text-xs text-destructive">
            {t('applicantMovedAlready')}
          </p>
        ) : failed ? (
          <p role="alert" className="w-full text-xs text-destructive">
            {tCommon('errorBody')}
          </p>
        ) : null}

        <label className="ms-auto flex items-center gap-2 text-xs text-muted-foreground">
          {t('moveTo')}
          <Select
            size="sm"
            value={status}
            onChange={onStatusChange}
            disabled={pending}
            className="w-auto"
          >
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

      {/* Below the decision note deliberately, and separated from it. The one
          above is written to the candidate; this one they cannot read. */}
      <ApplicantNotes
        applicationId={application.id}
        notes={notes}
        authors={noteAuthors}
        locale={locale}
        viewerId={viewerId}
      />
    </article>
  );
}
