import { useState } from 'react';
import { Modal, Pressable, ScrollView, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';
import { dayOf } from '@/lib/admin/params';
import { westernDigits } from '@/lib/search/arabic';
import { FilterGroup } from '~/components/jobs/filter-sheet';
import { Button } from '~/components/ui/button';
import { Chip } from '~/components/ui/chip';
import { Field } from '~/components/ui/field';
import { X } from '~/components/ui/lucide';
import { useSheetFence } from '~/components/ui/sheet-fence';
import { Text } from '~/components/ui/text';
import { TextField } from '~/components/ui/text-field';
import { NO_FILTERS, REPORT_REASONS, SEVERITIES, type ReportFilters } from '~/features/admin/reports';
import { appDirection } from '~/lib/direction';
import { haptic } from '~/lib/haptics';
import { useGatedModal } from '~/lib/sheet-gate';
import { useTheme } from '~/theme/provider';
import { gutter, hitTarget, space } from '~/theme/tokens';

/**
 * The finer filters of the website's /admin/reports, as a sheet: the reason,
 * the severity, the days reported between (Cairo days, as the website counts
 * them), and — on the open views — whether more than one person reported.
 * Kept as a draft and applied in one go, as the board's filters are; a day
 * that is not one (the website's dayOf) is said so and not applied.
 *
 * Drawn once by the screen, never in a card: a card drawn again when its
 * queue is read again would take the sheet with it.
 */
export function ReportFilterSheet({
  visible,
  filters,
  grouped,
  onClose,
  onApply,
}: {
  visible: boolean;
  filters: ReportFilters;
  /** The open views: the repeat-reporters filter applies to cases only. */
  grouped: boolean;
  onClose: () => void;
  onApply: (next: ReportFilters) => void;
}) {
  const t = useTranslations();
  // The sheet keeps its touches from the screen under it (sheet-fence.ts).
  const fence = useSheetFence();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState(filters);
  const [from, setFrom] = useState(filters.from ?? '');
  const [to, setTo] = useState(filters.to ?? '');
  const [dayErrors, setDayErrors] = useState<{ from?: string; to?: string }>({});
  const [open, setOpen] = useState(visible);
  // Shown once no other sheet is still closing (a decision's, say): one asked for meanwhile was never shown.
  const gate = useGatedModal(visible, onClose);

  // Each time it opens, it starts from what the screen is showing.
  if (visible !== open) {
    setOpen(visible);
    if (visible) {
      setDraft(filters);
      setFrom(filters.from ?? '');
      setTo(filters.to ?? '');
      setDayErrors({});
    }
  }

  const typed = { ...draft, from: westernDigits(from).trim() || undefined, to: westernDigits(to).trim() || undefined };
  const anySet =
    typed.reason !== 'all' || typed.severity !== 'any' || Boolean(typed.from) || Boolean(typed.to) || (grouped && typed.repeat);

  const apply = () => {
    const errors: { from?: string; to?: string } = {};
    if (typed.from && !dayOf(typed.from)) errors.from = t('app.admin.reports.dayInvalid');
    if (typed.to && !dayOf(typed.to)) errors.to = t('app.admin.reports.dayInvalid');
    setDayErrors(errors);
    if (errors.from || errors.to) return;
    haptic.tap();
    onApply({ ...typed, repeat: grouped && typed.repeat, from: typed.from, to: typed.to });
  };

  const clear = () => {
    setDraft({ ...NO_FILTERS, type: draft.type });
    setFrom('');
    setTo('');
    setDayErrors({});
  };

  return (
    <Modal visible={gate.visible} onDismiss={gate.onDismiss} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, direction: appDirection, backgroundColor: colors.background }} {...fence}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: space[2],
            paddingHorizontal: gutter,
            paddingVertical: space[2],
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
            onPress={onClose}
            hitSlop={8}
            // The glyph, not its 44-point box, on the page's margin.
            style={{ minWidth: hitTarget, minHeight: hitTarget, marginStart: -(hitTarget - 22) / 2, alignItems: 'center', justifyContent: 'center' }}
          >
            <X size={22} color={colors.foreground} />
          </Pressable>
          <Text weight="semibold" accessibilityRole="header" style={{ flexShrink: 1, textAlign: 'center' }}>
            {t('admin.filtersLabel')}
          </Text>
          <View style={{ minWidth: hitTarget, alignItems: 'flex-end' }}>
            {anySet ? <Button label={t('admin.clearFilters')} variant="ghost" size="sm" onPress={clear} style={{ marginEnd: -space[4] }} /> : null}
          </View>
        </View>

        <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ padding: gutter, gap: space[6] }}>
          <FilterGroup title={t('admin.filterReason')} single>
            <Chip label={t('admin.anyReason')} radio selected={draft.reason === 'all'} onPress={() => setDraft({ ...draft, reason: 'all' })} />
            {REPORT_REASONS.map((reason) => (
              <Chip
                key={reason}
                label={t(`reportReason.${reason}`)}
                radio
                selected={draft.reason === reason}
                onPress={() => setDraft({ ...draft, reason })}
              />
            ))}
          </FilterGroup>

          <FilterGroup title={t('admin.filterSeverity')} single>
            {SEVERITIES.map((severity) => (
              <Chip
                key={severity}
                label={severity === 'any' ? t('admin.anySeverity') : severity === '3' ? t('admin.severityOnlyHigh') : t('admin.severityMediumUp')}
                radio
                selected={draft.severity === severity}
                onPress={() => setDraft({ ...draft, severity })}
              />
            ))}
          </FilterGroup>

          <View style={{ gap: space[3] }}>
            <Field label={t('admin.filterFrom')} error={dayErrors.from}>
              <TextField
                value={from}
                onChangeText={(next) => {
                  setFrom(next);
                  if (dayErrors.from) setDayErrors({ ...dayErrors, from: undefined });
                }}
                accessibilityLabel={t('admin.filterFrom')}
                placeholder={t('app.admin.reports.dayPlaceholder')}
                keyboardType="numbers-and-punctuation"
                autoCapitalize="none"
                autoCorrect={false}
                ltr
              />
            </Field>
            <Field label={t('admin.filterTo')} error={dayErrors.to}>
              <TextField
                value={to}
                onChangeText={(next) => {
                  setTo(next);
                  if (dayErrors.to) setDayErrors({ ...dayErrors, to: undefined });
                }}
                accessibilityLabel={t('admin.filterTo')}
                placeholder={t('app.admin.reports.dayPlaceholder')}
                keyboardType="numbers-and-punctuation"
                autoCapitalize="none"
                autoCorrect={false}
                ltr
              />
            </Field>
          </View>

          {grouped ? (
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: draft.repeat }}
              accessibilityLabel={t('admin.filterRepeat')}
              onPress={() => setDraft({ ...draft, repeat: !draft.repeat })}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3], minHeight: hitTarget }}
            >
              <Text variant="small" weight="medium" style={{ flex: 1 }}>
                {t('admin.filterRepeat')}
              </Text>
              <Switch
                value={draft.repeat}
                onValueChange={(repeat) => setDraft({ ...draft, repeat })}
                trackColor={{ true: colors.primary, false: colors.border }}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              />
            </Pressable>
          ) : null}
        </ScrollView>

        <View
          style={{
            paddingHorizontal: gutter,
            paddingTop: space[3],
            paddingBottom: Math.max(insets.bottom, space[4]),
            borderTopWidth: 1,
            borderTopColor: colors.border,
          }}
        >
          <Button label={t('admin.applyFilters')} size="lg" onPress={apply} />
        </View>
      </View>
    </Modal>
  );
}
