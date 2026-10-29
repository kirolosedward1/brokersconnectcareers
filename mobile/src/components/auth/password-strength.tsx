import { View } from 'react-native';
import { useTranslations } from 'use-intl';
import { PASSWORD_MIN } from '~/lib/password-checks';
import { Text } from '~/components/ui/text';
import { useTheme } from '~/theme/provider';
import { corner, space } from '~/theme/tokens';

const LEVELS = ['weak', 'fair', 'good', 'strong'] as const;

/**
 * How strong a new password is, 1 to 4: long enough, then each of a digit,
 * a symbol or a capital, and a long one. A guide while typing, never a rule:
 * the website's rule is the length alone, checked when it is sent.
 */
export function passwordStrength(password: string): number {
  if (!password) return 0;
  let score = password.length >= PASSWORD_MIN ? 1 : 0;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password) || /[A-Z]/.test(password)) score += 1;
  if (password.length >= 12) score += 1;
  return Math.max(1, Math.min(score, 4));
}

/** Four bars under the password, as the design draws them, and the hint until it is strong. One line to VoiceOver. */
export function PasswordStrength({ password }: { password: string }) {
  const t = useTranslations('app.auth');
  const { colors } = useTheme();
  const score = passwordStrength(password);
  if (!score) return null;
  const level = t(`strength.${LEVELS[score - 1]}`);
  const tone = score <= 1 ? colors.destructive : score === 2 ? colors.warning : colors.success;
  return (
    <View accessible accessibilityLabel={t('strengthLabel', { level })} style={{ gap: space[1.5] }}>
      <View style={{ flexDirection: 'row', gap: space[1] }}>
        {LEVELS.map((name, index) => (
          <View key={name} style={{ flex: 1, height: 4, ...corner('full'), backgroundColor: index < score ? tone : colors.border }} />
        ))}
      </View>
      {score < 3 ? (
        <Text variant="caption" tone="mutedForeground">
          {t('strengthHint')}
        </Text>
      ) : null}
    </View>
  );
}
