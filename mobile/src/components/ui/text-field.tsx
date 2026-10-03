import { forwardRef, useState, type ReactNode } from 'react';
import { I18nManager, TextInput, View, type TextInputProps } from 'react-native';
import { useTheme } from '~/theme/provider';
import { corner, font, hitTarget, space, type as scale } from '~/theme/tokens';

/**
 * The website's input, set for the phone: a field 50 points tall on the card
 * surface, its border drawn in ink while it has the cursor, the body size so
 * iOS never zooms, an optional mark at the start. Right to left with the rest
 * of the app — `textAlign: 'left'` is the logical start, as on Text.
 *
 * `ltr` is the website's `dir="ltr"` on an email, a password, a phone number
 * or a link: typed and read left to right, from the left edge, whatever the
 * language around it. (With the layout mirrored, the physical left is 'right'.)
 */
export const TextField = forwardRef<
  TextInput,
  TextInputProps & {
    leading?: ReactNode;
    ltr?: boolean;
    /** The focus ring's colour, where the brand colour is the surface around it (Home's panel). */
    focusColor?: string;
  }
>(function TextField({ leading, ltr = false, focusColor, style, onFocus, onBlur, ...props }, ref) {
  const { colors, scheme } = useTheme();
  const [focused, setFocused] = useState(false);
  const ring = focusColor ?? colors.primary;

  return (
    <View
      style={{
        minHeight: hitTarget + 6,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[2],
        paddingHorizontal: space[4] - 2,
        ...corner('lg'),
        borderWidth: 1,
        borderColor: focused ? ring : colors.input,
        backgroundColor: colors.card,
        // The focus ring: the border a little heavier, without moving the text.
        outlineWidth: focused ? 1 : 0,
        outlineColor: ring,
        outlineStyle: 'solid',
      }}
    >
      {leading}
      <TextInput
        ref={ref}
        placeholderTextColor={colors.mutedForeground}
        selectionColor={colors.primary}
        keyboardAppearance={scheme}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        {...props}
        style={[
          {
            flex: 1,
            minHeight: hitTarget,
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
