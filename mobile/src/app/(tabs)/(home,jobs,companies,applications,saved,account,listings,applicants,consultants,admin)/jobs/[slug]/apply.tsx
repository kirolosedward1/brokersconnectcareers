import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type ScrollViewInstance, type TextInputInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, Stack, useLocalSearchParams, useNavigation } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'use-intl';
import {
  BadgeCheck,
  CalendarX2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleSlash,
  Eye,
  EyeOff,
  FileText,
  Paperclip,
  ShieldAlert,
  ShieldCheck,
  UserRound,
} from '~/components/ui/lucide';
import type { JobDetail } from '@/lib/job-list';
import { formatDate, formatNumber } from '@/lib/format';
import { jobIsLive } from '@/lib/job-state';
import { localized } from '@/lib/locale';
import { isApproved, isCandidate } from '@/lib/permissions';
import { isValidPhone, normalisePhone } from '@/lib/phone';
import { bandFor } from '@/lib/match';
import type { AgentVisibility, ExperienceBand } from '@/lib/supabase/database.types';
import { EXPERIENCE_BANDS } from '@/lib/taxonomy';
import { ConsentCheck } from '~/components/auth/consent-check';
import { SocialSignIn } from '~/components/auth/social-sign-in';
import { JobCard } from '~/components/jobs/job-card';
import { Button } from '~/components/ui/button';
import { Appear } from '~/components/motion/appear';
import { DrawnCheck } from '~/components/motion/celebration';
import { PushPrompt } from '~/components/push/push-prompt';
import { Avatar } from '~/components/ui/avatar';
import { Card } from '~/components/ui/card';
import { ChoiceCard } from '~/components/ui/choice-card';
import { Field } from '~/components/ui/field';
import { Notice } from '~/components/ui/notice';
import { Num } from '~/components/ui/num';
import { Select } from '~/components/ui/select';
import { ViewerPending } from '~/components/navigation/viewer-pending';
import { EmptyState, ErrorState, LoadingState, NotFoundState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { TextField } from '~/components/ui/text-field';
import { ApplyRefused, useApplyContext, useApplyToJob, useNextRoles, type Attachment, type LastCv } from '~/features/apply/apply';
import { applyQueue, offlineFailure } from '~/features/apply/queue';
import { useAuthErrorText } from '~/features/auth/errors';
import type { ProviderOutcome } from '~/features/auth/providers';
import { pickCv, type PickedCv } from '~/features/cv/files';
import { useJob } from '~/features/jobs/queries';
import { useAgentProfile } from '~/features/profile/queries';
import { useDistricts } from '~/features/taxonomy';
import { markupTags } from '~/i18n/rich';
import { track } from '~/lib/analytics';
import { ApiError, callAction } from '~/lib/api';
import { noteFailure } from '~/lib/crash-log';
import { haptic } from '~/lib/haptics';
import { holdOnboarding, useOnboardingHeld } from '~/lib/onboarding-hold';
import { fetchViewer, useSession } from '~/lib/session';
import { useErrorsInView } from '~/lib/use-errors-in-view';
import { useLeaveGuard } from '~/lib/use-leave-guard';
import { draftKey } from '~/lib/kept-draft';
import { useKeptDraft } from '~/lib/use-kept-draft';
import { DraftNotice } from '~/components/ui/draft-notice';
import { useHasBoard } from '~/lib/use-tabs';
import { useToBoard } from '~/features/jobs/to-board';
import { useLargeText } from '~/theme/large-text';
import { useTheme } from '~/theme/provider';
import { corner, gutter, hitTarget, motion, space } from '~/theme/tokens';
import { useAnnounce } from '~/lib/use-announce';

/** The note's limit, the website's (applyToJob). */
const NOTE_MAX = 500;

/**
 * Applying to a listing — the website's /jobs/<slug>/apply, at the same path
 * so a sign-in that began with "apply" comes back here.
 *
 * The page decides which of its states somebody gets, in the website's
 * order: a closed listing; nobody signed in; an account that is not a
 * candidate's; a candidate the database would refuse (held or suspended —
 * said in words rather than met with an error after typing a note); an
 * application already made (read, never guessed); and otherwise the form.
 *
 * Nobody signed in gets the form too (v1.1, the ApplyGuest board), with a
 * way to make an account inside it: Apple or Google make it on the spot, and
 * the same form — the CV and the note as they were — then asks what the
 * account needs (the name and number, who sees the directory card, the
 * Terms), makes it, and sends the application; the rest of onboarding comes
 * after (onboarding?setup=1). An email address goes through sign-up and its
 * confirmation first, and comes back here.
 *
 * Once it is sent, the confirmation says what, where and when, and offers two
 * more roles while the candidate is in the mood.
 */
export default function ApplyScreen() {
  const { slug: raw } = useLocalSearchParams<{ slug: string }>();
  const slug = typeof raw === 'string' ? raw.toLowerCase() : '';
  const t = useTranslations();
  const job = useJob(slug);
  // Signing up from inside the form clears what the cache held (a new person:
  // session.tsx), the listing too: the form stays on the listing it has while
  // it is read again, rather than give way to a spinner and lose what was typed.
  const [held, setHeld] = useState<{ slug: string; data: NonNullable<typeof job.data> } | null>(null);
  if (job.data && held?.data !== job.data) setHeld({ slug, data: job.data });
  const data = job.data ?? (held?.slug === slug ? held.data : undefined);

  const header = <Stack.Screen options={{ title: t('app.apply.screenTitle') }} />;

  if (!data && job.isPending) {
    return (
      <>
        {header}
        <LoadingState />
      </>
    );
  }
  // A failed re-read in the background must not take the form away: only a
  // first read that failed is an error page (TanStack keeps the data beside the error).
  if (job.isError && !data) {
    return (
      <>
        {header}
        {job.error instanceof ApiError && job.error.status === 404 ? (
          <NotFoundState />
        ) : (
          <ErrorState error={job.error} onRetry={() => job.refetch()} />
        )}
      </>
    );
  }

  return (
    <>
      {header}
      {data ? <Apply job={data.job} /> : <LoadingState />}
    </>
  );
}

type Mode = 'guest' | 'newAccount' | 'member';

function Apply({ job }: { job: JobDetail }) {
  const t = useTranslations();
  const locale = useLocale();
  const { session, viewer, actor } = useSession();
  const context = useApplyContext(isCandidate(actor) ? job.id : null);
  const hasBoard = useHasBoard();
  const toBoard = useToBoard();
  const navigation = useNavigation();
  // This screen is making the account (guest apply): the gate waits for it.
  const held = useOnboardingHeld();
  const [sent, setSent] = useState<{ newAccount: boolean; queued: boolean } | null>(null);

  // The buttons that name the listing lead to it: back, when this page was
  // opened from it; otherwise (a link, a sign-in that came back here) the
  // listing in place of this page, not whatever the tab had underneath.
  const toListing = () => {
    const routes = navigation.getState()?.routes ?? [];
    const below = routes.length > 1 ? routes[routes.length - 2] : null;
    const params = (below?.params ?? {}) as { slug?: string };
    if (below?.name === 'jobs/[slug]' && params.slug?.toLowerCase() === job.slug) router.back();
    else router.replace({ pathname: '/jobs/[slug]', params: { slug: job.slug } });
  };

  const title = localized(locale, job.title_ar, job.title_en);

  if (sent?.queued) return <Queued job={job} />;
  if (sent) return <Sent job={job} newAccount={sent.newAccount} />;

  if (!jobIsLive(job)) {
    return (
      <EmptyState
        icon={CalendarX2}
        title={t('jobs.expired')}
        body={t('jobs.expiredBody')}
        action={hasBoard ? <Button label={t('nav.browseJobs')} onPress={toBoard} /> : null}
      />
    );
  }

  let mode: Mode | null = null;
  if (!session) mode = 'guest';
  // Signed up from inside the form a moment ago: the form stays while the account is read, and asks what it needs.
  else if (held && (!viewer || (!viewer.profile && !viewer.profileUnreadable))) mode = 'newAccount';

  if (!mode) {
    if (!viewer?.profile) return <ViewerPending />;

    if (!isCandidate(actor)) {
      return (
        <EmptyState
          icon={CircleSlash}
          title={t('apply.employerCannotApply')}
          action={<Button label={title} variant="outline" onPress={toListing} />}
        />
      );
    }

    // The insert policy asks for an approved candidate: a held or suspended one is told why, before typing.
    if (!isApproved(actor)) {
      return (
        <EmptyState
          icon={ShieldAlert}
          title={t('apply.suspendedTitle')}
          body={t('apply.suspendedBody')}
          action={<Button label={title} variant="outline" onPress={toListing} />}
        />
      );
    }

    if (context.isPending) return <LoadingState />;
    if (context.isError && !context.data) return <ErrorState error={context.error} onRetry={() => context.refetch()} />;

    if (context.data.existing) {
      return (
        <EmptyState
          icon={CheckCircle2}
          title={t('apply.alreadyApplied')}
          action={
            <View style={{ gap: space[2], alignItems: 'center' }}>
              <Button label={t('apply.viewApplications')} onPress={() => router.navigate('/dashboard/applications')} />
              <Button label={title} variant="outline" onPress={toListing} />
            </View>
          }
        />
      );
    }
    mode = 'member';
  }

  // One form for the three, at one place in the tree: a guest who signs up
  // from inside it keeps the CV and the note they had chosen.
  return (
    <ApplyForm
      job={job}
      mode={mode}
      userId={session?.user.id ?? null}
      defaultName={viewer?.profile?.full_name ?? providerName(session?.user.user_metadata)}
      defaultPhone={viewer?.profile?.whatsapp_phone ?? ''}
      profileCv={mode === 'member' ? (context.data?.profileCv ?? null) : null}
      lastCv={mode === 'member' ? (context.data?.lastCv ?? null) : null}
      onSent={(newAccount, queued) => {
        haptic.success();
        setSent({ newAccount, queued });
      }}
    />
  );
}

/** The name a provider gave with the account (Apple's on the first sign-in, Google's always). */
function providerName(metadata: Record<string, unknown> | undefined): string {
  const value = metadata?.full_name ?? metadata?.name;
  return typeof value === 'string' ? value : '';
}

type Errors = Partial<Record<'fullName' | 'whatsapp' | 'experienceBand' | 'cv' | 'visibility' | 'terms' | 'account' | 'form', string>>;
type CvChoice = { kind: 'last' } | { kind: 'profile' } | { kind: 'none' } | { kind: 'file'; file: PickedCv };

function ApplyForm({
  job,
  mode,
  userId,
  defaultName,
  defaultPhone,
  profileCv,
  lastCv,
  onSent,
}: {
  job: JobDetail;
  mode: Mode;
  /** Whose draft this form keeps (kept-draft.ts); nobody's while signed out. */
  userId: string | null;
  defaultName: string;
  defaultPhone: string;
  profileCv: string | null;
  lastCv: LastCv | null;
  /** Sent — or, with no connection, kept to be sent when there is one (`queued`). */
  onSent: (newAccount: boolean, queued: boolean) => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const large = useLargeText();
  const queryClient = useQueryClient();
  const apply = useApplyToJob();
  const errorText = useAuthErrorText();
  const scroll = useRef<ScrollViewInstance>(null);
  const inView = useErrorsInView(scroll, ['account', 'fullName', 'whatsapp', 'experienceBand', 'cv', 'visibility', 'terms']);
  const whatsappField = useRef<TextInputInstance>(null);
  const member = mode === 'member';

  // The gate held while this screen makes the account; let go when it is done or left.
  const release = useRef<(() => void) | null>(null);
  useEffect(() => () => release.current?.(), []);

  // The name as typed, or else the one known: a provider's name arrives with the account it makes.
  const [typedName, setFullName] = useState<string | null>(null);
  const fullName = typedName ?? defaultName;
  const [whatsapp, setWhatsapp] = useState(defaultPhone);
  // The band the profile's years put them in, until they pick another. Years
  // are stored as 0 until given (the column's default): then the website's
  // own default, not "under a year".
  const agentProfile = useAgentProfile();
  const agent = member ? (agentProfile.data?.agent ?? null) : null;
  const years = agent?.years_experience;
  const [picked, setBand] = useState<ExperienceBand | null>(null);
  const band = picked ?? (years ? bandFor(years) : 'junior_1_3');
  const [note, setNote] = useState('');
  const [visibility, setVisibility] = useState<AgentVisibility | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [email, setEmail] = useState('');
  const [signingUp, setSigningUp] = useState(false);
  // The CV last applied with goes again unless the candidate says otherwise
  // (v1.1), else the one on the profile — the profile's as it is now:
  // replaced or taken off in another tab while this was open, the form
  // follows it, and never sends a path the profile has let go of.
  const [choice, setChoice] = useState<CvChoice | null>(null);
  const chosen: CvChoice = choice ?? (lastCv ? { kind: 'last' } : profileCv ? { kind: 'profile' } : { kind: 'none' });
  const attachment: Attachment =
    chosen.kind === 'file'
      ? chosen
      : chosen.kind === 'last' && lastCv
        ? { kind: 'profile', path: lastCv.path }
        : chosen.kind === 'profile' && profileCv
          ? { kind: 'profile', path: profileCv }
          : null;
  const [errors, setErrors] = useState<Errors>({});
  // The name and the band are on the profile: changed a tap further, not asked again.
  const [editing, setEditing] = useState(() => member && !defaultName.trim());

  /*
    What was typed, kept on the phone until it is sent (kept-draft.ts) — the
    note, the band, a corrected name or number. Never the CV: a picked file is
    the picker's, and the cache it sits in is emptied on signing out.
  */
  const kept = useKeptDraft({
    key: userId ? draftKey('apply', userId, job.id) : null,
    values: useMemo(() => ({ fullName, whatsapp, picked, note }), [fullName, whatsapp, picked, note]),
    restore: useCallback((held: { fullName: string; whatsapp: string; picked: ExperienceBand | null; note: string }) => {
      setFullName(held.fullName);
      setWhatsapp(held.whatsapp);
      setBand(held.picked);
      setNote(held.note);
      // What was kept is shown, not folded away: the notice says it was put back.
      setEditing(true);
    }, []),
  });
  const [sending, setSending] = useState(false);
  useLeaveGuard(Boolean(note.trim()) || attachment?.kind === 'file', apply.isPending || sending, kept.drop);

  // Shown to somebody who can send it: the start of the apply step of link → listing → apply.
  const started = useRef(false);
  useEffect(() => {
    if (mode === 'guest' || started.current) return;
    started.current = true;
    track('application_started', {});
  }, [mode]);

  const title = localized(locale, job.title_ar, job.title_en);
  const company = localized(locale, job.company.name_ar, job.company.name_en);

  const showErrors = (next: Errors) => {
    setErrors(next);
    if (member && (next.fullName || next.experienceBand)) setEditing(true);
    // The fields are above the button: the first wrong one is brought back into view, and said.
    inView.show(next);
  };

  const choose = async () => {
    setErrors((current) => ({ ...current, cv: undefined }));
    const file = await pickCv().catch(() => null);
    if (!file) return;
    if ('problem' in file) {
      setErrors((current) => ({ ...current, cv: t(`validation.${file.problem}`) }));
      return;
    }
    setChoice({ kind: 'file', file: file.cv });
  };

  // Apple or Google, from inside the form: the account is made on the spot and the gate held for this screen.
  const afterProvider = async (outcome: ProviderOutcome) => {
    if (outcome.ok) {
      setErrors({});
      // Who the account is, read before the form asks for the rest.
      await fetchViewer(queryClient).catch(() => null);
      return;
    }
    release.current?.();
    release.current = null;
    if (!outcome.cancelled) showErrors({ account: errorText(outcome.error) });
  };
  const onProviderBusy = (busy: boolean) => {
    setSigningUp(busy);
    if (busy && !release.current) release.current = holdOnboarding();
  };
  const continueWithEmail = () => {
    router.push({
      pathname: '/sign-up',
      params: { role: 'candidate', next: `/jobs/${job.slug}/apply`, ...(email.trim() ? { email: email.trim() } : {}) },
    });
  };

  function local(): Errors {
    const found: Errors = {};
    if (mode === 'guest') {
      found.account = t('app.apply.guestNeedsAccount');
      return found;
    }
    if (fullName.trim().length < 2) found.fullName = t('validation.required');
    if (!isValidPhone(normalisePhone(whatsapp))) found.whatsapp = t('validation.invalidPhone');
    if (!band) found.experienceBand = t('validation.required');
    if (mode === 'newAccount') {
      if (!visibility) found.visibility = t('onboarding.visibilityRequired');
      if (!agreed) found.terms = t('onboarding.consentRequired');
    }
    return found;
  }

  /** The profile a new account needs before it can apply — the website's onboarding action, with what this form asked. */
  async function makeProfile(): Promise<boolean> {
    const result = await callAction('completeOnboarding', {
      role: 'candidate',
      fullName,
      whatsapp,
      locale,
      agreed: true,
      attribution: { inApp: true },
      visibility: visibility ?? undefined,
    }).catch(() => null);
    if (!result || !result.ok) {
      const fields = result && !result.ok ? result.fieldErrors : undefined;
      showErrors({
        ...(fields?.fullName ? { fullName: t('validation.required') } : {}),
        ...(fields?.whatsapp ? { whatsapp: t('validation.invalidPhone') } : {}),
        ...(fields?.visibility ? { visibility: t('onboarding.visibilityRequired') } : {}),
        ...(fields?.agreed ? { terms: t('onboarding.consentRequired') } : {}),
        ...(!fields || !Object.keys(fields).length ? { form: t('common.errorBody') } : {}),
      });
      return false;
    }
    track('candidate_onboarding_completed', {});
    await fetchViewer(queryClient).catch(() => null);
    return true;
  }

  const submit = async () => {
    const found = local();
    if (Object.keys(found).length) {
      showErrors(found);
      return;
    }
    setErrors({});
    const newAccount = mode === 'newAccount';
    if (newAccount) {
      setSending(true);
      const made = await makeProfile();
      setSending(false);
      if (!made) return;
    }
    apply.mutate(
      {
        input: { jobId: job.id, fullName: fullName.trim(), whatsapp, experienceBand: band as ExperienceBand, note: note.trim() || null },
        attachment,
      },
      {
        onSuccess: () => {
          kept.clear();
          release.current?.();
          release.current = null;
          track('application_completed', {});
          onSent(newAccount, false);
        },
        onError: (failure) => {
          // The account was made; the application was not. From here it is any candidate's form.
          if (newAccount) {
            release.current?.();
            release.current = null;
          }
          // No connection at all: kept on the phone and sent when there is one (v1.1, queue.ts).
          if (userId && offlineFailure(failure)) {
            applyQueue.add(userId, {
              jobId: job.id,
              slug: job.slug,
              titleAr: job.title_ar,
              titleEn: job.title_en,
              input: { jobId: job.id, fullName: fullName.trim(), whatsapp, experienceBand: band as ExperienceBand, note: note.trim() || null },
              attachment,
              queuedAt: new Date().toISOString(),
            });
            kept.clear();
            release.current?.();
            release.current = null;
            onSent(newAccount, true);
            return;
          }
          const reason = failure instanceof ApplyRefused ? failure.reason : 'failed';
          // Nothing this form holds can be sent to this listing now, so nothing is kept of it.
          if (reason === 'already_applied' || reason === 'not_open' || reason === 'company_paused') kept.clear();
          if (reason === 'already_applied') return showErrors({ form: t('apply.alreadyApplied') });
          if (reason === 'rate_limit') return showErrors({ form: t('apply.rateLimit') });
          if (reason === 'not_open') return showErrors({ form: t('apply.notOpen') });
          // The company paused hiring while the form was open (migration 378).
          if (reason === 'company_paused') return showErrors({ form: t('apply.companyPaused') });
          if (reason === 'fileTooLarge' || reason === 'fileType') return showErrors({ cv: t(`validation.${reason}`) });
          if (reason === 'upload' || reason === 'invalid_cv_path') {
            // What went wrong underneath is for the crash report; the reader is told what to do.
            noteFailure('apply.cv', failure);
            return showErrors({ cv: t('app.apply.cvUploadFailed') });
          }
          const fields = failure instanceof ApplyRefused ? failure.fieldErrors : undefined;
          if (reason === 'invalid' && fields && Object.keys(fields).length) {
            return showErrors({
              ...(fields.fullName ? { fullName: t('validation.required') } : {}),
              ...(fields.whatsapp ? { whatsapp: t('validation.invalidPhone') } : {}),
              ...(fields.experienceBand ? { experienceBand: t('validation.required') } : {}),
              ...(fields.cv ? { cv: t('validation.fileType') } : {}),
              ...(fields.note || fields.jobId ? { form: t('common.errorBody') } : {}),
            });
          }
          // What went wrong underneath goes to the crash report, not on the screen.
          if (!(failure instanceof ApiError)) noteFailure('apply', failure);
          // The website failing is said as its own, with what was typed still here (v1.1).
          showErrors({ form: failure instanceof ApiError && failure.status >= 500 ? t('app.apply.serverFailed') : t('common.errorBody') });
        },
      },
    );
  };

  const busy = apply.isPending || sending || signingUp;
  const sendButton = (
    <Button
      label={t('apply.submit')}
      size="lg"
      // Not sent before the profile's years are read: the band shown is the one sent.
      loading={apply.isPending || sending || (member && agentProfile.isPending)}
      disabled={signingUp}
      onPress={() => void submit()}
    />
  );

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        ref={scroll}
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        contentContainerStyle={{ padding: gutter, paddingBottom: space[10], gap: space[5] }}
      >
        <DraftNotice draft={kept} />
        <View style={{ gap: space[0.5] }}>
          <Text variant="title" weight="bold" accessibilityRole="header">
            {t('apply.title', { job: title })}
          </Text>
          <Text variant="small" tone="mutedForeground">
            {`${company} · ${t('apply.subtitle')}`}
          </Text>
        </View>

        {mode === 'guest' ? (
          <Card style={{ gap: space[4] }}>
            <View ref={inView.place('account')}>
              <Text weight="semibold" accessibilityRole="header">
                {t('app.apply.guestTitle')}
              </Text>
            </View>
            <SocialSignIn mode="sign-up" disabled={busy} onBusy={onProviderBusy} onOutcome={afterProvider} />
            <Field label={t('app.apply.guestEmail')}>
              <TextField
                value={email}
                onChangeText={setEmail}
                accessibilityLabel={t('app.apply.guestEmail')}
                ltr
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="emailAddress"
                returnKeyType="go"
                onSubmitEditing={continueWithEmail}
              />
            </Field>
            <Button label={t('app.apply.guestEmailContinue')} variant="outline" disabled={busy} onPress={continueWithEmail} />
            {errors.account ? (
              <Text variant="small" tone="destructive" accessibilityRole="alert">
                {errors.account}
              </Text>
            ) : null}
            <Text variant="caption" tone="mutedForeground">
              {`${t('app.apply.guestHint')} `}
              <Text
                variant="caption"
                weight="semibold"
                tone="primary"
                accessibilityRole="link"
                onPress={() => router.push({ pathname: '/sign-in', params: { next: `/jobs/${job.slug}/apply` } })}
                suppressHighlighting
              >
                {`${t('app.apply.guestHasAccount')} ${t('nav.signIn')}`}
              </Text>
            </Text>
          </Card>
        ) : null}

        {mode === 'newAccount' ? (
          <Notice tone="muted" title={t('app.apply.newAccountTitle')}>
            {t('app.apply.newAccountBody')}
          </Notice>
        ) : null}

        {member && !editing ? (
          <ProfileSummary name={fullName.trim()} band={band} onEdit={() => setEditing(true)} />
        ) : null}

        {mode === 'newAccount' || editing ? (
          <>
            <Field ref={inView.place('fullName')} label={t('apply.fullName')} error={errors.fullName}>
              <TextField
                value={fullName}
                onChangeText={setFullName}
                accessibilityLabel={t('apply.fullName')}
                autoComplete="name"
                textContentType="name"
                maxLength={120}
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => whatsappField.current?.focus()}
              />
            </Field>
            <Field ref={inView.place('experienceBand')} label={t('apply.experienceBand')} error={errors.experienceBand}>
              <Select
                label={t('apply.experienceBand')}
                value={band}
                placeholder={t('app.onboarding.choose')}
                options={EXPERIENCE_BANDS.map((value) => ({ value, label: t(`experienceBand.${value}`) }))}
                onChange={setBand}
              />
            </Field>
          </>
        ) : null}

        <Field ref={inView.place('cv')} label={t('apply.cv')} error={errors.cv}>
          <View style={{ gap: space[2] }} accessibilityRole="radiogroup" accessibilityLabel={t('apply.cv')}>
            {lastCv ? (
              <CvOption
                selected={chosen.kind === 'last'}
                onPress={() => setChoice({ kind: 'last' })}
                title={t('app.apply.lastCv', { job: localized(locale, lastCv.jobTitleAr, lastCv.jobTitleEn) || title })}
                hint={`${t('app.apply.lastUsed')} · ${formatDate(lastCv.sentAt, locale)}`}
              />
            ) : null}
            {profileCv && profileCv !== lastCv?.path ? (
              <CvOption selected={chosen.kind === 'profile'} onPress={() => setChoice({ kind: 'profile' })} title={t('app.apply.profileCv')} />
            ) : null}
            {chosen.kind === 'file' ? <CvOption selected onPress={() => {}} title={chosen.file.name} file /> : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={chosen.kind === 'file' ? t('app.apply.pickAnother') : t('app.apply.uploadNew')}
              accessibilityHint={t.markup('app.apply.uploadHint', markupTags)}
              onPress={choose}
              disabled={busy}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: space[3],
                minHeight: hitTarget + space[2],
                paddingHorizontal: space[4],
                ...corner('lg'),
                borderWidth: 1,
                borderStyle: 'dashed',
                borderColor: colors.input,
                backgroundColor: pressed ? colors.muted : 'transparent',
              })}
            >
              <Paperclip size={18} color={colors.mutedForeground} />
              <View style={{ flex: 1, paddingVertical: space[2] }}>
                <Text variant="small" weight="medium">
                  {chosen.kind === 'file' ? t('app.apply.pickAnother') : t('app.apply.uploadNew')}
                </Text>
                <Text variant="caption" tone="mutedForeground">
                  {t.markup('app.apply.uploadHint', markupTags)}
                </Text>
              </View>
            </Pressable>
            {attachment ? (
              <Button label={t('app.apply.noCv')} variant="ghost" size="sm" onPress={() => setChoice({ kind: 'none' })} />
            ) : null}
          </View>
        </Field>

        <Field label={t('apply.note')} hint={t('apply.noteOptional')}>
          <TextField
            value={note}
            onChangeText={setNote}
            accessibilityLabel={t('apply.note')}
            multiline
            maxLength={NOTE_MAX}
            style={{ minHeight: 88, paddingVertical: space[2], textAlignVertical: 'top' }}
          />
          <Num
            variant="caption"
            tone="mutedForeground"
            value={t.markup('app.apply.noteCount', { count: formatNumber(note.length, locale), max: formatNumber(NOTE_MAX, locale), b: (chunks) => chunks, v: (chunks) => chunks })}
          />
        </Field>

        {mode === 'guest' ? null : (
          <Field ref={inView.place('whatsapp')} label={t('apply.whatsapp')} error={errors.whatsapp}>
            <TextField
              ref={whatsappField}
              value={whatsapp}
              onChangeText={setWhatsapp}
              accessibilityLabel={t('apply.whatsapp')}
              ltr
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
            />
          </Field>
        )}

        {/* Who sees a new consultant's directory card: asked, with nothing chosen for them (migration 336). */}
        {mode === 'newAccount' ? (
          <View style={{ gap: space[2] }}>
            <Text weight="semibold">{t('onboarding.visibilityQuestion')}</Text>
            <View ref={inView.place('visibility')} style={{ gap: space[2] }} accessibilityRole="radiogroup" accessibilityLabel={t('onboarding.visibilityQuestion')}>
              {(
                [
                  ['public', 'publicHint', Eye],
                  ['verified_employers_only', 'verifiedHint', BadgeCheck],
                  ['hidden', 'hiddenHint', EyeOff],
                ] as const
              ).map(([value, hint, Icon]) => (
                <ChoiceCard key={value} selected={visibility === value} onPress={() => setVisibility(value)} icon={Icon} title={t(`visibility.${value}`)} hint={t(`visibility.${hint}`)} />
              ))}
            </View>
            {errors.visibility ? (
              <Text variant="caption" tone="destructive" accessibilityRole="alert">
                {errors.visibility}
              </Text>
            ) : null}
          </View>
        ) : null}
        {mode === 'newAccount' ? <ConsentCheck ref={inView.place('terms')} agreed={agreed} onChange={setAgreed} error={errors.terms} /> : null}

        <View style={{ flexDirection: 'row', gap: space[2], alignItems: 'flex-start' }}>
          <ShieldCheck size={16} color={colors.mutedForeground} style={{ marginTop: 3 }} />
          <Text variant="small" tone="mutedForeground" style={{ flex: 1 }}>
            {t('app.apply.sharedWith', { company })}
          </Text>
        </View>
        <WhoSees />

        {errors.form ? <Notice tone="destructive" announce={false}>{errors.form}</Notice> : null}
        {large ? sendButton : null}
      </ScrollView>
      {/* The way to send it, held at the foot of the screen (v1.1); in the flow at the largest text sizes. */}
      {large ? null : (
        <View
          style={{
            paddingHorizontal: gutter,
            paddingTop: space[3],
            paddingBottom: Math.max(insets.bottom, space[3]),
            gap: space[1.5],
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: colors.border,
            backgroundColor: colors.card,
          }}
        >
          {sendButton}
        </View>
      )}
    </View>
  );
}

