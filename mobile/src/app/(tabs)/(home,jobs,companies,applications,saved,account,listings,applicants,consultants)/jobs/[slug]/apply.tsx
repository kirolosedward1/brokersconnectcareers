import { useRef, useState, type ComponentType } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, Stack, useLocalSearchParams, useNavigation } from 'expo-router';
import { useLocale, useTranslations } from 'use-intl';
import {
  CalendarX2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleSlash,
  Briefcase,
  FileText,
  Paperclip,
  Phone,
  type LucideProps,
  ShieldAlert,
  ShieldCheck,
  UserRound,
  X,
} from '~/components/ui/lucide';
import { formatDate } from '@/lib/format';
import type { JobDetail } from '@/lib/job-list';
import { jobIsLive } from '@/lib/job-state';
import { localized } from '@/lib/locale';
import { isApproved, isCandidate } from '@/lib/permissions';
import { isValidPhone, normalisePhone } from '@/lib/phone';
import { bandFor } from '@/lib/match';
import type { ExperienceBand } from '@/lib/supabase/database.types';
import { EXPERIENCE_BANDS } from '@/lib/taxonomy';
import { JobCard } from '~/components/jobs/job-card';
import { Button } from '~/components/ui/button';
import { Appear } from '~/components/motion/appear';
import { Confetti, DrawnCheck } from '~/components/motion/celebration';
import { Card } from '~/components/ui/card';
import { Field } from '~/components/ui/field';
import { Notice } from '~/components/ui/notice';
import { Select } from '~/components/ui/select';
import { ViewerPending } from '~/components/navigation/viewer-pending';
import { EmptyState, ErrorState, LoadingState, NotFoundState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { TextField } from '~/components/ui/text-field';
import {
  ApplyRefused,
  useApplyContext,
  useApplyToJob,
  useNextRoles,
  type Attachment,
} from '~/features/apply/apply';
import { pickCv, type PickedCv } from '~/features/cv/files';
import { useJob } from '~/features/jobs/queries';
import { useAgentProfile } from '~/features/profile/queries';
import { ApiError } from '~/lib/api';
import { haptic } from '~/lib/haptics';
import { useSession } from '~/lib/session';
import { useErrorsInView } from '~/lib/use-errors-in-view';
import { useLeaveGuard } from '~/lib/use-leave-guard';
import { useHasBoard } from '~/lib/use-tabs';
import { useTheme } from '~/theme/provider';
import { corner, gutter, hitTarget, motion, space } from '~/theme/tokens';

/**
 * Applying to a listing — the website's /jobs/<slug>/apply, at the same path
 * so a sign-in that began with "apply" comes back here.
 *
 * The page decides which of its states somebody gets, in the website's
 * order: a closed listing; nobody signed in; an account that is not a
 * candidate's; a candidate the database would refuse (held or suspended —
 * said in words rather than met with an error after typing a note); an
 * application already made (read, never guessed); and otherwise the form.
 * Once it is sent, the confirmation says what, where and when, and offers two
 * more roles while the candidate is in the mood.
 */
export default function ApplyScreen() {
  const { slug: raw } = useLocalSearchParams<{ slug: string }>();
  const slug = typeof raw === 'string' ? raw.toLowerCase() : '';
  const t = useTranslations();
  const job = useJob(slug);

  const header = <Stack.Screen options={{ title: t('apply.submit') }} />;

  if (job.isPending) {
    return (
      <>
        {header}
        <LoadingState />
      </>
    );
  }
  // A failed re-read in the background must not take the form away: only a
  // first read that failed is an error page (TanStack keeps the data beside the error).
  if (job.isError && !job.data) {
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
      <Apply job={job.data.job} />
    </>
  );
}

function Apply({ job }: { job: JobDetail }) {
  const t = useTranslations();
  const locale = useLocale();
  const { session, viewer, actor } = useSession();
  const context = useApplyContext(isCandidate(actor) ? job.id : null);
  const hasBoard = useHasBoard();
  const navigation = useNavigation();
  const [sentAt, setSentAt] = useState<Date | null>(null);

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

  if (sentAt) return <Sent job={job} at={sentAt} />;

  if (!jobIsLive(job)) {
    return (
      <EmptyState
        icon={CalendarX2}
        title={t('jobs.expired')}
        body={t('jobs.expiredBody')}
        action={hasBoard ? <Button label={t('jobs.title')} onPress={() => router.navigate('/jobs')} /> : null}
      />
    );
  }

  if (!session) {
    return (
      <EmptyState
        icon={UserRound}
        title={t('app.account.signedOutTitle')}
        body={t('app.account.signedOutBody')}
        action={
          <Button
            label={t('nav.signIn')}
            onPress={() => router.push({ pathname: '/sign-in', params: { next: `/jobs/${job.slug}/apply` } })}
          />
        }
      />
    );
  }

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

  return (
    <ApplyForm
      job={job}
      defaultName={viewer.profile.full_name}
      defaultPhone={viewer.profile.whatsapp_phone}
      profileCv={context.data.profileCv}
      onSent={() => {
        haptic.success();
        setSentAt(new Date());
      }}
    />
  );
}

type Errors = Partial<Record<'fullName' | 'whatsapp' | 'experienceBand' | 'cv' | 'form', string>>;

function ApplyForm({
  job,
  defaultName,
  defaultPhone,
  profileCv,
  onSent,
}: {
  job: JobDetail;
  defaultName: string;
  defaultPhone: string;
  profileCv: string | null;
  onSent: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const apply = useApplyToJob();
  const scroll = useRef<ScrollView>(null);
  const inView = useErrorsInView(scroll, ['fullName', 'whatsapp', 'experienceBand', 'cv']);

  const [fullName, setFullName] = useState(defaultName);
  const [whatsapp, setWhatsapp] = useState(defaultPhone);
  // The band the profile's years put them in, until they pick another.
  const years = useAgentProfile().data?.agent?.years_experience;
  const [picked, setBand] = useState<ExperienceBand | null>(null);
  const band = picked ?? (years != null ? bandFor(years) : 'junior_1_3');
  const [note, setNote] = useState('');
  // The CV on the profile goes with it unless the candidate says otherwise —
  // the one on the profile as it is now: replaced or taken off in another tab
  // while this was open, the form follows it, and never sends a path the
  // profile has let go of.
  const [choice, setChoice] = useState<{ kind: 'profile' } | { kind: 'none' } | { kind: 'file'; file: PickedCv }>({ kind: 'profile' });
  const attachment: Attachment =
    choice.kind === 'file' ? choice : choice.kind === 'profile' && profileCv ? { kind: 'profile', path: profileCv } : null;
  const [errors, setErrors] = useState<Errors>({});
  // Everything the form needs is already known (the profile's name, WhatsApp
  // and CV): it is one look and one tap, the fields a tap further for changes.
  const [editing, setEditing] = useState(() => !defaultName.trim() || !isValidPhone(normalisePhone(defaultPhone)));
  // Leaving with a note written or a file picked asks first (the form goes once
  // it is sent); while it is being sent, the screen waits for the answer.
  useLeaveGuard(Boolean(note.trim()) || attachment?.kind === 'file', apply.isPending);

  const title = localized(locale, job.title_ar, job.title_en);
  const company = localized(locale, job.company.name_ar, job.company.name_en);

  const showErrors = (next: Errors) => {
    setErrors(next);
    // A field to put right is shown, not summed up.
    if (next.fullName || next.whatsapp || next.experienceBand || next.cv) setEditing(true);
    // The fields are above the button: the first wrong one is brought back into view, and said.
    inView.show(next);
  };

  const choose = async () => {
    setErrors((current) => ({ ...current, cv: undefined }));
    const picked = await pickCv().catch(() => null);
    if (!picked) return;
    if ('problem' in picked) {
      setErrors((current) => ({ ...current, cv: t(`validation.${picked.problem}`) }));
      return;
    }
    setChoice({ kind: 'file', file: picked.cv });
  };

  const submit = () => {
    const local: Errors = {};
    if (!fullName.trim()) local.fullName = t('validation.required');
    if (!isValidPhone(normalisePhone(whatsapp))) local.whatsapp = t('validation.invalidPhone');
    if (!band) local.experienceBand = t('validation.required');
    if (Object.keys(local).length) {
      showErrors(local);
      return;
    }

    setErrors({});
    apply.mutate(
      {
        input: { jobId: job.id, fullName: fullName.trim(), whatsapp, experienceBand: band as ExperienceBand, note: note.trim() || null },
        attachment,
      },
      {
        onSuccess: onSent,
        onError: (failure) => {
          const reason = failure instanceof ApplyRefused ? failure.reason : 'failed';
          if (reason === 'already_applied') return showErrors({ form: t('apply.alreadyApplied') });
          if (reason === 'rate_limit') return showErrors({ form: t('apply.rateLimit') });
          if (reason === 'fileTooLarge' || reason === 'fileType') return showErrors({ cv: t(`validation.${reason}`) });
          if (reason === 'upload' || reason === 'invalid_cv_path') return showErrors({ cv: t('common.errorBody') });
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
          showErrors({ form: t('common.errorBody') });
        },
      },
    );
  };

  return (
    <ScrollView
      ref={scroll}
      contentInsetAdjustmentBehavior="automatic"
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      contentContainerStyle={{ padding: gutter, paddingBottom: space[10], gap: space[5] }}
    >
      <View style={{ gap: space[1] }}>
        <Text variant="title" weight="bold" accessibilityRole="header">
          {t('apply.title', { job: title })}
        </Text>
        <Text variant="small" tone="mutedForeground">
          {`${company} · ${t('apply.subtitle')}`}
        </Text>
      </View>

      {editing ? null : (
        <QuickApply
          rows={[
            { icon: UserRound, value: fullName.trim() },
            { icon: Phone, value: normalisePhone(whatsapp), ltr: true },
            { icon: Briefcase, value: t(`experienceBand.${band}`) },
            { icon: FileText, value: attachment ? t('app.apply.profileCv') : t('app.apply.quickNoCv') },
          ]}
          sending={apply.isPending}
          onSend={submit}
          onEdit={() => setEditing(true)}
        />
      )}

      {editing ? (
        <>
          <Field ref={inView.place('fullName')} label={t('apply.fullName')} error={errors.fullName}>
            <TextField
              value={fullName}
              onChangeText={setFullName}
              accessibilityLabel={t('apply.fullName')}
              autoComplete="name"
              textContentType="name"
              maxLength={120}
            />
          </Field>

          <Field ref={inView.place('whatsapp')} label={t('apply.whatsapp')} error={errors.whatsapp}>
            <TextField
              value={whatsapp}
              onChangeText={setWhatsapp}
              accessibilityLabel={t('apply.whatsapp')}
              ltr
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
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

          <Field ref={inView.place('cv')} label={t('apply.cv')} hint={t('apply.cvOptional')} error={errors.cv}>
            {attachment ? (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space[2],
                  paddingStart: space[3],
                  ...corner('lg'),
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: colors.card,
                }}
              >
                {attachment.kind === 'profile' ? (
                  <FileText size={16} color={colors.mutedForeground} />
                ) : (
                  <Paperclip size={16} color={colors.mutedForeground} />
                )}
                <Text variant="small" numberOfLines={1} style={{ flex: 1 }}>
                  {attachment.kind === 'profile' ? t('app.apply.profileCv') : attachment.file.name}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('app.apply.removeCv')}
                  onPress={() => setChoice({ kind: 'none' })}
                  style={{ width: hitTarget, height: hitTarget, alignItems: 'center', justifyContent: 'center' }}
                >
                  <X size={16} color={colors.mutedForeground} />
                </Pressable>
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
              <Button
                label={attachment?.kind === 'file' ? t('app.apply.pickAnother') : t('app.apply.pickCv')}
                variant="outline"
                size="sm"
                icon={<Paperclip size={14} color={colors.foreground} />}
                onPress={choose}
              />
              {profileCv && attachment?.kind !== 'profile' ? (
                <Button
                  label={t('app.apply.useProfileCv')}
                  variant="ghost"
                  size="sm"
                  onPress={() => setChoice({ kind: 'profile' })}
                />
              ) : null}
            </View>
          </Field>

          <Field label={t('apply.note')} hint={t('apply.noteOptional')}>
            <TextField
              value={note}
              onChangeText={setNote}
              accessibilityLabel={t('apply.note')}
              multiline
              maxLength={500}
              style={{ minHeight: 88, paddingVertical: space[2], textAlignVertical: 'top' }}
            />
          </Field>
        </>
      ) : null}

      <WhoSees />

      {errors.form ? <Notice tone="destructive">{errors.form}</Notice> : null}

      {editing ? <Button label={t('apply.submit')} size="lg" loading={apply.isPending} onPress={submit} /> : null}
    </ScrollView>
  );
}

/**
 * The application as it would go, in one card — who, the WhatsApp the
 * company will write to, the experience, the CV — with one button to send it
 * and one to change it first.
 */
function QuickApply({
  rows,
  sending,
  onSend,
  onEdit,
}: {
  rows: { icon: ComponentType<LucideProps>; value: string; ltr?: boolean }[];
  sending: boolean;
  onSend: () => void;
  onEdit: () => void;
}) {
  const t = useTranslations();
  const { colors } = useTheme();
  return (
    <Card style={{ gap: space[4] }}>
      <Text weight="semibold" accessibilityRole="header">
        {t('app.apply.quickTitle')}
      </Text>
      <View style={{ gap: space[3] }}>
        {rows.map(({ icon: Icon, value, ltr }) => (
          <View key={value} style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
            <View style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center', ...corner('full'), backgroundColor: colors.secondary }}>
              <Icon size={16} color={colors.primary} />
            </View>
            <Text weight="medium" numberOfLines={1} style={{ flex: 1, ...(ltr ? { writingDirection: 'ltr' as const } : null) }}>
              {ltr ? `\u2066${value}\u2069` : value}
            </Text>
          </View>
        ))}
      </View>
      <View style={{ gap: space[2] }}>
        <Button label={t('app.apply.quickSend')} size="lg" loading={sending} onPress={onSend} />
        <Button label={t('app.apply.quickEdit')} variant="ghost" onPress={onEdit} />
      </View>
    </Card>
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

/** The confirmation: what, where and when, where to follow it, and what to look at next. */
function Sent({ job, at }: { job: JobDetail; at: Date }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const next = useNextRoles(job.id, true);

  const rows: [string, string][] = [
    [t('apply.labelJob'), localized(locale, job.title_ar, job.title_en)],
    [t('apply.labelCompany'), localized(locale, job.company.name_ar, job.company.name_en)],
    [t('apply.labelDate'), formatDate(at, locale)],
  ];

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
        <Confetti />
        <Text variant="title" weight="bold" accessibilityRole="header" style={{ textAlign: 'center' }}>
          {t('apply.success')}
        </Text>
        <Text variant="small" tone="mutedForeground" style={{ textAlign: 'center' }}>
          {t('apply.successBody')}
        </Text>
      </Appear>

      {/* Read from the right as Arabic is: the labels a column at the start,
          each value beside its own, starting where the others do — not
          pushed to the far edge, where it read as a left-to-right table. */}
      <Card style={{ padding: 0 }}>
        {rows.map(([label, value], index) => (
          <View
            key={label}
            style={{
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: space[4],
              padding: space[4],
              borderTopWidth: index ? StyleSheet.hairlineWidth * 2 : 0,
              borderTopColor: colors.border,
            }}
          >
            <Text variant="small" tone="mutedForeground" style={{ width: 112 }}>
              {label}
            </Text>
            <Text variant="small" weight="medium" style={{ flex: 1 }}>
              {value}
            </Text>
          </View>
        ))}
      </Card>

      <View style={{ gap: space[2] }}>
        <Button label={t('apply.viewApplications')} onPress={() => router.navigate('/dashboard/applications')} />
        <Button label={t('jobs.title')} variant="outline" onPress={() => router.navigate('/jobs')} />
      </View>

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
