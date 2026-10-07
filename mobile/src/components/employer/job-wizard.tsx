import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router, useNavigation } from 'expo-router';
import { useLocale, useTranslations } from 'use-intl';
import { Scale, TriangleAlert } from '~/components/ui/lucide';
import { formatEgp, formatNumber } from '@/lib/format';
import { localized } from '@/lib/locale';
import type { JobRow, SalaryReferenceRow } from '@/lib/supabase/database.types';
import {
  BENEFITS,
  COMMISSION_TYPES,
  EMPLOYMENT_TYPES,
  EXPERIENCE_BANDS,
  JOB_TRACKS,
  LEADS_SOURCES,
} from '@/lib/taxonomy';
import { uuid } from '@/lib/uuid';
import { CompensationCard } from '~/components/jobs/compensation-card';
import { ChipGroup, wholeNumber } from '~/components/profile/fields';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { Field } from '~/components/ui/field';
import { Notice } from '~/components/ui/notice';
import { Select } from '~/components/ui/select';
import { Text } from '~/components/ui/text';
import { TextField } from '~/components/ui/text-field';
import {
  decimalNumber,
  findSimilar,
  initialValues,
  JobSaveRefused,
  MAX_DEVELOPERS,
  problemsOn,
  salaryReference,
  stepOf,
  STEPS,
  toJobInput,
  useSaveJob,
  type FieldKey,
  type JobValues,
  type Problem,
} from '~/features/employer/job-form';
import { useDevelopers, useDistricts } from '~/features/taxonomy';
import { markupTags } from '~/i18n/rich';
import { ApiError } from '~/lib/api';
import { useSession } from '~/lib/session';
import { useErrorsInView } from '~/lib/use-errors-in-view';
import { useLeaveGuard } from '~/lib/use-leave-guard';
import { useTheme } from '~/theme/provider';
import { corner, gutter, hitTarget, space } from '~/theme/tokens';

/** The fields that can be refused, as each step shows them, top first. */
const FIELD_ORDER = [
  'titleAr',
  'titleEn',
  'districtId',
  'seats',
  'basicSalaryMin',
  'basicSalaryMax',
  'commissionValue',
  'commissionNoteAr',
  'descriptionAr',
  'descriptionEn',
  'requirementsAr',
] as const;

/**
 * Posting a listing, or changing one — the website's four-step JobForm:
 * basics, pay, details, and a review that shows the advert as it will be
 * published. Each step is checked before the next (the website's `required`
 * fields and its schema's rules); leaving the first asks, in the background,
 * whether the company already has a listing like it and what listings like it
 * pay. A draft is saved as it stands. One idempotency key for as long as the
 * form is open, and the version it was built from, so a retry never posts
 * twice and a colleague's save in between is never overwritten.
 *
 * A live listing is edited, not submitted: the database sends it back to
 * review only when something material changed, and the note says which.
 */
