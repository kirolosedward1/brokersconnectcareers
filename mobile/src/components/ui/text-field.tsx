import { forwardRef, type ReactNode } from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';
import { useTheme } from '~/theme/provider';
import { font, hitTarget, radius, space, type as scale } from '~/theme/tokens';

/**
 * The website's input: a bordered field, 44 points tall, the body size so iOS
 * never zooms, an optional mark at the start. Right to left with the rest of
 * the app — `textAlign: 'left'` is the logical start, as on Text.
 */
export const TextField = forwardRef<TextInput, TextInputProps & { leading?: ReactNode }>(function TextField(
  { leading, style, ...props },
  ref,
) {
  const { colors, scheme } = useTheme();

  return (
    <View
      style={{
        minHeight: hitTarget,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[2],
        paddingHorizontal: space[3],
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colors.input,
        backgroundColor: colors.card,
      }}
    >
      {leading}
      <TextInput
        ref={ref}
        placeholderTextColor={colors.mutedForeground}
        selectionColor={colors.primary}
        keyboardAppearance={scheme}
        {...props}
        style={[
          {
            flex: 1,
            minHeight: hitTarget - 2,
            fontFamily: font.regular,
            fontSize: scale.body.fontSize,
            color: colors.foreground,
            textAlign: 'left',
            paddingVertical: 0,
          },
          style,
        ]}
      />
    </View>
  );
});
