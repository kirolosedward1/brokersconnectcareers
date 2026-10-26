import { createContext, useContext, type ReactNode, type Ref } from 'react';
import { View, type ViewInstance } from 'react-native';
import { CircleAlert } from '~/components/ui/lucide';
import { useTheme } from '~/theme/provider';
import { space } from '~/theme/tokens';
import { Text } from './text';

/**
 * What a Field tells the control inside it: the error under it, if any. A text
 * field or a select draws its edge in the error's colour while it is not being
 * typed in, and gives the error to VoiceOver as its hint — the website's
 * aria-invalid and aria-describedby — so a reader who moves to the field hears
 * what is wrong with it, not only one who happened to be on the message.
 */
const FieldContext = createContext<{ error: string | null } | null>(null);

/** The error of the Field around a control, or null. */
export function useFieldError(): string | null {
  return useContext(FieldContext)?.error ?? null;
}

/**
 * The website's Field: a label over its control, and under it either what
 * went wrong or a hint. A form brings its errors into view and says them
 * (src/lib/use-errors-in-view.ts), its `ref` being where the field is.
 *
 * The error is marked, not only coloured: a red line under a field reads as
 * one more line of text to somebody who cannot tell red apart.
 */
export function Field({
  ref,
  label,
  hint,
  error,
  children,
}: {
  ref?: Ref<ViewInstance>;
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  const { colors } = useTheme();
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
      <FieldContext.Provider value={{ error: error || null }}>{children}</FieldContext.Provider>
      {error ? (
        <View
          accessible
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          accessibilityLabel={error}
          style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[1.5] }}
        >
          {/* Level with the first line of the words, however many there are. */}
          <View style={{ marginTop: 3 }}>
            <CircleAlert size={14} color={colors.destructive} strokeWidth={2.25} />
          </View>
          <Text variant="caption" tone="destructive" style={{ flexShrink: 1 }}>
            {error}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
