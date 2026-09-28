import type { ReactNode } from 'react';
import { View } from 'react-native';
import { space } from '~/theme/tokens';
import { Text } from './text';

/**
 * The website's Field: a label over its control, and under it either what
 * went wrong or a hint. The error is announced as it appears.
 */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <View style={{ gap: space[1] }}>
      <Text variant="small" weight="medium">
        {label}
        {hint ? (
          <Text variant="caption" tone="mutedForeground">
            {` · ${hint}`}
          </Text>
        ) : null}
      </Text>
      {children}
      {error ? (
        <Text variant="caption" tone="destructive" accessibilityLiveRegion="polite" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