/** The candidate as the application will name them, with the way to change it. */
function ProfileSummary({ name, band, onEdit }: { name: string; band: ExperienceBand; onEdit: () => void }) {
  const t = useTranslations();
  const { viewer } = useSession();
  const districts = useDistricts();
  const locale = useLocale();
  const agent = useAgentProfile().data?.agent ?? null;
  const track = agent?.tracks?.[0];
  const district = districts.data?.find((row) => row.id === agent?.district_ids?.[0]);
  // What the profile says, in one line: the track, the years, the place.
  const full = [track ? t(`track.${track}`) : null, t(`experienceBand.${band}`), district ? localized(locale, district.name_ar, district.name_en) : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
      <Avatar name={name} src={viewer?.profile?.avatar_url ?? null} size="md" />
      <View style={{ flex: 1 }}>
        <Text weight="semibold">{name}</Text>
        {full ? (
          <Text variant="caption" tone="mutedForeground">
            {full}
          </Text>
        ) : null}
      </View>
      <Pressable accessibilityRole="button" onPress={onEdit} hitSlop={8} style={{ minHeight: hitTarget, justifyContent: 'center' }}>
        <Text variant="small" weight="medium" tone="primary">
          {t('app.apply.editProfile')}
        </Text>
      </Pressable>
    </Card>
  );
}

