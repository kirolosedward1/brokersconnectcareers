import type { ReactNode } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useLocale, useTranslations } from 'use-intl';
import { formatNumber } from '@/lib/format';
import { localized } from '@/lib/locale';
import type { CompanySignal, CompanySignals, SafetyFlag, SignalCompanyRef } from '@/lib/supabase/database.types';
import { Badge } from '~/components/ui/badge';
import { AlertTriangle } from '~/components/ui/lucide';
import { Text } from '~/components/ui/text';
import { isolate } from '~/i18n/rich';
import { useTheme } from '~/theme/provider';
import { space } from '~/theme/tokens';

/**
 * What the console shows a moderator beside a decision (migrations 326–327)
 * — the website's safety.tsx, on the phone.
 *
 * Every line here is a fact to weigh, worded as one: "mentions a registration
 * fee", "shares a WhatsApp number with…", never "scammer" or "fraudulent".
 * None of it decides anything and none of it is ever shown outside the
 * console — the patterns behind it are exactly what a scam would like to read.
 */

/** The high-weight flags as one short label, for a list's row (the website's FlagCount). */
export function FlagCount({ flags }: { flags: SafetyFlag[] }) {
  const t = useTranslations('admin');
  const locale = useLocale();
  const { colors } = useTheme();
  const high = flags.filter((flag) => flag.weight === 'high');
  if (!high.length) return null;
  return (
    <Badge
      variant="warning"
      icon={<AlertTriangle size={12} color={colors.warning} />}
      label={t('flagsCount', { count: formatNumber(high.length, locale) })}
    />
  );
}

/** The companies a signal names, the first five, each a link to its page; a suspended one says so. */
function Companies({ refs }: { refs: SignalCompanyRef[] }) {
  const t = useTranslations('admin');
  const locale = useLocale();
  return (
    <>
      {refs.slice(0, 5).map((ref, index) => (
        <Text key={ref.id} variant="small">
          {index ? t('listSeparator') : ' '}
          <Text
            variant="small"
            tone="primary"
            weight="medium"
            accessibilityRole="link"
            onPress={() => router.push({ pathname: '/admin/companies/[id]', params: { id: ref.id } })}
          >
            {localized(locale, ref.name_ar, ref.name_en)}
          </Text>
          {ref.suspended ? (
            <Text variant="small" tone="destructive">
              {` (${t('suspended')})`}
            </Text>
          ) : null}
        </Text>
      ))}
    </>
  );
}

/**
 * A company's raised signals, one sentence each — the website's
 * CompanySignalList. Only the raised ones: a list of everything that is fine
 * is a list nobody reads to the end. Numbers are isolated left to right
 * inside the Arabic sentences.
 */
export function CompanySignalList({ signals, empty = false }: { signals: CompanySignals | null; empty?: boolean }) {
  const t = useTranslations('admin');
  const locale = useLocale();
  const { colors } = useTheme();
  const list = signals?.signals ?? [];
  const n = (value: number) => isolate(formatNumber(value, locale));

  if (list.length === 0) {
    return empty ? (
      <Text variant="small" tone="mutedForeground">
        {t('signalsNone')}
      </Text>
    ) : null;
  }

  const line = (signal: CompanySignal): ReactNode => {
    switch (signal.signal) {
      case 'mass_posting':
        return t('signal.mass_posting', { day: n(signal.day), week: n(signal.week) });
      case 'rejections':
        return t('signal.rejections', { count: n(signal.count) });
      case 'duplicate_listings':
        return t('signal.duplicate_listings', { count: n(signal.count) });
      case 'copied_listings':
        return (
          <>
            {t('signal.copied_listings')}
            <Companies refs={signal.companies} />
          </>
        );
      case 'reported':
        return t('signal.reported', { reporters: n(signal.reporters), reports: n(signal.reports) });
      case 'company_text':
        return t('signal.company_text', { flags: signal.flags.map((flag) => t(`flag.${flag.flag}`)).join(t('listSeparator')) });
      case 'flagged_listings':
        return t('signal.flagged_listings', { count: n(signal.count) });
      case 'shared_phone':
        return (
          <>
            {t('signal.shared_phone')}
            <Companies refs={signal.companies} />
          </>
        );
      case 'phone_of_suspended_account':
        return t('signal.phone_of_suspended_account', { count: n(signal.count) });
      case 'shared_website':
        return (
          <>
            {t('signal.shared_website', { site: signal.site })}
            <Companies refs={signal.companies} />
          </>
        );
      default:
        return null;
    }
  };

  return (
    <View style={{ gap: space[1] }}>
      {list.map((signal) => (
        <View key={signal.signal} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[2] }}>
          <AlertTriangle size={14} color={colors.warning} style={{ marginTop: 4 }} />
          <Text variant="small" style={{ flex: 1 }}>
            {line(signal)}
          </Text>
        </View>
      ))}
    </View>
  );
}
