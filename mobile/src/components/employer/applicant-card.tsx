import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useLocale, useTranslations } from 'use-intl';
import { Download, FileX2, MessageSquareText, UserRoundCheck, UserRoundX } from '~/components/ui/lucide';
import { formatDate, formatList } from '@/lib/format';
import { localized } from '@/lib/locale';
import { clean } from '@/lib/security/sanitize';
import { canBrowseAgentDirectory } from '@/lib/permissions';
import { PIPELINE_STAGES, STAGE_TONE, WITHDRAWN_BADGE, WITHDRAWN_TEXT_DARK } from '@/lib/application-stages';
import type { ApplicationNoteRow, ApplicationStatus, InterviewInviteRow } from '@/lib/supabase/database.types';
import { CompanyInterview } from '~/components/interviews/interview-panels';
import { CandidateFile } from '~/components/employer/candidate-file';
import type { CandidateNote, EarlierApplication } from '~/features/employer/candidate-file';
import { firstName } from '@/lib/replies';
import { employerOpener, whatsappLink } from '@/lib/whatsapp';
import { toast } from '~/components/feedback/toast';
import { ReasonTick } from '~/components/employer/reason-tick';
import { ContactButtons } from '~/components/ui/contact-buttons';
import { ApplicantNotes } from '~/components/employer/applicant-notes';
import { SavedRepliesSheet } from '~/components/employer/saved-replies';
import { Avatar } from '~/components/ui/avatar';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { Field } from '~/components/ui/field';
import { ForwardChevron } from '~/components/ui/icons';
import { Select } from '~/components/ui/select';
import { SwipeRow, type SwipeAction } from '~/components/ui/swipe-row';
import { Text } from '~/components/ui/text';
import { TextField } from '~/components/ui/text-field';
import {
  MovedAlready,
  openApplicationCv,
  useSetApplicationStatus,
  type Applicant,
} from '~/features/employer/applicants';
import { ApiError } from '~/lib/api';
import { useSheet } from '~/lib/use-sheet';
import { useSession } from '~/lib/session';
import { useTheme } from '~/theme/provider';
import { space } from '~/theme/tokens';
import { dialog } from '~/lib/dialog';
import { useMoney } from '~/features/money';

/**
 * One applicant, as a company reads them — the website's ApplicantCard: who
 * they are (the directory profile when this company may see it, and a word
 * saying so when it may not — never an empty space that reads as nothing
 * filled in), what they wrote, WhatsApp with the opener already written, the
 * CV, where they stand and the move to the next stage, the reason given to
 * them once there is a decision, and the company's own notes.
 *
 * A move shows at once and is put back if refused; a colleague's move in
 * between is said, and theirs stands.
 */