/** One CV to send, as a radio: the one last used, the profile's, or a file just picked. */
function CvOption({ selected, onPress, title, hint, file = false }: { selected: boolean; onPress: () => void; title: string; hint?: string; file?: boolean }) {
  const { colors } = useTheme();
  const large = useLargeText();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={hint ? `${title}. ${hint}` : title}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        minHeight: hitTarget + space[2],
        paddingHorizontal: space[4],
        paddingVertical: space[2],
        ...corner('lg'),
        borderWidth: selected ? 1.5 : 1,
        borderColor: selected ? colors.primary : colors.border,
        backgroundColor: colors.card,
      }}
    >
      {file ? <Paperclip size={18} color={colors.primary} /> : <FileText size={18} color={colors.primary} />}
      <View style={{ flex: 1 }}>
        <Text variant="small" weight="medium" numberOfLines={large ? undefined : 1}>
          {title}
        </Text>
        {hint ? (
          <Text variant="caption" tone="mutedForeground">
            {hint}
          </Text>
        ) : null}
      </View>
      <View
        style={{
          width: 20,
          height: 20,
          borderRadius: 10,
          borderWidth: selected ? 6 : 1.5,
          borderColor: selected ? colors.primary : colors.input,
        }}
      />
    </Pressable>
  );
}

