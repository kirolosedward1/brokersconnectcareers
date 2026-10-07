import { useState, type RefObject } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { View, type ScrollView } from 'react-native';
import { useLocale, useTranslations } from 'use-intl';
import { CheckCircle2 } from '~/components/ui/lucide';
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
import { useSession, type Viewer } from '~/lib/session';
import { useErrorsInView } from '~/lib/use-errors-in-view';
import { useLeaveGuard } from '~/lib/use-leave-guard';
import { webAddress } from '~/lib/web-address';
import { useTheme } from '~/theme/provider';
import { space } from '~/theme/tokens';

type Key = 'nameAr' | 'website' | 'aboutAr' | 'aboutEn' | 'form';

/** The columns this form edits, as the fields hold them. */
type Fields = {
  nameAr: string;
  nameEn: string;
  aboutAr: string;
  aboutEn: string;
  site: string;
  companyType: CompanyType | null;
  headcount: HeadcountBand | null;
  districtId: number | null;
};

function fieldsOf(company: CompanyRow | null): Fields {
  return {
    nameAr: company?.name_ar ?? '',
    nameEn: company?.name_en ?? '',
    aboutAr: company?.about_ar ?? '',
    aboutEn: company?.about_en ?? '',
    site: company?.website ?? '',
    companyType: company?.company_type ?? null,
    headcount: company?.headcount_band ?? null,
    districtId: company?.district_id ?? null,
  };
}

const sameFields = (a: Fields, b: Fields) => (Object.keys(a) as (keyof Fields)[]).every((key) => a[key] === b[key]);

/**
 * The company's profile as candidates read it — the website's CompanyForm,
 * which also creates the company when there is none yet. Saved on the
 * version it was loaded at, so a colleague's save in between is reported
 * rather than overwritten. The website's schema refuses a name under two
 * letters and any address that is not http(s); both are said before sending.
 *
 * A new version of the company (a logo, a paper, a save — every change moves
 * it) does not start the form again: that wiped whatever was being typed. It
 * is taken over when nothing was typed since the fields were filled, when it
 * is this form's own save coming back, or when the profile's own columns did
 * not change; a colleague's change to them leaves what is typed on the old
 * version, so saving says so, and the answer brings theirs in.
 */
