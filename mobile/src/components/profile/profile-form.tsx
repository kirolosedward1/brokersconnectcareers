import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useLocale, useTranslations } from 'use-intl';
import { CheckCircle2, Eye, EyeOff, FileText, Paperclip, ShieldCheck, Trash2, X } from 'lucide-react-native';
import { localized } from '@/lib/locale';
import { isValidPhone, normalisePhone } from '@/lib/phone';
import type {
  AgentAvailability,
  AgentProfileRow,
  AgentVisibility,
  JobTrack,
  ProfileRow,
} from '@/lib/supabase/database.types';
import { AVAILABILITIES, JOB_TRACKS } from '@/lib/taxonomy';
import { Button } from '~/components/ui/button';
import { Field } from '~/components/ui/field';
import { Notice } from '~/components/ui/notice';
import { Select } from '~/components/ui/select';
import { Text } from '~/components/ui/text';
import { TextField } from '~/components/ui/text-field';
import { pickCv } from '~/features/cv/files';
import { toggled } from '~/features/jobs/filters';
import { SaveRefused, useSaveAgentProfile, type CvChange } from '~/features/profile/queries';
import { useDevelopers, useDistricts } from '~/features/taxonomy';
import { useTheme } from '~/theme/provider';
import { hitTarget, radius, space } from '~/theme/tokens';
import { ChipGroup, wholeNumber } from './fields';

const VISIBILITIES: AgentVisibility[] = ['public', 'verified_employers_only', 'hidden'];
const LANGUAGES = ['ar', 'en', 'fr'] as const;

type Errors = Partial<Record<'fullName' | 'whatsapp' | 'yearsExperience' | 'cv' | 'form', string>>;

/**
 * The directory profile — the website's AgentProfileForm, field for field and
 * in its order: the name and number (they live on the account, and change
 * there too), then who sees the profile — first, because that decides what
 * someone is willing to write — then the rest, and the CV.
 *
 * The CV on file is named, taking it off is a choice, and a new one is
 * uploaded to the candidate's own folder before the save (the action takes a
 * path), and taken back out if the save is refused.
 */