/**
 * What pressing the button gives away, said before it is pressed: the
 * question always in view above the button, its answer a tap away, so the
 * form is not a wall of text on the way to it.
 */
function WhoSees() {
  const t = useTranslations();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronUp : ChevronDown;

  return (
    <View
      style={{
        ...corner('xl'),
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: colors.border,
        backgroundColor: colors.muted,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={{ minHeight: hitTarget, flexDirection: 'row', alignItems: 'center', gap: space[3], padding: space[4] }}
      >
        <ShieldCheck size={20} color={colors.mutedForeground} />
        <Text variant="small" weight="semibold" style={{ flex: 1 }}>
          {t('apply.privacyTitle')}
        </Text>
        <Chevron size={18} color={colors.mutedForeground} />
      </Pressable>
      {open ? (
        // Under the question, where its words start: past the shield.
        <View style={{ gap: space[1], paddingBottom: space[4], paddingStart: space[4] + 20 + space[3], paddingEnd: space[4] }}>
          <Text variant="small" tone="mutedForeground">
            {t('apply.privacyBody')}
          </Text>
          <Text variant="small" tone="mutedForeground">
            {t('apply.privacyProfile')}
          </Text>
          <Text variant="small" tone="mutedForeground">
            {t('apply.privacyNote')}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** Written with no connection: kept on this phone, and sent as soon as there is one (queue.ts). */
function Queued({ job }: { job: JobDetail }) {
  const t = useTranslations();
  const locale = useLocale();
  const toBoard = useToBoard();
  const { colors } = useTheme();
  useAnnounce(t('app.apply.queuedTitle'));
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: gutter, paddingBottom: space[10], gap: space[6] }}>
      <View style={{ alignItems: 'center', gap: space[2], padding: space[6], ...corner('xl'), backgroundColor: colors.warningMuted }}>
        <Text variant="title" weight="semibold" accessibilityRole="header" style={{ textAlign: 'center' }}>
          {t('app.apply.queuedTitle')}
        </Text>
        <Text variant="small" tone="mutedForeground" style={{ textAlign: 'center' }}>
          {t('app.apply.queuedBody', { title: localized(locale, job.title_ar, job.title_en) })}
        </Text>
      </View>
      <Button label={t('nav.browseJobs')} variant="outline" onPress={toBoard} />
    </ScrollView>
  );
}

/** The confirmation: that it went, where to follow it, and what to look at next — and, for an account just made, the rest of onboarding. */
function Sent({ job, newAccount }: { job: JobDetail; newAccount: boolean }) {
  const toBoard = useToBoard();
  const t = useTranslations();
  const { colors } = useTheme();
  const next = useNextRoles(job.id, true);
  // Said to VoiceOver as it comes up: a live region is Android's alone.
  useAnnounce(`${t('apply.success')}. ${t('apply.successBody')}`);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: gutter, paddingBottom: space[10], gap: space[6] }}
    >
      <Appear
        accessibilityLiveRegion="polite"
        style={{
          alignItems: 'center',
          gap: space[2],
          padding: space[6],
          ...corner('xl'),
          // A soft tint of its meaning, as a Notice is, not an outline in it.
          backgroundColor: colors.successMuted,
        }}
      >
        <Appear from="none" scale={0.6} delay={motion.stagger}>
          <DrawnCheck size={72} />
        </Appear>
        <Text variant="title" weight="semibold" accessibilityRole="header" style={{ textAlign: 'center' }}>
          {t('apply.success')}
        </Text>
        <Text variant="small" tone="mutedForeground" style={{ textAlign: 'center' }}>
          {t('apply.successBody')}
        </Text>
      </Appear>

      {newAccount ? (
        <Card style={{ gap: space[3] }}>
          <View style={{ flexDirection: 'row', gap: space[3], alignItems: 'center' }}>
            <UserRound size={20} color={colors.primary} />
            <Text weight="semibold" style={{ flex: 1 }}>
              {t('app.apply.completeProfile')}
            </Text>
          </View>
          <Text variant="small" tone="mutedForeground">
            {t('app.apply.completeProfileBody')}
          </Text>
          <Button label={t('app.apply.completeProfile')} onPress={() => router.push({ pathname: '/onboarding', params: { setup: '1' } })} />
        </Card>
      ) : null}

      <View style={{ gap: space[2] }}>
        <Button label={t('apply.viewApplications')} variant={newAccount ? 'outline' : 'primary'} onPress={() => router.navigate('/dashboard/applications')} />
        <Button label={t('nav.browseJobs')} variant="outline" onPress={toBoard} />
      </View>

      {/* The moment the reason to hear back is plain: the phone's question, until answered. */}
      <PushPrompt audience="candidate" />

      {next.roles.length ? (
        <View style={{ gap: space[3] }}>
          <Text weight="semibold" accessibilityRole="header">
            {next.personalised ? t('apply.nextRolesMatched') : t('apply.nextRoles')}
          </Text>
          {next.roles.map((role) => (
            <JobCard key={role.id} job={role} />
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}
