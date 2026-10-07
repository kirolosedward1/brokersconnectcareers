import type { ReactNode, Ref } from 'react';
import { View } from 'react-native';
import { space } from '~/theme/tokens';
import { Text } from './text';

/**
 * The website's Field: a label over its control, and under it either what
 * went wrong or a hint. A form brings its errors into view and says them
 * (src/lib/use-errors-in-view.ts), its `ref` being where the field is.
 */
export function Field({
  ref,
  label,
  hint,
  error,
  children,
}: {
  ref?: Ref<View>;
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <View ref={ref} style={{ gap: space[1] }}>
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