export function ProfileForm({
  profile,
  agent,
  developerIds,
}: {
  profile: ProfileRow;
  agent: AgentProfileRow | null;
  developerIds: number[];
}) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const save = useSaveAgentProfile();
  const districts = useDistricts().data ?? [];
  const developers = useDevelopers().data ?? [];

  const [fullName, setFullName] = useState(profile.full_name);
  const [whatsapp, setWhatsapp] = useState(profile.whatsapp_phone);
  const [visibility, setVisibility] = useState<AgentVisibility>(agent?.visibility ?? 'verified_employers_only');
  const [availability, setAvailability] = useState<AgentAvailability>(agent?.availability ?? 'open_to_offers');
  const [years, setYears] = useState(String(agent?.years_experience ?? 0));
  const [headlineAr, setHeadlineAr] = useState(agent?.headline_ar ?? '');
  const [headlineEn, setHeadlineEn] = useState(agent?.headline_en ?? '');
  const [tracks, setTracks] = useState<JobTrack[]>(agent?.tracks ?? []);
  const [districtIds, setDistrictIds] = useState<number[]>(agent?.district_ids ?? []);
  const [developerChoice, setDeveloperChoice] = useState<number[]>(developerIds);
  const [languages, setLanguages] = useState<string[]>(agent?.languages ?? ['ar']);
  const [cv, setCv] = useState<CvChange>({ kind: 'keep' });
  const [errors, setErrors] = useState<Errors>({});

  const hasCv = Boolean(agent?.cv_path);

  const chooseCv = async () => {
    setErrors((current) => ({ ...current, cv: undefined }));
    const picked = await pickCv().catch(() => null);
    if (!picked) return;
    if ('problem' in picked) {
      setErrors((current) => ({ ...current, cv: t(`validation.${picked.problem}`) }));
      return;
    }
    setCv({ kind: 'file', file: picked.cv });
  };

  const submit = () => {
    const local: Errors = {};
    const yearsExperience = wholeNumber(years) ?? 0;
    if (fullName.trim().length < 2) local.fullName = t('validation.required');
    if (!isValidPhone(normalisePhone(whatsapp))) local.whatsapp = t('validation.invalidPhone');
    if (!Number.isInteger(yearsExperience) || yearsExperience > 60) local.yearsExperience = t('app.profile.yearsInvalid');
    if (Object.keys(local).length) {
      setErrors(local);
      return;
    }

    setErrors({});
    save.mutate(
      {
        input: {
          fullName: fullName.trim(),
          whatsapp,
          headlineAr: headlineAr.trim() || null,
          headlineEn: headlineEn.trim() || null,
          yearsExperience,
          tracks,
          districtIds,
          developerIds: developerChoice,
          languages,
          availability,
          visibility,
        },
        cv,
      },
      {
        // The picked file has been saved: a second save must not upload it again.
        onSuccess: () => setCv({ kind: 'keep' }),
        onError: (failure) => {
          const reason = failure instanceof SaveRefused ? failure.reason : 'failed';
          const fields = failure instanceof SaveRefused ? failure.fieldErrors : undefined;
          if (reason === 'fileTooLarge') return setErrors({ cv: t('validation.fileTooLarge') });
          if (reason === 'upload' || reason === 'invalid_cv_path') return setErrors({ cv: t('common.errorBody') });
          if (fields?.whatsapp || fields?.cv) {
            return setErrors({
              ...(fields.whatsapp ? { whatsapp: t('validation.invalidPhone') } : {}),
              ...(fields.cv ? { cv: t('validation.fileType') } : {}),
            });
          }
          setErrors({ form: t('common.errorBody') });
        },
      },
    );
  };

  return (
    <View style={{ gap: space[5] }}>
      <Field label={t('onboarding.fullName')} error={errors.fullName}>
        <TextField
          value={fullName}
          onChangeText={setFullName}
          accessibilityLabel={t('onboarding.fullName')}
          autoComplete="name"
          textContentType="name"
          maxLength={120}
        />
      </Field>

      <Field label={t('onboarding.whatsapp')} error={errors.whatsapp}>
        <TextField
          value={whatsapp}
          onChangeText={setWhatsapp}
          accessibilityLabel={t('onboarding.whatsapp')}
          ltr
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
        />
      </Field>

      <View style={{ gap: space[1], paddingTop: space[4], borderTopWidth: 1, borderTopColor: colors.border }}>
        <Text weight="semibold" accessibilityRole="header">
          {t('dashboard.agentProfile')}
        </Text>
        <Text variant="small" tone="mutedForeground">
          {t('dashboard.agentProfileHint')}
        </Text>
      </View>

      {/* Who will see this, before anything is written. */}
      <View style={{ gap: space[2] }} accessibilityRole="radiogroup" accessibilityLabel={t('agents.whoSeesProfile')}>
        <Text variant="small" weight="medium">
          {t('agents.whoSeesProfile')}
        </Text>
        {VISIBILITIES.map((value) => {
          const chosen = visibility === value;
          const Icon = value === 'public' ? Eye : value === 'hidden' ? EyeOff : ShieldCheck;
          return (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityState={{ checked: chosen }}
              onPress={() => setVisibility(value)}
              style={{
                flexDirection: 'row',
                gap: space[3],
                padding: space[3],
                borderRadius: radius.lg,
                borderWidth: 1,
                borderColor: chosen ? colors.primary : colors.border,
                backgroundColor: chosen ? colors.secondary : colors.card,
              }}
            >
              <Icon size={18} color={chosen ? colors.primary : colors.mutedForeground} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="small" weight="medium">
                  {t(`visibility.${value}`)}
                </Text>
                <Text variant="caption" tone="mutedForeground">
                  {t(value === 'public' ? 'visibility.publicHint' : value === 'hidden' ? 'visibility.hiddenHint' : 'visibility.verifiedHint')}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <Field label={t('agents.availability')}>
        <Select
          label={t('agents.availability')}
          value={availability}
          placeholder={t('agents.availability')}
          options={AVAILABILITIES.map((value) => ({ value, label: t(`availability.${value}`) }))}
          onChange={(value) => {
            if (value) setAvailability(value);
          }}
        />
      </Field>

      <Field label={t('filters.experienceBand')} error={errors.yearsExperience}>
        <TextField
          value={years}
          onChangeText={setYears}
          accessibilityLabel={t('filters.experienceBand')}
          ltr
          keyboardType="number-pad"
          maxLength={2}
        />
      </Field>

      <Field label={t('agents.headlineAr')}>
        <TextField
          value={headlineAr}
          onChangeText={setHeadlineAr}
          accessibilityLabel={t('agents.headlineAr')}
          multiline
          maxLength={160}
          style={{ minHeight: 64, paddingVertical: space[2], textAlignVertical: 'top' }}
        />
      </Field>

      <Field label={t('agents.headlineEn')}>
        <TextField
          value={headlineEn}
          onChangeText={setHeadlineEn}
          accessibilityLabel={t('agents.headlineEn')}
          ltr
          multiline
          maxLength={160}
          style={{ minHeight: 64, paddingVertical: space[2], textAlignVertical: 'top' }}
        />
      </Field>

      <ChipGroup
        legend={t('agents.tracks')}
        options={JOB_TRACKS.map((track) => ({ value: track, label: t(`track.${track}`) }))}
        selected={tracks}
        onToggle={(value) => setTracks((current) => toggled(current, value))}
      />

      <ChipGroup
        legend={t('agents.districts')}
        scroll
        options={districts.map((district) => ({ value: district.id, label: localized(locale, district.name_ar, district.name_en) }))}
        selected={districtIds}
        onToggle={(value) => setDistrictIds((current) => toggled(current, value))}
        max={20}
      />

      <ChipGroup
        legend={t('agents.soldFor')}
        scroll
        options={developers.map((developer) => ({
          value: developer.id,
          label: localized(locale, developer.name_ar, developer.name_en),
        }))}
        selected={developerChoice}
        onToggle={(value) => setDeveloperChoice((current) => toggled(current, value))}
        max={30}
      />

      <ChipGroup
        legend={t('agents.languages')}
        options={LANGUAGES.map((language) => ({ value: language, label: t(`language.${language}`) }))}
        selected={languages}
        onToggle={(value) => setLanguages((current) => toggled(current, value))}
      />

      <Field
        label={hasCv && cv.kind !== 'remove' ? t('agents.cvReplace') : t('agents.downloadCv')}
        hint={t('agents.cvHint')}
        error={errors.cv}
      >
        {cv.kind === 'file' ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space[2],
              paddingStart: space[3],
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Paperclip size={16} color={colors.mutedForeground} />
            <Text variant="small" numberOfLines={1} style={{ flex: 1 }}>
              {cv.file.name}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('app.apply.removeCv')}
              onPress={() => setCv({ kind: 'keep' })}
              style={{ width: hitTarget, height: hitTarget, alignItems: 'center', justifyContent: 'center' }}
            >
              <X size={16} color={colors.mutedForeground} />
            </Pressable>
          </View>
        ) : hasCv ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
            <FileText size={16} color={colors.mutedForeground} />
            <Text
              variant="small"
              tone={cv.kind === 'remove' ? 'mutedForeground' : 'foreground'}
              style={{ flex: 1, textDecorationLine: cv.kind === 'remove' ? 'line-through' : 'none' }}
            >
              {t('agents.cvCurrent')}
            </Text>
            {cv.kind === 'remove' ? null : (
              <Button
                label={t('agents.cvRemove')}
                variant="ghost"
                size="sm"
                icon={<Trash2 size={14} color={colors.destructive} />}
                onPress={() => setCv({ kind: 'remove' })}
              />
            )}
          </View>
        ) : (
          <Text variant="small" tone="mutedForeground">
            {t('agents.cvNone')}
          </Text>
        )}
        <View style={{ alignItems: 'flex-start' }}>
          <Button
            label={cv.kind === 'file' ? t('app.apply.pickAnother') : t('app.apply.pickCv')}
            variant="outline"
            size="sm"
            icon={<Paperclip size={14} color={colors.foreground} />}
            onPress={chooseCv}
          />
        </View>
      </Field>

      {errors.form ? <Notice tone="destructive">{errors.form}</Notice> : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
        <Button label={t('common.save')} size="lg" loading={save.isPending} onPress={submit} />
        {save.isSuccess ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[1] }} accessibilityLiveRegion="polite">
            <CheckCircle2 size={16} color={colors.success} />
            <Text variant="small" tone="success">
              {t('common.saveSuccess')}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}
