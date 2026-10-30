import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocale, useTranslations } from 'use-intl';
import { formatDate } from '@/lib/format';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { Chip } from '~/components/ui/chip';
import { Field } from '~/components/ui/field';
import { Select } from '~/components/ui/select';
import { SettingsGroup, SwitchRow } from '~/components/ui/settings-list';
import { Text } from '~/components/ui/text';
import { TextField } from '~/components/ui/text-field';
import { HiringRefused, useSaveHiring, WEEK_DAYS, weekdayName, type CompanyHiring } from '~/features/companies/hiring';
import { cairoDay, INTERVIEW_TIMES } from '~/features/interviews/cairo-time';
import { ApiError } from '~/lib/api';
import { space } from '~/theme/tokens';

const PAUSES = [
  { key: 'untilOpenEnded', days: null },
  { key: 'untilWeek', days: 7 },
  { key: 'untilTwoWeeks', days: 14 },
  { key: 'untilMonth', days: 30 },
] as const;

/** The Cairo day `days` from today. */
const daysAhead = (days: number) => cairoDay(new Date(Date.now() + days * 24 * 60 * 60 * 1000));

/**
 * A company admin's hiring and contact settings (Phase B 07a): pause new
 * applications (for a week, two, a month, or until turned back on) without
 * closing a listing; a WhatsApp number for applicants; and the hours the
 * company replies, Cairo time. Saved together, through the website.
 */
export function HiringSettings({ companyId, hiring }: { companyId: string; hiring: CompanyHiring }) {
  const t = useTranslations();
  const locale = useLocale();
  const save = useSaveHiring(companyId);
  const [open, setOpen] = useState(hiring.open);
  const [pausedUntil, setPausedUntil] = useState<string | null>(hiring.open ? null : hiring.pausedUntil);
  const [whatsapp, setWhatsapp] = useState(hiring.whatsapp ?? '');
  const [hoursOn, setHoursOn] = useState(Boolean(hiring.replyHours));
  const [days, setDays] = useState<number[]>(hiring.replyHours?.days ?? [0, 1, 2, 3, 4]);
  const [from, setFrom] = useState(hiring.replyHours?.from ?? '10:00');
  const [to, setTo] = useState(hiring.replyHours?.to ?? '18:00');
  const [errors, setErrors] = useState<{ whatsapp?: string; hours?: string; form?: string }>({});
  const [saved, setSaved] = useState(false);

  const times = INTERVIEW_TIMES.map((time) => ({ value: time, label: time }));
  const toggleDay = (day: number) => setDays((now) => (now.includes(day) ? now.filter((d) => d !== day) : [...now, day]));

  const submit = () => {
    setSaved(false);
    if (hoursOn && from >= to) return setErrors({ hours: t('app.hiring.hoursOrder') });
    setErrors({});
    save.mutate(
      {
        hiringStatus: open ? 'open' : 'paused',
        pausedUntil: open ? null : pausedUntil,
        contactWhatsapp: whatsapp.trim() || null,
        replyHours: hoursOn && days.length ? { days, from, to } : null,
      },
      {
        onSuccess: () => setSaved(true),
        onError: (failure) => {
          if (failure instanceof ApiError && failure.status === 0) return setErrors({ form: t('app.offline.body') });
          const fields = failure instanceof HiringRefused ? failure.fieldErrors : undefined;
          if (fields?.contactWhatsapp) return setErrors({ whatsapp: t('validation.invalidPhone') });
          if (fields?.replyHours || fields?.to) return setErrors({ hours: t('app.hiring.hoursOrder') });
          setErrors({ form: t('common.errorBody') });
        },
      },
    );
  };

  return (
    <Card style={{ gap: space[4] }}>
      <View style={{ gap: space[1] }}>
        <Text weight="semibold" accessibilityRole="header">
          {t('app.hiring.settingsTitle')}
        </Text>
        <Text variant="small" tone="mutedForeground">
          {t('app.hiring.settingsBody')}
        </Text>
      </View>

      <SettingsGroup>
        <SwitchRow
          label={t('app.hiring.open')}
          hint={t('app.hiring.openHint')}
          value={open}
          onChange={(value) => {
            setOpen(value);
            setSaved(false);
          }}
          testID="hiring-open"
        />
      </SettingsGroup>

      {open ? null : (
        <View style={{ gap: space[2] }}>
          <Text variant="small" weight="medium">
            {t('app.hiring.until')}
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            accessibilityRole="radiogroup"
            accessibilityLabel={t('app.hiring.until')}
            contentContainerStyle={{ gap: space[2] }}
          >
            {PAUSES.map((pause) => {
              const day = pause.days === null ? null : daysAhead(pause.days);
              return (
                <Chip
                  key={pause.key}
                  radio
                  label={t(`app.hiring.${pause.key}`)}
                  selected={pausedUntil === day}
                  onPress={() => setPausedUntil(day)}
                />
              );
            })}
          </ScrollView>
          {pausedUntil ? (
            <Text variant="caption" tone="mutedForeground">
              {t('app.hiring.pausedUntil', { date: formatDate(`${pausedUntil}T12:00:00Z`, locale) })}
            </Text>
          ) : null}
        </View>
      )}

      <Field label={t('app.hiring.whatsapp')} hint={t('app.hiring.whatsappHint')} error={errors.whatsapp}>
        <TextField
          value={whatsapp}
          onChangeText={setWhatsapp}
          accessibilityLabel={t('app.hiring.whatsapp')}
          ltr
          keyboardType="phone-pad"
          autoComplete="tel"
          placeholder="+2010…"
        />
      </Field>

      <SettingsGroup>
        <SwitchRow label={t('app.hiring.hoursOn')} value={hoursOn} onChange={setHoursOn} testID="hiring-hours" />
      </SettingsGroup>
      {hoursOn ? (
        <View style={{ gap: space[3] }}>
          <Text variant="small" weight="medium">
            {t('app.hiring.days')}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }} accessibilityLabel={t('app.hiring.days')}>
            {WEEK_DAYS.map((day) => (
              <Chip key={day} label={weekdayName(day, locale)} selected={days.includes(day)} onPress={() => toggleDay(day)} />
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: space[3] }}>
            <View style={{ flex: 1 }}>
              <Field label={t('app.hiring.from')}>
                <Select label={t('app.hiring.from')} value={from} placeholder={from} required options={times} onChange={(value) => value && setFrom(value)} />
              </Field>
            </View>
            <View style={{ flex: 1 }}>
              <Field label={t('app.hiring.to')}>
                <Select label={t('app.hiring.to')} value={to} placeholder={to} required options={times} onChange={(value) => value && setTo(value)} />
              </Field>
            </View>
          </View>
          {errors.hours ? (
            <Text variant="small" tone="destructive" accessibilityRole="alert">
              {errors.hours}
            </Text>
          ) : null}
        </View>
      ) : null}

      {errors.form ? (
        <Text variant="small" tone="destructive" accessibilityRole="alert">
          {errors.form}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
        <Button label={t('app.hiring.save')} loading={save.isPending} disabled={hoursOn && !days.length} onPress={submit} />
        {saved ? (
          <Text variant="small" tone="success" accessibilityLiveRegion="polite">
            {t('app.hiring.saved')}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}
