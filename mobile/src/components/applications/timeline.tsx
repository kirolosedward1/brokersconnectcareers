import { StyleSheet, View } from 'react-native';
import { useLocale, useTranslations } from 'use-intl';
import { formatDayMonth } from '@/lib/format';
import type { ApplicationStatus } from '@/lib/supabase/database.types';
import { Check, X } from '~/components/ui/lucide';
import { Text } from '~/components/ui/text';
import { useTheme } from '~/theme/provider';
import { space } from '~/theme/tokens';

export type StepState = 'done' | 'current' | 'ahead' | 'stopped';
export type TimelineStep = { key: 'sent' | 'seen' | 'shortlisted' | 'decision'; state: StepState; date: string | null };

/**
 * Where an application stands, as four steps: sent, seen by the company,
 * shortlisted (or called to an interview), and the decision. A step is done
 * once the application has passed it — a status past "new" means somebody at
 * the company opened it, whether or not the opening was recorded — and a
 * rejection ends the line where it happened, marked as such rather than as a
 * step skipped.
 */
export function timelineSteps(application: {
  status: ApplicationStatus;
  created_at: string;
  employer_viewed_at: string | null;
}): TimelineStep[] {
  const { status } = application;
  const seen = status !== 'new' || Boolean(application.employer_viewed_at);
  const shortlisted = status === 'shortlisted' || status === 'interview' || status === 'hired';
  const decided = status === 'hired' || status === 'rejected';
  return [
    { key: 'sent', state: 'done', date: application.created_at },
    { key: 'seen', state: seen ? 'done' : 'current', date: application.employer_viewed_at },
    {
      key: 'shortlisted',
      state: shortlisted ? 'done' : status === 'rejected' ? 'ahead' : seen ? 'current' : 'ahead',
      date: null,
    },
    { key: 'decision', state: status === 'rejected' ? 'stopped' : decided ? 'done' : shortlisted ? 'current' : 'ahead', date: null },
  ];
}

/** The steps drawn in a row, in the reading's direction: a mark on a line, its name under it. */
export function ApplicationTimeline({
  application,
}: {
  application: { status: ApplicationStatus; created_at: string; employer_viewed_at: string | null };
}) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const steps = timelineSteps(application);

  const name = (step: TimelineStep) => {
    switch (step.key) {
      case 'sent':
        return t('app.applications.stepSent');
      case 'seen':
        return t('app.applications.stepSeen');
      case 'shortlisted':
        return application.status === 'interview' ? t('applicationStatus.interview') : t('applicationStatus.shortlisted');
      case 'decision':
        return application.status === 'hired'
          ? t('applicationStatus.hired')
          : application.status === 'rejected'
            ? t('applicationStatus.rejected')
            : t('app.applications.stepDecision');
    }
  };

  const spoken = steps
    .filter((step) => step.state === 'done' || step.state === 'stopped')
    .map((step) => name(step))
    .join(' · ');

  return (
    <View
      accessible
      accessibilityLabel={`${t('app.applications.timeline')}: ${spoken}`}
      testID="application-timeline"
      style={{ flexDirection: 'row' }}
    >
      {steps.map((step, index) => {
        const reached = step.state === 'done' || step.state === 'stopped';
        const tint = step.state === 'stopped' ? colors.destructive : reached ? colors.success : step.state === 'current' ? colors.primary : colors.border;
        return (
          <View key={step.key} style={{ flex: 1, alignItems: 'center', gap: 4 }} testID={`step-${step.key}-${step.state}`}>
            <View style={{ alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center' }}>
              <View style={[styles.line, { backgroundColor: index === 0 ? 'transparent' : step.state === 'ahead' ? colors.border : tint }]} />
              <View
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 10,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: reached ? tint : colors.card,
                  borderWidth: reached ? 0 : 2,
                  borderColor: tint,
                }}
              >
                {step.state === 'done' ? <Check size={12} color="#FFFFFF" strokeWidth={3} /> : null}
                {step.state === 'stopped' ? <X size={12} color="#FFFFFF" strokeWidth={3} /> : null}
              </View>
              <View
                style={[
                  styles.line,
                  { backgroundColor: index === steps.length - 1 ? 'transparent' : steps[index + 1].state === 'ahead' ? colors.border : steps[index + 1].state === 'stopped' ? colors.destructive : steps[index + 1].state === 'current' ? colors.primary : colors.success },
                ]}
              />
            </View>
            <Text
              variant="caption"
              weight={step.state === 'current' ? 'semibold' : 'medium'}
              tone={reached || step.state === 'current' ? 'foreground' : 'mutedForeground'}
              numberOfLines={2}
              style={{ textAlign: 'center' }}
            >
              {name(step)}
            </Text>
            {step.date && reached ? (
              <Text variant="caption" tone="mutedForeground" numberOfLines={1} style={{ textAlign: 'center' }}>
                {formatDayMonth(step.date, locale)}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  line: { flex: 1, height: 2 },
});
