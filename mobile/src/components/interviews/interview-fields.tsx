import { ScrollView, View } from 'react-native';
import { useLocale, useTranslations } from 'use-intl';
import { Chip } from '~/components/ui/chip';
import { Field } from '~/components/ui/field';
import { Select } from '~/components/ui/select';
import { INTERVIEW_TIMES, nextCairoDays } from '~/features/interviews/cairo-time';
import { space } from '~/theme/tokens';

const dayLabel = (day: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Cairo' }).format(
    new Date(`${day}T12:00:00Z`),
  );

/**
 * A day and a time, in Cairo time (decided for v1.1): the next two weeks as
 * chips — today and tomorrow named — and the working day's half hours. No
 * native date picker, so no new build is needed for it.
 */
export function InterviewTimeFields({
  now,
  day,
  time,
  onDay,
  onTime,
}: {
  now: number;
  day: string;
  time: string;
  onDay: (day: string) => void;
  onTime: (time: string) => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const days = nextCairoDays(new Date(now));
  return (
    <View style={{ gap: space[3] }}>
      <Field label={t('app.interview.day')}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space[2] }}>
          <View accessibilityRole="radiogroup" accessibilityLabel={t('app.interview.day')} style={{ flexDirection: 'row', gap: space[2] }}>
            {days.map((value, index) => (
              <Chip
                key={value}
                radio
                selected={value === day}
                label={index === 0 ? t('app.interview.today') : index === 1 ? t('app.interview.tomorrow') : dayLabel(value, locale)}
                accessibilityLabel={dayLabel(value, locale)}
                onPress={() => onDay(value)}
              />
            ))}
          </View>
        </ScrollView>
      </Field>
      <Field label={t('app.interview.time')} hint={t('app.interview.cairoTime')}>
        <Select
          label={t('app.interview.time')}
          value={time}
          placeholder={t('app.interview.time')}
          required
          options={INTERVIEW_TIMES.map((value) => ({ value, label: value }))}
          onChange={(value) => value && onTime(value)}
        />
      </Field>
    </View>
  );
}