export function JobWizard({ job, developerIds }: { job: JobRow | null; developerIds: number[] }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const districts = useDistricts().data ?? [];
  const developers = useDevelopers().data ?? [];
  const save = useSaveJob();
  const { actor } = useSession();
  const scroll = useRef<ScrollView>(null);
  const inView = useErrorsInView(scroll, FIELD_ORDER);

  const [idempotencyKey] = useState(() => uuid());
  // The version the fields were filled from. The listing is read again when the
  // app comes back to the front; sent with its new version, these fields would
  // pass the website's check and put back what a colleague changed meanwhile.
  const [version] = useState(() => job?.version);
  const [step, setStep] = useState(0);
  const [draft, setValues] = useState<JobValues>(() => initialValues(job, developerIds, null));
  // Leaving with something typed asks first; once saved, the wizard closes itself.
  const [opened] = useState(() => JSON.stringify(initialValues(job, developerIds, null)));
  const [saved, setSaved] = useState(false);
  useLeaveGuard(!saved && JSON.stringify(draft) !== opened, !saved && save.isPending);
  // Closed by its own navigation, not the app's: answered after the employer
  // switched tabs, the app's Back took whatever screen was in front there, and
  // the wizard stayed open, saved, never to close.
  const navigation = useNavigation();
  useEffect(() => {
    if (saved) {
      if (navigation.canGoBack()) navigation.goBack();
      else router.replace('/employer/jobs' as never);
    }
  }, [saved, navigation]);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [similar, setSimilar] = useState<{ id: string; title: string; seats: number } | null>(null);
  const [reference, setReference] = useState<SalaryReferenceRow | null>(null);
  const live = job?.status === 'active';

  // A new listing starts in the first district, as the website's does, once the list is here.
  const values: JobValues = draft.districtId == null && districts[0] ? { ...draft, districtId: districts[0].id } : draft;

  const set = <K extends keyof JobValues>(key: K) => (value: JobValues[K]) => setValues((current) => ({ ...current, [key]: value }));
  const flip = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((entry) => entry !== item) : [...list, item]);

  const say = (problem: string): string =>
    problem === 'numberInvalid'
      ? t('app.profile.numberInvalid')
      : (['required', 'salaryOrder', 'commissionRequired', 'tooManyLinks'] as string[]).includes(problem)
        ? t(`validation.${problem as Exclude<Problem, 'numberInvalid'>}`)
        : t('validation.required');

  /** Errors under their fields, the first brought into view and said: Next and Submit are far below them. */
  const show = (problems: Partial<Record<FieldKey, Problem>>) => {
    const messages = Object.fromEntries(Object.entries(problems).map(([key, problem]) => [key, say(problem as string)]));
    setErrors(messages);
    inView.show(messages);
  };

  const goTo = (next: number) => {
    setStep(next);
    scroll.current?.scrollTo({ y: 0, animated: false });
  };

  /** A refusal of the whole form: said at the top, where the screen is taken, on the step it is about. */
  const refuse = (message: string, where = step) => {
    setErrors({ form: message });
    goTo(where);
    inView.show({ form: message });
  };

  // Only the latest lookup's answer is shown: a slower one for an earlier district must not replace it.
  const lookup = useRef(0);

  const next = () => {
    const problems = problemsOn(step, values);
    if (Object.keys(problems).length) return show(problems);
    setErrors({});
    if (step === 0 && values.districtId != null) {
      // Answered on the next step, so nobody waits on a round trip to move on.
      const asked = ++lookup.current;
      void findSimilar({ titleAr: values.titleAr.trim(), districtId: values.districtId, excludeId: job?.id ?? null }).then(
        (found) => asked === lookup.current && setSimilar(found),
      );
      void salaryReference({ track: values.track, districtId: values.districtId }).then(
        (found) => asked === lookup.current && setReference(found),
      );
    }
    goTo(step + 1);
  };

  const submit = (publish: boolean) => {
    if (publish) {
      for (let index = 0; index < STEPS.length - 1; index += 1) {
        const problems = problemsOn(index, values);
        if (Object.keys(problems).length) {
          show(problems);
          return goTo(index);
        }
      }
    }
    setErrors({});
    save.mutate(toJobInput(values, { id: job?.id, version, idempotencyKey, submit: publish }), {
      // Closed once the guard has stood down (the effect above), not from here.
      onSuccess: () => setSaved(true),
      onError: (failure) => {
        if (failure instanceof ApiError && failure.status === 0) return refuse(t('app.offline.body'));
        const reason = failure instanceof JobSaveRefused ? failure.reason : 'failed';
        const fields = failure instanceof JobSaveRefused ? failure.fieldErrors : undefined;
        if (reason === 'stale' || reason === 'invalid_transition') return refuse(t('employer.listingMoved'));
        // Under review is not restricted: an account still pending is told it is being looked at.
        if (reason === 'standing') {
          return refuse(t(actor?.profile?.approval_status === 'pending' ? 'employer.pendingBody' : 'employer.standingBlocked'));
        }
        if (reason === 'company_suspended') return refuse(t('employer.companySuspendedBlocked'));
        if (reason === 'post_cap' || reason === 'post_rate_limit') {
          return refuse(t(reason === 'post_cap' ? 'employer.postCapBlocked' : 'employer.postRateLimited'), 3);
        }
        if (reason === 'duplicate_listing') return refuse(t('employer.duplicateListingBlocked'), 0);
        if (fields && Object.keys(fields).length) {
          const where = stepOf(Object.keys(fields));
          // A field with no place on any step (the developers past their limit) is not refused in silence.
          if (where == null) return refuse(t('common.errorBody'));
          const messages = Object.fromEntries(Object.entries(fields).map(([key, message]) => [key, say(message)]));
          setErrors(messages);
          goTo(where);
          inView.show(messages);
          return;
        }
        refuse(t('common.errorBody'));
      },
    });
  };

  const text = (
    key: 'titleAr' | 'titleEn' | 'commissionNoteAr' | 'descriptionAr' | 'descriptionEn' | 'requirementsAr',
    label: string,
    max: number,
    options: { hint?: string; ltr?: boolean; lines?: number } = {},
  ) => (
    <Field ref={inView.place(key)} label={label} hint={options.hint} error={errors[key]}>
      <TextField
        value={values[key]}
        onChangeText={set(key)}
        accessibilityLabel={label}
        maxLength={max}
        ltr={options.ltr}
        multiline={Boolean(options.lines)}
        style={options.lines ? { minHeight: options.lines * 22, paddingVertical: space[2], textAlignVertical: 'top' } : undefined}
      />
    </Field>
  );

  const district = districts.find((row) => row.id === values.districtId) ?? null;
  const seats = wholeNumber(values.seats);
  const amount = (raw: string) => {
    const value = wholeNumber(raw);
    return value === null || Number.isNaN(value) ? null : value;
  };
  const commission = decimalNumber(values.commissionValue);

  return (
    <ScrollView
      ref={scroll}
      contentInsetAdjustmentBehavior="automatic"
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      contentContainerStyle={{ padding: gutter, paddingBottom: space[10], gap: space[5] }}
    >
      {/*
        Where the form is, and a way back to any step: a segment each, filled
        up to this one — one row at any width, where four labelled pills
        wrapped — with the step's name under it.
      */}
      <View style={{ gap: space[2] }}>
        <View style={{ flexDirection: 'row', gap: space[1] + 2 }}>
          {STEPS.map((name, index) => (
            <Pressable
              key={name}
              accessibilityRole="button"
              accessibilityLabel={t(`jobForm.${name}`)}
              accessibilityState={{ selected: index === step }}
              onPress={() => goTo(index)}
              hitSlop={{ top: 10, bottom: 10 }}
              style={{ flex: 1, minHeight: 24, justifyContent: 'center' }}
            >
              <View style={{ height: 4, ...corner('full'), backgroundColor: index <= step ? colors.primary : colors.input }} />
            </Pressable>
          ))}
        </View>
        <Text variant="caption" weight="medium" tone="mutedForeground">
          {t.markup('app.jobs.wizardStep', {
            current: formatNumber(step + 1, locale),
            total: formatNumber(STEPS.length, locale),
            ...markupTags,
          })}
        </Text>
        <Text variant="title" weight="semibold" accessibilityRole="header">
          {t(`jobForm.${STEPS[step]}`)}
        </Text>
      </View>

      {/* A refusal, where a refused save leaves the screen: at the top. */}
      {errors.form ? <Notice tone="destructive">{errors.form}</Notice> : null}

      {similar && step > 0 ? (
        <Notice tone="warning" title={t('employer.duplicateTitle')} icon={<TriangleAlert size={16} color={colors.warning} />}>
          <View style={{ gap: space[3] }}>
            <Text variant="small">{t('employer.duplicateBody', { title: similar.title, seats: similar.seats })}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
              <Button
                label={t('employer.duplicateEdit')}
                variant="outline"
                size="sm"
                onPress={() => router.push(`/employer/jobs/${similar.id}/edit` as never)}
              />
              <Button label={t('employer.duplicateDismiss')} variant="ghost" size="sm" onPress={() => setSimilar(null)} />
            </View>
          </View>
        </Notice>
      ) : null}

      {step === 0 ? (
        <View style={{ gap: space[4] }}>
          {text('titleAr', t('jobForm.titleAr'), 160)}
          {text('titleEn', t('jobForm.titleEn'), 160, { hint: t('jobForm.titleEnHint'), ltr: true })}
          <Field label={t('jobForm.track')}>
            <Select
              label={t('jobForm.track')}
              value={values.track}
              placeholder={t('jobForm.track')}
              required
              options={JOB_TRACKS.map((value) => ({ value, label: t(`track.${value}`) }))}
              onChange={(value) => value && set('track')(value)}
            />
          </Field>
          <Field label={t('jobForm.employmentType')}>
            <Select
              label={t('jobForm.employmentType')}
              value={values.employmentType}
              placeholder={t('jobForm.employmentType')}
              required
              options={EMPLOYMENT_TYPES.map((value) => ({ value, label: t(`employmentType.${value}`) }))}
              onChange={(value) => value && set('employmentType')(value)}
            />
          </Field>
          <Field label={t('jobForm.experienceBand')}>
            <Select
              label={t('jobForm.experienceBand')}
              value={values.experienceBand}
              placeholder={t('jobForm.experienceBand')}
              required
              options={EXPERIENCE_BANDS.map((value) => ({ value, label: t(`experienceBand.${value}`) }))}
              onChange={(value) => value && set('experienceBand')(value)}
            />
          </Field>
          <Field ref={inView.place('districtId')} label={t('jobForm.district')} error={errors.districtId}>
            <Select
              label={t('jobForm.district')}
              value={values.districtId}
              placeholder={t('jobForm.district')}
              required
              options={districts.map((row) => ({ value: row.id, label: localized(locale, row.name_ar, row.name_en) }))}
              onChange={(value) => value != null && set('districtId')(value)}
            />
          </Field>
          <Field ref={inView.place('seats')} label={t('jobForm.seats')} hint={t('jobForm.seatsHint')} error={errors.seats}>
            <TextField
              value={values.seats}
              onChangeText={set('seats')}
              accessibilityLabel={t('jobForm.seats')}
              ltr
              keyboardType="number-pad"
              maxLength={3}
            />
          </Field>
        </View>
      ) : null}

      {step === 1 ? (
        <View style={{ gap: space[4] }}>
          <Field
            ref={inView.place('basicSalaryMin')}
            label={t('jobForm.basicSalaryMin')}
            hint={t('jobForm.salaryHint')}
            error={errors.basicSalaryMin}
          >
            <TextField
              value={values.basicSalaryMin}
              onChangeText={set('basicSalaryMin')}
              accessibilityLabel={t('jobForm.basicSalaryMin')}
              ltr
              keyboardType="number-pad"
              maxLength={11}
            />
          </Field>
          <Field ref={inView.place('basicSalaryMax')} label={t('jobForm.basicSalaryMax')} error={errors.basicSalaryMax}>
            <TextField
              value={values.basicSalaryMax}
              onChangeText={set('basicSalaryMax')}
              accessibilityLabel={t('jobForm.basicSalaryMax')}
              ltr
              keyboardType="number-pad"
              maxLength={11}
            />
          </Field>
          {/* What listings like this one pay — only when the board has five to say so. */}
          {reference ? (
            <View style={{ flexDirection: 'row', gap: space[1] }}>
              <Scale size={13} color={colors.mutedForeground} style={{ marginTop: 3 }} />
              <Text variant="caption" tone="mutedForeground" style={{ flex: 1 }}>
                {t.markup('compensation.reference', {
                  low: formatEgp(reference.low, locale),
                  high: formatEgp(reference.high, locale),
                  count: reference.sample,
                  ...markupTags,
                })}
              </Text>
            </View>
          ) : null}
          <Field label={t('jobForm.commissionType')}>
            <Select
              label={t('jobForm.commissionType')}
              value={values.commissionType}
              placeholder={t('jobForm.commissionType')}
              required
              options={COMMISSION_TYPES.map((value) => ({ value, label: t(`commissionType.${value}`) }))}
              onChange={(value) => value && set('commissionType')(value)}
            />
          </Field>
          {values.commissionType === 'percentage' ? (
            <Field ref={inView.place('commissionValue')} label={t('jobForm.commissionValue')} error={errors.commissionValue}>
              <TextField
                value={values.commissionValue}
                onChangeText={set('commissionValue')}
                accessibilityLabel={t('jobForm.commissionValue')}
                ltr
                keyboardType="decimal-pad"
                maxLength={6}
              />
            </Field>
          ) : null}
          {text('commissionNoteAr', t('jobForm.commissionNote'), 500, { hint: t('jobForm.commissionNoteHint'), lines: 3 })}
          <Field label={t('jobForm.leadsSource')} hint={t('jobForm.leadsSourceHint')}>
            <Select
              label={t('jobForm.leadsSource')}
              value={values.leadsSource}
              placeholder={t('jobForm.leadsSource')}
              required
              options={LEADS_SOURCES.map((value) => ({ value, label: t(`leadsSource.${value}`) }))}
              onChange={(value) => value && set('leadsSource')(value)}
            />
          </Field>
          <ChipGroup
            legend={t('jobForm.benefits')}
            options={BENEFITS.map((value) => ({ value, label: t(`benefits.${value}`) }))}
            selected={values.benefits}
            onToggle={(value) => setValues((current) => ({ ...current, benefits: flip(current.benefits, value) }))}
          />
        </View>
      ) : null}

      {step === 2 ? (
        <View style={{ gap: space[4] }}>
          {text('descriptionAr', t('jobForm.descriptionAr'), 8000, { hint: t('jobForm.descriptionRules'), lines: 8 })}
          {text('descriptionEn', t('jobForm.descriptionEn'), 8000, { ltr: true, lines: 6 })}
          {text('requirementsAr', t('jobForm.requirementsAr'), 4000, { lines: 5 })}
          <View style={{ gap: space[1] }}>
            <ChipGroup
              legend={t('jobForm.developers')}
              options={developers.map((row) => ({ value: row.id, label: localized(locale, row.name_ar, row.name_en) }))}
              selected={values.developerIds}
              onToggle={(value) => setValues((current) => ({ ...current, developerIds: flip(current.developerIds, value) }))}
              scroll
              max={MAX_DEVELOPERS}
            />
            <Text variant="caption" tone="mutedForeground">
              {t('jobForm.developersHint')}
            </Text>
          </View>
        </View>
      ) : null}

      {step === 3 ? (
        <View style={{ gap: space[4] }}>
          {/* The advert as it will be published, formatted as the published one is. */}
          <Card style={{ gap: space[3] }}>
            <Text variant="title" weight="semibold">
              {values.titleAr.trim() || t('jobForm.titleAr')}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[1] }}>
              <Badge variant="primary" label={t(`leadsSource.${values.leadsSource}`)} />
              <Badge variant="outline" label={t(`track.${values.track}`)} />
              <Badge variant="outline" label={t(`employmentType.${values.employmentType}`)} />
              <Badge variant="outline" label={t(`experienceBand.${values.experienceBand}`)} />
              {district ? <Badge variant="outline" label={localized(locale, district.name_ar, district.name_en)} /> : null}
              {seats != null && !Number.isNaN(seats) ? (
                <Badge variant="accent" label={`${formatNumber(seats, locale)} ${t('jobs.seatsLabel', { count: seats })}`} />
              ) : null}
            </View>
            <CompensationCard
              job={{
                basic_salary_min: amount(values.basicSalaryMin),
                basic_salary_max: amount(values.basicSalaryMax),
                commission_type: values.commissionType,
                commission_value:
                  values.commissionType === 'percentage' && commission !== null && !Number.isNaN(commission) ? commission : null,
                commission_note_ar: values.commissionNoteAr.trim() || null,
                leads_source: values.leadsSource,
                benefits: values.benefits,
              }}
              reference={reference}
            />
            {values.descriptionAr.trim() ? (
              <Text variant="small" tone="mutedForeground">
                {values.descriptionAr.trim()}
              </Text>
            ) : null}
          </Card>

          <View style={{ padding: space[4], ...corner('lg'), backgroundColor: colors.muted }}>
            <Text variant="small" tone="mutedForeground">
              {live ? t('jobForm.liveEditNote') : t('jobForm.reviewNote')}
            </Text>
          </View>
        </View>
      ) : null}

      {step === STEPS.length - 1 ? (
        <View style={{ gap: space[2] }}>
          <Button
            label={live ? t('employer.saveChanges') : t('employer.submitForReview')}
            size="lg"
            loading={save.isPending}
            onPress={() => submit(true)}
          />
          {/* A published listing has no draft to go back to. */}
          {live ? null : (
            <Button label={t('employer.saveDraft')} variant="outline" size="lg" disabled={save.isPending} onPress={() => submit(false)} />
          )}
        </View>
      ) : null}

      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          gap: space[3],
          paddingTop: space[4],
          borderTopWidth: 1,
          borderTopColor: colors.border,
        }}
      >
        <Button label={t('jobForm.back')} variant="ghost" disabled={step === 0} onPress={() => goTo(Math.max(0, step - 1))} />
        {step < STEPS.length - 1 ? <Button label={t('jobForm.next')} onPress={next} style={{ minWidth: hitTarget * 2 }} /> : null}
      </View>
    </ScrollView>
  );
}
