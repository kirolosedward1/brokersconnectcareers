import type { ReactNode, Ref } from 'react';
import { Pressable, StyleSheet, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';
import { AuthScroll } from '~/components/auth/auth-scroll';
import { Appear, type AppearFrom } from '~/components/motion/appear';
import { BackChevron } from '~/components/ui/icons';
import { PressableScale } from '~/components/ui/pressable-scale';
import { Text } from '~/components/ui/text';
import { useLargeText } from '~/theme/large-text';
import { useTheme } from '~/theme/provider';
import { corner, gutter, hitTarget, motion, space } from '~/theme/tokens';

/**
 * One step of onboarding as the design draws it (Onboarding, OnbCandidate2–3,
 * OnbCompany1–3): along the top a way back, the three steps as three bars,
 * and — where a step may be passed over — «تخطَّ» at the end; under it
 * whose steps these are and which one ("للمرشّحين · 1 من 3"), the question
 * in the screen's title size and a sentence under it; the step's own
 * questions; and, held at the foot of the screen, its one button with a line
 * under it. The bars are one progress bar to VoiceOver, named by the step.
 */
export function StepFrame({
  scrollRef,
  stepKey,
  arriving,
  position,
  eyebrow,
  title,
  body,
  onBack,
  skip,
  children,
  action,
  footnote,
  busy,
}: {
  scrollRef: Ref<ScrollViewInstance>;
  /** Keyed by the step: each one arrives on its own. */
  stepKey: string;
  arriving: AppearFrom;
  /** Which of the steps this is, counted from 1, and how many there are; none on a step outside the count (the kind of account). */
  position: { current: number; total: number; label: string } | null;
  eyebrow: string | null;
  title: string;
  body?: string | null;
  onBack?: () => void;
  skip?: { label: string; onPress: () => void } | null;
  children: ReactNode;
  action: ReactNode;
  footnote?: ReactNode;
  busy: boolean;
}) {
  const t = useTranslations();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const large = useLargeText();

  return (
    <View testID="onboarding" style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ paddingTop: insets.top + space[2], paddingHorizontal: gutter, paddingBottom: space[2] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: hitTarget }}>
          <View style={{ width: hitTarget }}>
            {onBack ? (
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={t('common.back')}
                onPress={onBack}
                disabled={busy}
                style={({ pressed }) => ({
                  width: hitTarget,
                  height: hitTarget,
                  alignItems: 'center',
                  justifyContent: 'center',
                  ...corner('full'),
                  borderWidth: StyleSheet.hairlineWidth * 2,
                  borderColor: colors.border,
                  backgroundColor: pressed ? colors.muted : colors.card,
                })}
              >
                <BackChevron size={20} color={colors.primary} />
              </PressableScale>
            ) : null}
          </View>
          {position ? (
            <View
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel={position.label}
              accessibilityValue={{ min: 0, max: position.total, now: position.current }}
              style={{ flex: 1, flexDirection: 'row', gap: space[1.5] }}
            >
              {Array.from({ length: position.total }, (_, index) => (
                <View
                  key={index}
                  style={{
                    flex: 1,
                    height: 4,
                    ...corner('full'),
                    backgroundColor: index < position.current ? colors.primary : colors.border,
                  }}
                />
              ))}
            </View>
          ) : (
            <View style={{ flex: 1 }} />
          )}
          <View style={{ minWidth: hitTarget, alignItems: 'flex-end' }}>
            {skip ? (
              <Pressable
                accessibilityRole="button"
                onPress={skip.onPress}
                disabled={busy}
                hitSlop={8}
                style={{ minHeight: hitTarget, justifyContent: 'center' }}
              >
                <Text variant="small" weight="medium" tone="mutedForeground">
                  {skip.label}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>

      <AuthScroll ref={scrollRef}>
        <Appear key={stepKey} from={arriving} distance={28} duration={motion.step} style={{ gap: space[6] }}>
          <View style={{ gap: space[2] }}>
            {eyebrow ? (
              <Text variant="caption" weight="semibold" tone="primary">
                {eyebrow}
              </Text>
            ) : null}
            <Text variant="screen" weight="bold" accessibilityRole="header">
              {title}
            </Text>
            {body ? (
              <Text variant="small" tone="mutedForeground">
                {body}
              </Text>
            ) : null}
          </View>
          {children}
          {/* At the largest sizes the button stays in the flow, under its questions: held at the foot it would take half the screen. */}
          {large ? (
            <View style={{ gap: space[2] }}>
              {action}
              {footnote}
            </View>
          ) : null}
        </Appear>
      </AuthScroll>

      {large ? null : (
        <View
          style={{
            paddingHorizontal: gutter,
            paddingTop: space[3],
            paddingBottom: Math.max(insets.bottom, space[4]),
            gap: space[2],
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: colors.border,
            backgroundColor: colors.card,
          }}
        >
          {action}
          {footnote}
        </View>
      )}
    </View>
  );
}

/** A question inside a step, and its answers under it. */
export function StepSection({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <View style={{ gap: space[3] }}>
      <View style={{ gap: space[0.5] }}>
        <Text weight="semibold">{title}</Text>
        {hint ? (
          <Text variant="caption" tone="mutedForeground">
            {hint}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}