export function ApplicantCard({
  applicant,
  jobTitle,
  companyName,
  districtNames,
  notes,
  interview,
  candidateFile,
  authors,
  viewerId,
  leaveTo = (go) => go(),
}: {
  applicant: Applicant;
  jobTitle: string;
  companyName: string;
  districtNames: string[];
  /** Undefined until the company's notes have been read. */
  notes: ApplicationNoteRow[] | undefined;
  /** The standing interview invitation (migration 373): null for none, undefined until read. */
  interview?: InterviewInviteRow | null;
  /** What the company knows of the person (migration 375); undefined until read. */
  candidateFile?: { notes: CandidateNote[]; history: EarlierApplication[]; authors: Record<string, string> };
  authors: Record<string, string>;
  viewerId: string | null;
  /**
   * How to go from the card to another screen: at once, or — the card inside a
   * sheet (the review) — once the sheet has gone, since a screen opened under
   * a sheet still showing is never seen.
   */
  leaveTo?: (go: () => void) => void;
}) {
  const t = useTranslations();
  // When the card was drawn: what an invitation's "today" is counted from.
  const [openedAt] = useState(() => Date.now());
  const money = useMoney();
  const locale = useLocale();
  const { colors, scheme } = useTheme();
  const { actor } = useSession();
  const move = useSetApplicationStatus();

  // The stage and reason shown are the stored ones, read afresh with every
  // refresh, except while a move of this card's is on its way. A copy taken
  // once went stale when the stage moved elsewhere (the pipeline, a
  // colleague), and every move from the card was then refused as a colleague's.
  const [pending, setPending] = useState<{ status: ApplicationStatus; reason: string } | null>(null);
  const status = pending?.status ?? applicant.status;
  const withdrawn = status === 'withdrawn';
  const withdrawnText = scheme === 'dark' ? WITHDRAWN_TEXT_DARK : WITHDRAWN_BADGE.color;
  const storedReason = applicant.decision_note ?? '';
  const savedReason = pending?.reason ?? storedReason;
  // The reason being typed follows the stored one for as long as nobody has typed in it.
  const [reasonFrom, setReasonFrom] = useState(storedReason);
  const [reason, setReason] = useState(storedReason);
  // Whether the candidate may read the reason (the employer's tick; on, as before it existed).
  const [shareReason, setShareReason] = useState(true);
  if (storedReason !== reasonFrom) {
    if (reason === reasonFrom) setReason(storedReason);
    setReasonFrom(storedReason);
  }
  const [conflict, setConflict] = useState(false);
  // The move that did not come back, and what was said about it — until the
  // stages, read again, show the server holding it after all (the answer was
  // lost, not the move), as the website's card does.
  const [failed, setFailed] = useState<{ message: string; status: ApplicationStatus; reason: string } | null>(null);
  if (
    failed &&
    !pending &&
    applicant.status === failed.status &&
    storedReason === (clean(failed.reason.trim(), true) || '')
  ) {
    setFailed(null);
  }
  const [cvError, setCvError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  const candidate = applicant.candidate;
  const profile = candidate?.agent_profiles ?? null;
  const name = candidate?.full_name ?? '—';
  const openProfile =
    profile && canBrowseAgentDirectory(actor)
      ? () => leaveTo(() => router.push({ pathname: '/agents/[slug]', params: { slug: profile.slug } }))
      : null;
  const headline = profile ? localized(locale, profile.headline_ar, profile.headline_en) : '';

  const save = (next: ApplicationStatus, decisionNote: string, restoreBox?: string) => {
    const from = status;
    // Kept from the candidate, the reason leaves the row (it becomes a note), so the box empties with it.
    const share = shareReason || !decisionNote.trim();
    setPending({ status: next, reason: share ? decisionNote : '' });
    setConflict(false);
    setFailed(null);
    move.mutate(
      { applicationId: applicant.id, status: next, decisionNote, from, ...(share ? {} : { shareReason: false }) },
      {
        onSuccess: (result) => {
          // Not moved: an admin approves declines here (migration 380), and has been asked.
          if (result.pendingApproval) {
            toast.show({ message: t('app.rules.declineAsked'), tone: 'default' });
            return;
          }
          if (share) return;
          setReason('');
          toast.show(
            result.reasonKept
              ? { message: t('app.applicants.reasonKeptPrivate'), tone: 'success' }
              : { message: t('app.applicants.reasonNotKept'), tone: 'destructive' },
          );
        },
        // Settled once the stages have been read again (the hook waits for that), so what shows next is stored.
        onSettled: () => setPending(null),
        // What they typed stays in the box, and the card says it was not
        // saved. Put back to the stored words, a failed save took their
        // sentence away and the button then read "Saved" over nothing new —
        // the notes below keep a draft the same way.
        onError: (failure) => {
          // A move that emptied the box for its new stage puts back what it showed.
          if (restoreBox !== undefined) setReason(restoreBox);
          if (failure instanceof MovedAlready) setConflict(true);
          else
            setFailed({
              message: failure instanceof ApiError && failure.status === 0 ? t('app.offline.body') : t('common.errorBody'),
              status: next,
              reason: decisionNote,
            });
        },
      },
    );
  };

  // A move from the picker or a swipe: the reason goes with it only when it was typed for it.
  const moveTo = (value: ApplicationStatus) => {
    if (value === status) return;
    const typed = status !== 'new' && reason.trim() !== savedReason.trim();
    if (typed) {
      save(value, reason);
    } else {
      const shown = reason;
      setReason('');
      save(value, '', shown);
    }
  };

  // Swiped aside: shortlist a new applicant (dragged left), or turn one down
  // (dragged right, asked first) — the stage picker's own moves.
  const shortlist: SwipeAction | undefined =
    !withdrawn && status === 'new'
      ? {
          label: t('applicationStatus.shortlisted'),
          icon: <UserRoundCheck size={20} color={colors.successForeground} />,
          color: colors.success,
          ink: colors.successForeground,
          onPress: () => moveTo('shortlisted'),
        }
      : undefined;
  const turnDown: SwipeAction | undefined =
    !withdrawn && status !== 'rejected' && status !== 'hired'
      ? {
          label: t('applicationStatus.rejected'),
          icon: <UserRoundX size={20} color={colors.destructiveForeground} />,
          color: colors.destructive,
          ink: colors.destructiveForeground,
          onPress: () =>
            dialog.alert(t('app.applicants.rejectConfirm'), name, [
              { text: t('common.cancel'), style: 'cancel' },
              { text: t('applicationStatus.rejected'), style: 'destructive', onPress: () => moveTo('rejected') },
            ]),
        }
      : undefined;
  const replies = useSheet();

  const openCv = () => {
    setCvError(null);
    setOpening(true);
    openApplicationCv(applicant.id)
      .catch((failure: unknown) => {
        const code = failure instanceof ApiError ? failure.status : -1;
        setCvError(
          code === 429
            ? t('app.applicants.cvLimit')
            : code === 404
              ? t('employer.noCv')
              : code === 0
                ? t('app.offline.body')
                : t('common.errorBody'),
        );
      })
      .then(() => setOpening(false));
  };

  const facts = [
    applicant.experience_band ? t(`experienceBand.${applicant.experience_band}`) : null,
    t('employer.applicantReceivedOn', { date: formatDate(applicant.created_at, locale) }),
  ].filter((fact): fact is string => Boolean(fact));

  return (
    <SwipeRow left={turnDown} right={shortlist}>
    <Card style={{ gap: space[3] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
        <Avatar name={name} src={candidate?.avatar_url} size="md" />
        <View style={{ flex: 1, gap: 2 }}>
          <Text weight="semibold" accessibilityRole="header" style={withdrawn ? { color: withdrawnText } : undefined}>
            {name}
          </Text>
          <Text variant="small" tone="mutedForeground" style={withdrawn ? { color: withdrawnText } : undefined}>
            {facts.join(' · ')}
          </Text>
        </View>
        {withdrawn ? (
          <Badge label={t('applicationStatus.withdrawn')} />
        ) : (
          <Badge variant={STAGE_TONE[status]} label={t(`applicationStatus.${status}`)} />
        )}
      </View>

      {profile ? (
        <Pressable
          // The whole panel is the way to the full profile, for a company that may read the directory.
          disabled={!openProfile}
          onPress={openProfile ?? undefined}
          accessibilityRole={openProfile ? 'link' : undefined}
          // What it says is read as it is; what pressing does is the hint.
          accessibilityHint={openProfile ? t('agents.viewProfile') : undefined}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: space[2],
            paddingStart: space[3],
            borderStartWidth: 2,
            borderStartColor: pressed ? colors.primary : colors.border,
          })}
        >
          <View style={{ flex: 1, gap: 2 }}>
            {headline ? (
              <Text variant="small" weight="medium">
                {headline}
              </Text>
            ) : null}
            <Text variant="caption" tone="mutedForeground">
              {[
                t('agents.yearsExperience', { count: profile.years_experience }),
                profile.tracks.length ? formatList(profile.tracks.map((track) => t(`track.${track}`)), locale) : null,
                districtNames.length ? formatList(districtNames, locale) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
            {/* Self-reported, as the directory says on the profile itself. */}
            {profile.units_closed != null || profile.volume_egp != null ? (
              <Text variant="caption" weight="medium">
                {[
                  profile.units_closed != null
                    ? t('agents.unitsClosedShort', { count: profile.units_closed })
                    : null,
                  profile.volume_egp != null ? money.amount(profile.volume_egp) : null,
                ]
                  .filter(Boolean)
                  .join('   ')}
              </Text>
            ) : null}
          </View>
          {openProfile ? <ForwardChevron size={18} color={colors.mutedForeground} /> : null}
        </Pressable>
      ) : (
        <Text
          variant="caption"
          tone="mutedForeground"
          style={{ paddingStart: space[3], borderStartWidth: 2, borderStartColor: colors.border }}
        >
          {t('employer.applicantProfilePrivate')}
        </Text>
      )}

      {applicant.note ? <Text variant="small">{`«${applicant.note}»`}</Text> : null}

      {/* Contact in this market is WhatsApp, with the first message already written.
          A withdrawn application is closed: no WhatsApp, no saved replies, no CV,
          no no-CV line. The profile link above is the only action, so this row
          is not drawn. An empty row would still take the card's gap, and the
          16px under the last line would no longer be the card's own. */}
      {!withdrawn ? (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[2] }}>
        {candidate ? (
          <View style={{ flexBasis: '100%' }}>
            <ContactButtons
              size="sm"
              name={name}
              phone={candidate.whatsapp_phone}
              whatsappUrl={whatsappLink(
                candidate.whatsapp_phone,
                employerOpener({ candidateName: name, jobTitle, companyName, locale: locale as 'ar' | 'en' }),
              )}
            />
          </View>
        ) : null}
        {/* The company's own replies, kept on this phone (saved-replies.tsx). */}
        {candidate ? (
          <Button
            label={t('app.replies.open')}
            accessibilityLabel={`${t('app.replies.open')}: ${name}`}
            variant="outline"
            size="sm"
            icon={<MessageSquareText size={16} color={colors.foreground} />}
            onPress={replies.show}
          />
        ) : null}
        {candidate && replies.mounted ? (
          <SavedRepliesSheet
            visible={replies.open}
            onClose={replies.hide}
            onDismiss={replies.onDismiss}
            phone={candidate.whatsapp_phone}
            opener={employerOpener({ candidateName: name, jobTitle, companyName, locale: locale as 'ar' | 'en' })}
            values={{ name, first_name: firstName(name), job: jobTitle, company: companyName, stage: t(`applicationStatus.${status}`) }}
            applicationId={applicant.id}
          />
        ) : null}
        {applicant.cv_path ? (
          <Button
            label={t('employer.downloadCv')}
            accessibilityLabel={`${t('employer.downloadCv')}: ${name}`}
            variant="outline"
            size="sm"
            icon={<Download size={16} color={colors.foreground} />}
            loading={opening}
            onPress={openCv}
          />
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <FileX2 size={14} color={colors.mutedForeground} />
            <Text variant="caption" tone="mutedForeground">
              {t('employer.noCv')}
            </Text>
          </View>
        )}
      </View>
      ) : null}
      {cvError ? (
        <Text variant="small" tone="destructive" accessibilityRole="alert">
          {cvError}
        </Text>
      ) : null}

      {withdrawn ? null : (
      <>
      <Field label={t('employer.moveTo')}>
        <Select
          label={`${t('employer.moveTo')} (${name})`}
          value={status}
          placeholder={t(`applicationStatus.${status}`)}
          required
          options={PIPELINE_STAGES.map((value) => ({ value, label: t(`applicationStatus.${value}`) }))}
          // A reason belongs to the decision it was written for: a move carries
          // one only when it was typed for it — words in the box that are not
          // the saved ones. The saved reason stays with its stage (sent along,
          // a rejection's reason reached the candidate again under
          // "shortlisted"), and at "new" the box is hidden, so nothing in it
          // is on screen to send.
          onChange={(value) => {
            if (value) moveTo(value);
          }}
        />
      </Field>
      {conflict ? (
        <Text variant="small" tone="destructive" accessibilityRole="alert">
          {t('employer.applicantMovedAlready')}
        </Text>
      ) : failed ? (
        <Text variant="small" tone="destructive" accessibilityRole="alert">
          {failed.message}
        </Text>
      ) : null}

      {/* Once there is a decision: its reason, which the candidate reads only when the tick says so. */}
      {status !== 'new' ? (
        <View style={{ gap: space[2], paddingTop: space[3], borderTopWidth: 1, borderTopColor: colors.border }}>
          <Text variant="small" weight="medium">
            {t('employer.decisionNote')}
          </Text>
          {/* The employer decides whether the candidate reads it (v1.1 Phase B). */}
          <ReasonTick shared={shareReason} onChange={setShareReason} testID="reason-tick" />
          <TextField
            tone="brand"
            value={reason}
            onChangeText={setReason}
            accessibilityLabel={t('employer.decisionNote')}
            accessibilityHint={shareReason ? t('employer.decisionNoteHint') : t('app.applicants.reasonPrivateHint')}
            placeholder={t('employer.decisionNotePlaceholder')}
            multiline
            maxLength={500}
            style={{ minHeight: 56, paddingVertical: space[2], textAlignVertical: 'top' }}
          />
          <View style={{ alignItems: 'flex-start' }}>
            <Button
              label={shareReason ? t('employer.decisionNoteSend') : t('app.applicants.reasonKeepPrivate')}
              variant="outline"
              size="sm"
              loading={move.isPending}
              disabled={!reason.trim() || (shareReason && reason.trim() === savedReason.trim())}
              onPress={() => save(status, reason)}
            />
          </View>
        </View>
      ) : null}
      </>
      )}

      {interview !== undefined ? (
        <CompanyInterview
          applicationId={applicant.id}
          name={name}
          invite={interview}
          closed={withdrawn || status === 'rejected' || status === 'hired'}
          now={openedAt}
        />
      ) : null}

      {candidateFile ? (
        <CandidateFile
          applicationId={applicant.id}
          notes={candidateFile.notes}
          history={candidateFile.history}
          authors={candidateFile.authors}
          viewerId={viewerId}
          readOnly={withdrawn}
        />
      ) : null}

      <ApplicantNotes
        applicationId={applicant.id}
        notes={notes}
        authors={authors}
        viewerId={viewerId}
        readOnly={withdrawn}
      />
    </Card>
    </SwipeRow>
  );
}
