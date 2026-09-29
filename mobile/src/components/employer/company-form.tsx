import { useState } from 'react';
import { View } from 'react-native';
import { useLocale, useTranslations } from 'use-intl';
import { CheckCircle2 } from 'lucide-react-native';
import { localized } from '@/lib/locale';
import { safeHttpUrl } from '@/lib/security/sanitize';
import type { CompanyRow, CompanyType, HeadcountBand } from '@/lib/supabase/database.types';
import { COMPANY_TYPES, HEADCOUNT_BANDS } from '@/lib/taxonomy';
import { Button } from '~/components/ui/button';
import { Field } from '~/components/ui/field';
import { Select } from '~/components/ui/select';
import { Text } from '~/components/ui/text';
import { TextField } from '~/components/ui/text-field';
import { CompanyRefused, useSaveCompany } from '~/features/employer/company';
import { useDistricts } from '~/features/taxonomy';
import { ApiError } from '~/lib/api';
import { useTheme } from '~/theme/provider';
import { space } from '~/theme/tokens';

type Key = 'nameAr' | 'website' | 'aboutAr' | 'aboutEn' | 'form';

/** A web address as a person types it: the scheme is added when left off. */
function website(text: string): string | null {
  const value = text.trim();
  if (!value) return null;
  return /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
}

/**
 * The company's profile as candidates read it — the website's CompanyForm,
 * which also creates the company when there is none yet. Saved on the
 * version it was loaded at, so a colleague's save in between is reported
 * rather than overwritten. The website's schema refuses a name under two
 * letters and any address that is not http(s); both are said before sending.
 */
export function CompanyForm({ company }: { company: CompanyRow | null }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const districts = useDistricts().data ?? [];
  const save = useSaveCompany();

  const [nameAr, setNameAr] = useState(company?.name_ar ?? '');
  const [nameEn, setNameEn] = useState(company?.name_en ?? '');
  const [aboutAr, setAboutAr] = useState(company?.about_ar ?? '');
  const [aboutEn, setAboutEn] = useState(company?.about_en ?? '');
  const [site, setSite] = useState(company?.website ?? '');
  const [companyType, setCompanyType] = useState<CompanyType | null>(company?.company_type ?? null);
  const [headcount, setHeadcount] = useState<HeadcountBand | null>(company?.headcount_band ?? null);
  const [districtId, setDistrictId] = useState<number | null>(company?.district_id ?? null);
  const [errors, setErrors] = useState<Partial<Record<Key, string>>>({});
  const [saved, setSaved] = useState(false);

  const submit = () => {
    setSaved(false);
    const local: Partial<Record<Key, string>> = {};
    const address = website(site);
    if (nameAr.trim().length < 2) local.nameAr = t('validation.required');
    if (address && !safeHttpUrl(address)) local.website = t('validation.invalidUrl');
    if (Object.keys(local).length) return setErrors(local);
    setErrors({});

    save.mutate(
      {
        nameAr: nameAr.trim(),
        nameEn: nameEn.trim() || null,
        aboutAr: aboutAr.trim() || null,
        aboutEn: aboutEn.trim() || null,
        website: address,
        headcountBand: headcount,
        companyType,
        districtId,
        ...(company ? { version: company.version } : {}),
      },
      {
        onSuccess: () => setSaved(true),
        onError: (failure) => {
          if (failure instanceof ApiError && failure.status === 0) return setErrors({ form: t('app.offline.body') });
          const reason = failure instanceof CompanyRefused ? failure.reason : 'failed';
          if (reason === 'stale') return setErrors({ form: t('employer.companyMoved') });
          const fields = failure instanceof CompanyRefused ? failure.fieldErrors : undefined;
          if (fields?.aboutAr || fields?.aboutEn) {
            return setErrors({
              ...(fields.aboutAr ? { aboutAr: t('validation.tooManyLinks') } : {}),
              ...(fields.aboutEn ? { aboutEn: t('validation.tooManyLinks') } : {}),
            });
          }
          setErrors({ form: t('common.errorBody') });
        },
      },
    );
  };

  return (
    <View style={{ gap: space[4] }}>
      <Field label={t('companies.nameAr')} error={errors.nameAr}>
        <TextField value={nameAr} onChangeText={setNameAr} accessibilityLabel={t('companies.nameAr')} maxLength={160} />
      </Field>
      <Field label={t('companies.nameEn')}>
        <TextField value={nameEn} onChangeText={setNameEn} accessibilityLabel={t('companies.nameEn')} maxLength={160} ltr />
      </Field>
      <Field label={t('companies.aboutAr')} error={errors.aboutAr}>
        <TextField
          value={aboutAr}
          onChangeText={setAboutAr}
          accessibilityLabel={t('companies.aboutAr')}
          multiline
          maxLength={2000}
          style={{ minHeight: 96, paddingVertical: space[2], textAlignVertical: 'top' }}
        />
      </Field>
      <Field label={t('companies.aboutEn')} error={errors.aboutEn}>
        <TextField
          value={aboutEn}
          onChangeText={setAboutEn}
          accessibilityLabel={t('companies.aboutEn')}
          ltr
          multiline
          maxLength={2000}
          style={{ minHeight: 96, paddingVertical: space[2], textAlignVertical: 'top' }}
        />
      </Field>
      <Field label={t('companies.website')} error={errors.website}>
        <TextField
          value={site}
          onChangeText={setSite}
          accessibilityLabel={t('companies.website')}
          ltr
          placeholder="https://"
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={200}
        />
      </Field>
      <Field label={t('companies.companyType')} hint={t('companies.companyTypeHint')}>
        <Select
          label={t('companies.companyType')}
          value={companyType}
          placeholder={t('companies.companyTypeUnset')}
          options={COMPANY_TYPES.map((value) => ({ value, label: t(`companyType.${value}`) }))}
          onChange={setCompanyType}
        />
      </Field>
      <Field label={t('companies.headcount')}>
        <Select
          label={t('companies.headcount')}
          value={headcount}
          placeholder={t('filters.any')}
          options={HEADCOUNT_BANDS.map((value) => ({ value, label: t(`companies.headcountBand.${value}`) }))}
          onChange={setHeadcount}
        />
      </Field>
      <Field label={t('filters.district')}>
        <Select
          label={t('filters.district')}
          value={districtId}
          placeholder={t('filters.any')}
          options={districts.map((row) => ({ value: row.id, label: localized(locale, row.name_ar, row.name_en) }))}
          onChange={setDistrictId}
        />
      </Field>

      {errors.form ? (
        <Text variant="small" tone="destructive" accessibilityRole="alert">
          {errors.form}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
        <Button
          label={company ? t('common.save') : t('employer.createCompanyFirst')}
          size="lg"
          loading={save.isPending}
          onPress={submit}
        />
        {saved ? (
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
