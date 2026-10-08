import { useState } from 'react';
import { Alert, Linking, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useLocale, useTranslations } from 'use-intl';
import { Download, FileX2, MessageCircle, MessageSquareText, UserRoundCheck, UserRoundX } from '~/components/ui/lucide';
import { formatDate, formatEgp, formatList } from '@/lib/format';
import { localized } from '@/lib/locale';
import { clean } from '@/lib/security/sanitize';
import { canBrowseAgentDirectory } from '@/lib/permissions';
import type { ApplicationNoteRow, ApplicationStatus } from '@/lib/supabase/database.types';
import { employerOpener, whatsappLink } from '@/lib/whatsapp';
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
import { STATUS_VARIANT } from '~/features/applications/queries';
import {
  MovedAlready,
  openApplicationCv,
  STAGES,
  useSetApplicationStatus,
  type Applicant,
} from '~/features/employer/applicants';
import { ApiError } from '~/lib/api';
import { useSession } from '~/lib/session';
import { useTheme } from '~/theme/provider';
import { space } from '~/theme/tokens';

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
  authors,
  viewerId,
}: {
  applicant: Applicant;
  jobTitle: string;
  companyName: string;
  districtNames: string[];
  /** Undefined until the company's notes have been read. */
  notes: ApplicationNoteRow[] | undefined;
  authors: Record<string, string>;
  viewerId: string | null;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const { actor } = useSession();
  const move = useSetApplicationStatus();

  // The stage and reason shown are the stored ones, read afresh with every
  // refresh, except while a move of this card's is on its way. A copy taken
  // once went stale when the stage moved elsewhere (the pipeline, a
  // colleague), and every move from the card was then refused as a colleague's.
  const [pending, setPending] = useState<{ status: ApplicationStatus; reason: string } | null>(null);
  const status = pending?.status ?? applicant.status;
  const storedReason = applicant.decision_note ?? '';
  const savedReason = pending?.reason ?? storedReason;
  // The reason being typed follows the stored one for as long as nobody has typed in it.
  const [reasonFrom, setReasonFrom] = useState(storedReason);
  const [reason, setReason] = useState(storedReason);
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
      ? () => router.push({ pathname: '/agents/[slug]', params: { slug: profile.slug } })
      : null;
  const headline = profile ? localized(locale, profile.headline_ar, profile.headline_en) : '';

  const save = (next: ApplicationStatus, decisionNote: string, restoreBox?: string) => {
    const from = status;
    setPending({ status: next, reason: decisionNote });
    setConflict(false);
    setFailed(null);
    move.mutate(
      { applicationId: applicant.id, status: next, decisionNote, from },
      {
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
    status === 'new'
      ? {
          label: t('applicationStatus.shortlisted'),
          icon: <UserRoundCheck size={20} color="#FFFFFF" />,
          color: colors.success,
          onPress: () => moveTo('shortlisted'),
        }
      : undefined;
  const turnDown: SwipeAction | undefined =
    status !== 'rejected' && status !== 'hired'
      ? {
          label: t('applicationStatus.rejected'),
          icon: <UserRoundX size={20} color="#FFFFFF" />,
          color: colors.destructive,
          onPress: () =>
            Alert.alert(t('app.applicants.rejectConfirm'), name, [
              { text: t('common.cancel'), style: 'cancel' },
              { text: t('applicationStatus.rejected'), style: 'destructive', onPress: () => moveTo('rejected') },
            ]),
        }
      : undefined;
  const [repliesOpen, setRepliesOpen] = useState(false);

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
        <Avatar name={name} src={candidate?.avatar_url} seed={profile?.slug ?? name} size="md" />
        <View style={{ flex: 1, gap: 2 }}>
          <Text weight="semibold" accessibilityRole="header">
            {name}
          </Text>
          <Text variant="small" tone="mutedForeground">
            {facts.join(' · ')}
          </Text>
        </View>
        <Badge variant={STATUS_VARIANT[status]} label={t(`applicationStatus.${status}`)} />
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
                  profile.volume_egp != null ? `${formatEgp(profile.volume_egp, locale)} ${t('common.egp')}` : null,
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

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[2] }}>
        {/* Contact in this market is WhatsApp, with the first message already written. */}
        {candidate ? (
          <Button
            label={t('employer.whatsappCandidate')}
            accessibilityLabel={`${t('employer.whatsappCandidate')}: ${name}`}
            size="sm"
            icon={<MessageCircle size={16} color={colors.primaryForeground} />}
            onPress={() =>
              Linking.openURL(
                whatsappLink(candidate.whatsapp_phone, employerOpener({ candidateName: name, jobTitle, companyName, locale: locale as 'ar' | 'en' })),
              ).catch(() => {})
            }
          />
        ) : null}
        {/* The company's own replies, kept on this phone (saved-replies.tsx). */}
        {candidate ? (
          <Button
            label={t('app.replies.open')}
            accessibilityLabel={`${t('app.replies.open')}: ${name}`}
            variant="outline"
            size="sm"
            icon={<MessageSquareText size={16} color={colors.foreground} />}
            onPress={() => setRepliesOpen(true)}
          />
        ) : null}
        {candidate && repliesOpen ? (
          <SavedRepliesSheet
            visible
            onClose={() => setRepliesOpen(false)}
            phone={candidate.whatsapp_phone}
            opener={employerOpener({ candidateName: name, jobTitle, companyName, locale: locale as 'ar' | 'en' })}
            values={{ name, job: jobTitle }}
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
      {cvError ? (
        <Text variant="small" tone="destructive" accessibilityRole="alert">
          {cvError}
        </Text>
      ) : null}

      <Field label={t('employer.moveTo')}>
        <Select
          label={`${t('employer.moveTo')} (${name})`}
          value={status}
          placeholder={t(`applicationStatus.${status}`)}
          required
          options={STAGES.map((value) => ({ value, label: t(`applicationStatus.${value}`) }))}
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

      {/* Once there is a decision: written to the candidate, and never required. */}
      {status !== 'new' ? (
        <View style={{ gap: space[2], paddingTop: space[3], borderTopWidth: 1, borderTopColor: colors.border }}>
          <Field label={t('employer.decisionNote')} hint={t('employer.decisionNoteHint')}>
            <TextField
              value={reason}
              onChangeText={setReason}
              accessibilityLabel={t('employer.decisionNote')}
              placeholder={t('employer.decisionNotePlaceholder')}
              multiline
              maxLength={500}
              style={{ minHeight: 56, paddingVertical: space[2], textAlignVertical: 'top' }}
            />
          </Field>
          <View style={{ alignItems: 'flex-start' }}>
            <Button
              label={reason.trim() === savedReason.trim() && savedReason ? t('employer.decisionNoteSaved') : t('common.save')}
              accessibilityLabel={`${t('employer.decisionNote')}: ${t('common.save')}`}
              variant="outline"
              size="sm"
              loading={move.isPending}
              disabled={reason.trim() === savedReason.trim()}
              onPress={() => save(status, reason)}
            />
          </View>
        </View>
      ) : null}

      <ApplicantNotes applicationId={applicant.id} notes={notes} authors={authors} viewerId={viewerId} />
    </Card>
    </SwipeRow>
  );
}