export function CompanyForm({
  company,
  scroll,
}: {
  company: CompanyRow | null;
  /** The page's scroll view: Save is below the fields, and an error is brought into view. */
  scroll: RefObject<ScrollView | null>;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const districts = useDistricts().data ?? [];
  const save = useSaveCompany();
  const queryClient = useQueryClient();
  const userId = useSession().session?.user.id ?? null;

  const [nameAr, setNameAr] = useState(company?.name_ar ?? '');
  const [nameEn, setNameEn] = useState(company?.name_en ?? '');
  const [aboutAr, setAboutAr] = useState(company?.about_ar ?? '');
  const [aboutEn, setAboutEn] = useState(company?.about_en ?? '');
  const [site, setSite] = useState(company?.website ?? '');
  const [companyType, setCompanyType] = useState<CompanyType | null>(company?.company_type ?? null);
  const [headcount, setHeadcount] = useState<HeadcountBand | null>(company?.headcount_band ?? null);
  const [districtId, setDistrictId] = useState<number | null>(company?.district_id ?? null);
  const [errors, setErrors] = useState<Partial<Record<Key, string>>>({});
  const inView = useErrorsInView(scroll, ['nameAr', 'aboutAr', 'aboutEn', 'website']);
  const refuse = (next: Partial<Record<Key, string>>) => {
    setErrors(next);
    inView.show(next);
  };
  const [saved, setSaved] = useState(false);
  // The row the fields were filled from, and how to take the next version to
  // arrive: 'theirs' whole (a colleague's save got there first), or — after
  // this form's own save — whole while the fields still hold what was sent.
  const [loaded, setLoaded] = useState(company);
  const [takeNext, setTakeNext] = useState<Fields | 'theirs' | null>(null);
  const sent = takeNext === 'theirs' ? null : takeNext;

  // Leaving with the profile changed and not saved asks first — anything typed
  // since a save too, while its version is still on the way.
  const typedNow: Fields = { nameAr, nameEn, aboutAr, aboutEn, site, companyType, headcount, districtId };
  useLeaveGuard(takeNext !== 'theirs' && !sameFields(typedNow, sent ?? fieldsOf(loaded)), save.isPending);

  if (company && loaded && company.version !== loaded.version) {
    const typed: Fields = { nameAr, nameEn, aboutAr, aboutEn, site, companyType, headcount, districtId };
    if (takeNext === 'theirs' || sameFields(typed, sent ?? fieldsOf(loaded))) {
      const next = fieldsOf(company);
      setNameAr(next.nameAr);
      setNameEn(next.nameEn);
      setAboutAr(next.aboutAr);
      setAboutEn(next.aboutEn);
      setSite(next.site);
      setCompanyType(next.companyType);
      setHeadcount(next.headcount);
      setDistrictId(next.districtId);
      setLoaded(company);
      setTakeNext(null);
    } else if (sent || sameFields(fieldsOf(company), fieldsOf(loaded))) {
      // Typed on since this form's save (or a version that changed none of
      // these fields): what is typed stays, on the new version, still to save.
      setLoaded(company);
      setTakeNext(null);
    }
  }

  const submit = () => {
    setSaved(false);
    const local: Partial<Record<Key, string>> = {};
    const address = webAddress(site);
    if (nameAr.trim().length < 2) local.nameAr = t('validation.required');
    if (address && !safeHttpUrl(address)) local.website = t('validation.invalidUrl');
    if (Object.keys(local).length) return refuse(local);
    setErrors({});
    const sending = typedNow;
    const basedOn = loaded?.version;

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
        ...(loaded ? { version: loaded.version } : {}),
      },
      {
        onSuccess: () => {
          setSaved(true);
          // What comes back is what was just sent, on its new version — read
          // back already (useSaveCompany waits for it), and reaching this form
          // a render later, Save held till then. Not read back (no
          // connection): nothing on its way to wait for.
          const latest = queryClient.getQueryData<Viewer>(['viewer', userId])?.company;
          setTakeNext(latest && latest.version !== basedOn ? sending : null);
        },
        onError: (failure) => {
          if (failure instanceof ApiError && failure.status === 0) return refuse({ form: t('app.offline.body') });
          const reason = failure instanceof CompanyRefused ? failure.reason : 'failed';
          if (reason === 'stale') {
            // "Reload to see their version": the next read of the company fills the form with it.
            setTakeNext('theirs');
            return refuse({ form: t('employer.companyMoved') });
          }
          const fields = failure instanceof CompanyRefused ? failure.fieldErrors : undefined;
          if (fields?.aboutAr || fields?.aboutEn) {
            return refuse({
              ...(fields.aboutAr ? { aboutAr: t('validation.tooManyLinks') } : {}),
              ...(fields.aboutEn ? { aboutEn: t('validation.tooManyLinks') } : {}),
            });
          }
          refuse({ form: t('common.errorBody') });
        },
      },
    );
  };

  return (
    <View style={{ gap: space[4] }}>
      <Field ref={inView.place('nameAr')} label={t('companies.nameAr')} error={errors.nameAr}>
        <TextField value={nameAr} onChangeText={setNameAr} accessibilityLabel={t('companies.nameAr')} maxLength={160} />
      </Field>
      <Field label={t('companies.nameEn')}>
        <TextField value={nameEn} onChangeText={setNameEn} accessibilityLabel={t('companies.nameEn')} maxLength={160} ltr />
      </Field>
      <Field ref={inView.place('aboutAr')} label={t('companies.aboutAr')} error={errors.aboutAr}>
        <TextField
          value={aboutAr}
          onChangeText={setAboutAr}
          accessibilityLabel={t('companies.aboutAr')}
          multiline
          maxLength={2000}
          style={{ minHeight: 96, paddingVertical: space[2], textAlignVertical: 'top' }}
        />
      </Field>
      <Field ref={inView.place('aboutEn')} label={t('companies.aboutEn')} error={errors.aboutEn}>
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
      <Field ref={inView.place('website')} label={t('companies.website')} error={errors.website}>
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
          // Its own save's version not in the form yet: a save now would go on the old one.
          disabled={sent !== null}
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
