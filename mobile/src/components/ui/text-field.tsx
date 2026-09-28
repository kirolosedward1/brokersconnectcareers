import { forwardRef, type ReactNode } from 'react';
import { I18nManager, TextInput, View, type TextInputProps } from 'react-native';
import { useTheme } from '~/theme/provider';
import { font, hitTarget, radius, space, type as scale } from '~/theme/tokens';

/**
 * The website's input: a bordered field, 44 points tall, the body size so iOS
 * never zooms, an optional mark at the start. Right to left with the rest of
 * the app — `textAlign: 'left'` is the logical start, as on Text.
 *
 * `ltr` is the website's `dir="ltr"` on an email, a password, a phone number
 * or a link: typed and read left to right, from the left edge, whatever the
 * language around it. (With the layout mirrored, the physical left is 'right'.)
 */
export const TextField = forwardRef<TextInput, TextInputProps & { leading?: ReactNode; ltr?: boolean }>(function TextField(
  { leading, ltr = false, style, ...props },
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
            textAlign: ltr && I18nManager.isRTL ? 'right' : 'left',
            writingDirection: ltr ? 'ltr' : undefined,
            paddingVertical: 0,
          },
          style,
        ]}
      />
    </View>
  );
});
