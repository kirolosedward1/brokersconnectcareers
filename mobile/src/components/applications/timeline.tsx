import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocale, useTranslations } from 'use-intl';
import { formatDayMonth } from '@/lib/format';
import type { ApplicationStatus } from '@/lib/supabase/database.types';
import { Appear } from '~/components/motion/appear';
import { Pulse } from '~/components/motion/pulse';
import { Check, X } from '~/components/ui/lucide';
import { Text } from '~/components/ui/text';
import { useLargeText } from '~/theme/large-text';
import { useTheme } from '~/theme/provider';

import { timelineSteps, type TimelineStep } from '@/lib/application-stages';

/** The steps' rule is the website's own (src/lib/application-stages.ts). */
export { timelineSteps, type StepState, type TimelineStep } from '@/lib/application-stages';

/** The steps drawn in a row, in the reading's direction: a mark on a line, its name under it. */
export function ApplicationTimeline({
  application,
}: {
  application: { status: ApplicationStatus; created_at: string; employer_viewed_at: string | null };
}) {
  const large = useLargeText();
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const steps = timelineSteps(application);

  const name = (step: TimelineStep) => {
    switch (step.key) {
      case 'sent':
        return t('myApplications.stepSent');
      case 'seen':
        return t('myApplications.stepSeen');
      case 'shortlisted':
        return application.status === 'interview' ? t('applicationStatus.interview') : t('applicationStatus.shortlisted');
      case 'decision':
        return application.status === 'hired'
          ? t('applicationStatus.hired')
          : application.status === 'rejected'
            ? t('applicationStatus.rejected')
            : t('myApplications.stepDecision');
    }
  };

  const spoken = steps
    .filter((step) => step.state === 'done' || step.state === 'stopped')
    .map((step) => name(step))
    .join(' · ');

  return (
    <View
      accessible
      accessibilityLabel={`${t('myApplications.timeline')}: ${spoken}`}
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
              {/* Reached steps fill in one after another; the one it waits at breathes. */}
              <Appear from="none" scale={reached ? 0.4 : 1} delay={index * 140} duration={360}>
                <Breathing on={step.state === 'current'}>
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
                </Breathing>
              </Appear>
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
              numberOfLines={large ? undefined : 2}
              style={{ textAlign: 'center' }}
            >
              {name(step)}
            </Text>
            {step.date && reached ? (
              <Text variant="caption" tone="mutedForeground" numberOfLines={large ? undefined : 1} style={{ textAlign: 'center' }}>
                {formatDayMonth(step.date, locale)}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/** The step an application waits at, softly pulsing; any other, as it is. */
function Breathing({ on, children }: { on: boolean; children: ReactNode }) {
  return on ? <Pulse>{children}</Pulse> : children;
}

const styles = StyleSheet.create({
  line: { flex: 1, height: 2 },
});
