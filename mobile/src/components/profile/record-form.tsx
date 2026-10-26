import { useState } from 'react';
import { View } from 'react-native';
import { useLocale, useTranslations } from 'use-intl';
import { Building2, TrendingUp } from '~/components/ui/lucide';
import { formatNumber } from '@/lib/format';
import type { AgentProfileRow } from '@/lib/supabase/database.types';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { Field } from '~/components/ui/field';
import { Text } from '~/components/ui/text';
import { TextField } from '~/components/ui/text-field';
import { useSaveRecord } from '~/features/profile/queries';
import { useLeaveGuard } from '~/lib/use-leave-guard';
import { useStoredFields } from '~/lib/use-stored-fields';
import { useTheme } from '~/theme/provider';
import { corner, space } from '~/theme/tokens';
import { wholeNumber } from './fields';
import { useAnnounce } from '~/lib/use-announce';

/**
 * The objective and the sales record — the website's ProfileRecordForm: the
 * two things at the top of a real-estate CV, with how complete the profile
 * is beside them. The figures are the consultant's own word, and the card
 * says so.
 */
export function RecordForm({ agent, completeness }: { agent: AgentProfileRow; completeness: number | null }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const save = useSaveRecord();

  // Kept up with the profile as it is stored (changed on the website, or by
  // another phone, while this screen stayed open), without touching what is
  // being typed: filled once, the next save sent the old figures back.
  const form = useStoredFields({
    summary: agent.summary_ar ?? '',
    units: agent.units_closed == null ? '' : String(agent.units_closed),
    volume: agent.volume_egp == null ? '' : String(agent.volume_egp),
  });
  const { summary, units, volume } = form.fields;
  const [invalid, setInvalid] = useState(false);
  // Said to VoiceOver too: a live region is Android's alone.
  useAnnounce(t('common.saveSuccess'), save.isSuccess && !invalid);

  // Leaving with the record changed and not saved asks first.
  useLeaveGuard(form.dirty, save.isPending);

  const percent = completeness ?? 0;

  const submit = () => {
    const unitsClosed = wholeNumber(units);
    const volumeEgp = wholeNumber(volume);
    const bad = (value: number | null, max: number) => value !== null && (!Number.isInteger(value) || value > max);
    if (bad(unitsClosed, 100000) || bad(volumeEgp, Number.MAX_SAFE_INTEGER)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    const sending = form.fields;
    save.mutate({ summaryAr: summary.trim() || null, unitsClosed, volumeEgp }, { onSuccess: () => form.saved(sending) });
  };

  return (
    <Card style={{ gap: space[4] }}>
      <View style={{ flexDirection: 'row', gap: space[3] }}>
        <View
          style={{
            width: 40,
            height: 40,
            // The app's icon tile: a rounded square, not a disc.
            ...corner('md'),
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.muted,
          }}
        >
          <TrendingUp size={20} color={colors.mutedForeground} />
        </View>
        <View style={{ flex: 1 }}>
          <Text weight="semibold" accessibilityRole="header">
            {t('cv.record')}
          </Text>
          <Text variant="small" tone="mutedForeground">
            {t('cv.recordLede')}
          </Text>
        </View>
      </View>

      {completeness !== null ? (
        <View style={{ gap: space[1] }}>
          <Text variant="small" weight="medium">
            {`${t('cv.completeness')} · ${formatNumber(percent, locale)}%`}
          </Text>
          <View
            accessibilityRole="progressbar"
            accessibilityLabel={t('cv.completeness')}
            accessibilityValue={{ min: 0, max: 100, now: percent }}
            style={{ height: 8, ...corner('full'), overflow: 'hidden', backgroundColor: colors.muted }}
          >
            <View style={{ width: `${percent}%`, height: '100%', ...corner('full'), backgroundColor: colors.primary }} />
          </View>
        </View>
      ) : null}

      <Field label={t('cv.objective')} hint={t('cv.objectiveHint')}>
        <TextField
          value={summary}
          onChangeText={(text) => form.set({ summary: text })}
          accessibilityLabel={t('cv.objective')}
          multiline
          maxLength={1200}
          style={{ minHeight: 112, paddingVertical: space[2], textAlignVertical: 'top' }}
        />
      </Field>

      <Field label={t('cv.unitsClosed')}>
        <TextField value={units} onChangeText={(text) => form.set({ units: text })} accessibilityLabel={t('cv.unitsClosed')} ltr keyboardType="number-pad" />
      </Field>

      <Field label={t('cv.volumeEgp')}>
        <TextField value={volume} onChangeText={(text) => form.set({ volume: text })} accessibilityLabel={t('cv.volumeEgp')} ltr keyboardType="number-pad" />
      </Field>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[3] }}>
        <Button label={t('common.save')} size="sm" loading={save.isPending} onPress={submit} />
        {save.isSuccess && !invalid ? (
          <Text variant="small" tone="success" accessibilityLiveRegion="polite">
            {t('common.saveSuccess')}
          </Text>
        ) : null}
        {invalid || save.isError ? (
          <Text variant="small" tone="destructive" accessibilityRole="alert">
            {invalid ? t('app.profile.numberInvalid') : t('common.errorBody')}
          </Text>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[1] }}>
        <Building2 size={14} color={colors.mutedForeground} />
        <Text variant="caption" tone="mutedForeground" style={{ flex: 1 }}>
          {t('cv.recordHint')}
        </Text>
      </View>
    </Card>
  );
}
