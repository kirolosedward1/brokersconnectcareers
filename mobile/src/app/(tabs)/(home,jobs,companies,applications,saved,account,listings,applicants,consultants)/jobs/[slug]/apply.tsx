import { useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router, Stack, useLocalSearchParams, useNavigation } from 'expo-router';
import { useLocale, useTranslations } from 'use-intl';
import { CheckCircle2, FileText, Paperclip, ShieldCheck, X } from 'lucide-react-native';
import { formatDate } from '@/lib/format';
import type { JobDetail } from '@/lib/job-list';
import { jobIsLive } from '@/lib/job-state';
import { localized } from '@/lib/locale';
import { isApproved, isCandidate } from '@/lib/permissions';
import { isValidPhone, normalisePhone } from '@/lib/phone';
import type { ExperienceBand } from '@/lib/supabase/database.types';
import { EXPERIENCE_BANDS } from '@/lib/taxonomy';
import { JobCard } from '~/components/jobs/job-card';
import { Button } from '~/components/ui/button';
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
import { pickCv } from '~/features/cv/files';
import { useJob } from '~/features/jobs/queries';
import { ApiError } from '~/lib/api';
import { useSession } from '~/lib/session';
import { useLeaveGuard } from '~/lib/use-leave-guard';
import { useHasBoard } from '~/lib/use-tabs';
import { useTheme } from '~/theme/provider';
import { hitTarget, radius, space } from '~/theme/tokens';

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
        title={t('jobs.expired')}
        body={t('jobs.expiredBody')}
        action={hasBoard ? <Button label={t('jobs.title')} onPress={() => router.navigate('/jobs')} /> : null}
      />
    );
  }

  if (!session) {
    return (
      <EmptyState
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
        title={t('apply.employerCannotApply')}
        action={<Button label={title} variant="outline" onPress={toListing} />}
      />
    );
  }

  // The insert policy asks for an approved candidate: a held or suspended one is told why, before typing.
  if (!isApproved(actor)) {
    return (
      <EmptyState
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
      onSent={() => setSentAt(new Date())}
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

  const [fullName, setFullName] = useState(defaultName);
  const [whatsapp, setWhatsapp] = useState(defaultPhone);
  const [band, setBand] = useState<ExperienceBand | null>('junior_1_3');
  const [note, setNote] = useState('');
  // The CV already on the profile goes with it unless the candidate says otherwise.
  const [attachment, setAttachment] = useState<Attachment>(profileCv ? { kind: 'profile', path: profileCv } : null);
  const [errors, setErrors] = useState<Errors>({});
  // Leaving with a note written or a file picked asks first (the form goes once it is sent).
  useLeaveGuard(Boolean(note.trim()) || attachment?.kind === 'file');

  const title = localized(locale, job.title_ar, job.title_en);
  const company = localized(locale, job.company.name_ar, job.company.name_en);

  const showErrors = (next: Errors) => {
    setErrors(next);
    // The fields are above the button: bring them back into view.
    scroll.current?.scrollTo({ y: 0, animated: true });
  };

  const choose = async () => {
    setErrors((current) => ({ ...current, cv: undefined }));
    const picked = await pickCv().catch(() => null);
    if (!picked) return;
    if ('problem' in picked) {
      setErrors((current) => ({ ...current, cv: t(`validation.${picked.problem}`) }));
      return;
    }
    setAttachment({ kind: 'file', file: picked.cv });
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
          if (reason === 'already_applied') return setErrors({ form: t('apply.alreadyApplied') });
          if (reason === 'rate_limit') return setErrors({ form: t('apply.rateLimit') });
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
          setErrors({ form: t('common.errorBody') });
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
      contentContainerStyle={{ padding: space[4], paddingBottom: space[10], gap: space[5] }}
    >
      <View style={{ gap: space[1] }}>
        <Text variant="title" weight="bold" accessibilityRole="header">
          {t('apply.title', { job: title })}
        </Text>
        <Text variant="small" tone="mutedForeground">
          {`${company} · ${t('apply.subtitle')}`}
        </Text>
      </View>

      <Field label={t('apply.fullName')} error={errors.fullName}>
        <TextField
          value={fullName}
          onChangeText={setFullName}
          accessibilityLabel={t('apply.fullName')}
          autoComplete="name"
          textContentType="name"
          maxLength={120}
        />
      </Field>

      <Field label={t('apply.whatsapp')} error={errors.whatsapp}>
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

      <Field label={t('apply.experienceBand')} error={errors.experienceBand}>
        <Select
          label={t('apply.experienceBand')}
          value={band}
          placeholder={t('app.onboarding.choose')}
          options={EXPERIENCE_BANDS.map((value) => ({ value, label: t(`experienceBand.${value}`) }))}
          onChange={setBand}
        />
      </Field>

      <Field label={t('apply.cv')} hint={t('apply.cvOptional')} error={errors.cv}>
        {attachment ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space[2],
              paddingStart: space[3],
              borderRadius: radius.lg,
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
              onPress={() => setAttachment(null)}
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
              onPress={() => setAttachment({ kind: 'profile', path: profileCv })}
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

      {/* What pressing the button gives away, said before it is pressed. */}
      <View
        style={{
          flexDirection: 'row',
          gap: space[3],
          padding: space[4],
          borderRadius: radius.xl,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.muted,
        }}
      >
        <ShieldCheck size={20} color={colors.mutedForeground} />
        <View style={{ flex: 1, gap: space[1] }}>
          <Text variant="small" weight="semibold">
            {t('apply.privacyTitle')}
          </Text>
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
      </View>

      {errors.form ? <Notice tone="destructive">{errors.form}</Notice> : null}

      <Button label={t('apply.submit')} size="lg" loading={apply.isPending} onPress={submit} />
    </ScrollView>
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
      contentContainerStyle={{ padding: space[4], paddingBottom: space[10], gap: space[6] }}
    >
      <View
        accessibilityLiveRegion="polite"
        style={{
          alignItems: 'center',
          gap: space[2],
          padding: space[6],
          borderRadius: radius.xl,
          borderWidth: 1,
          borderColor: colors.success,
          backgroundColor: colors.successMuted,
        }}
      >
        <CheckCircle2 size={36} color={colors.success} />
        <Text variant="title" weight="bold" accessibilityRole="header" style={{ textAlign: 'center' }}>
          {t('apply.success')}
        </Text>
        <Text variant="small" tone="mutedForeground" style={{ textAlign: 'center' }}>
          {t('apply.successBody')}
        </Text>
      </View>

      <View style={{ borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
        {rows.map(([label, value], index) => (
          <View
            key={label}
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              gap: space[4],
              padding: space[4],
              borderTopWidth: index ? 1 : 0,
              borderTopColor: colors.border,
            }}
          >
            <Text variant="small" tone="mutedForeground">
              {label}
            </Text>
            <Text variant="small" weight="medium" style={{ flexShrink: 1, textAlign: 'right' }}>
              {value}
            </Text>
          </View>
        ))}
      </View>

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
