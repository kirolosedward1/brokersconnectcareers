import { forwardRef, useId, useState, type ReactNode } from 'react';
import { InputAccessoryView, Keyboard, Platform, StyleSheet, TextInput, View, type TextInputInstance, type TextInputProps } from 'react-native';
import { useTranslations } from 'use-intl';
import { appDirection } from '~/lib/direction';
import { useTheme } from '~/theme/provider';
import { corner, font, gutter, hitTarget, space, type as scale } from '~/theme/tokens';
import { useFieldError } from './field';
import { PressableScale } from './pressable-scale';
import { Text } from './text';

/** The keyboards iOS draws without a return key: nothing on them puts them away. */
const NO_RETURN_KEY = new Set<TextInputProps['keyboardType']>(['number-pad', 'phone-pad', 'decimal-pad', 'numeric']);

/**
 * The website's input, set for the phone: a field 50 points tall on the card
 * surface, its border drawn in ink while it has the cursor, the body size so
 * iOS never zooms, an optional mark at the start and a control at the end
 * (`trailing`: a password's eye). Right to left with the rest of the app: what
 * is typed starts at the right edge.
 *
 * Inside a Field with an error its edge is the error's colour while it is not
 * being typed in, and VoiceOver hears the error as the field's hint.
 *
 * `ltr` is the website's `dir="ltr"` on an email, a password, a phone number
 * or a link: typed and read left to right, from the left edge, whatever the
 * language around it.
 *
 * A field's alignment is the physical edge. React Native does not mirror what
 * is typed into a field, so Arabic is aligned to the right explicitly, and an
 * email or a password stays on the left. Labels use I18nManager's own flip.
 *
 * The keyboard is always a press away from going: a line's return key says
 * "done" unless the form gives it another word ("next", "search"), and the
 * number and phone pads, which have no return key on iOS, carry a Done above
 * them.
 */
export const TextField = forwardRef<
  TextInputInstance,
  TextInputProps & {
    leading?: ReactNode;
    trailing?: ReactNode;
    ltr?: boolean;
    /** The focus ring's colour, where the brand colour is the surface around it (Home's panel). */
    focusColor?: string;
  }
>(function TextField({ leading, trailing, ltr = false, focusColor, style, onFocus, onBlur, ...props }, ref) {
  const { colors, scheme } = useTheme();
  const error = useFieldError();
  const [focused, setFocused] = useState(false);
  const ring = focusColor ?? colors.primary;
  const accessory = `done-${useId()}`;
  const padWithoutReturn = Platform.OS === 'ios' && !props.multiline && NO_RETURN_KEY.has(props.keyboardType);

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
        borderColor: focused ? ring : error ? colors.destructive : colors.input,
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
        returnKeyType={props.multiline ? undefined : 'done'}
        accessibilityHint={error ?? undefined}
        inputAccessoryViewID={padWithoutReturn ? accessory : undefined}
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
            // The web's default min width is the text's own width, so a long
            // field pushes the eye past the screen (the input wider than the row).
            minWidth: 0,
            minHeight: hitTarget,
            fontFamily: font.regular,
            fontSize: scale.body.fontSize,
            color: colors.foreground,
            textAlign: !ltr && appDirection === 'rtl' ? 'right' : 'left',
            writingDirection: ltr ? 'ltr' : undefined,
            paddingVertical: 0,
          },
          style,
        ]}
      />
      {trailing}
      {padWithoutReturn ? <DoneAccessory id={accessory} /> : null}
    </View>
  );
});

/**
 * The Done above a number or phone pad: at the end of the reading line, a
 * capsule on the card surface floating over the page, as iOS's own bars float
 * over the keyboard. Pressing it puts the keyboard away.
 */
function DoneAccessory({ id }: { id: string }) {
  const t = useTranslations('app');
  const { colors, shadow } = useTheme();
  return (
    <InputAccessoryView nativeID={id} backgroundColor="transparent">
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: gutter, paddingVertical: space[2] }}>
        <PressableScale
          accessibilityRole="button"
          onPress={() => Keyboard.dismiss()}
          hitSlop={4}
          style={({ pressed }) => ({
            minHeight: 36,
            paddingHorizontal: space[4],
            justifyContent: 'center',
            ...corner('full'),
            borderWidth: StyleSheet.hairlineWidth * 2,
            borderColor: colors.border,
            backgroundColor: pressed ? colors.muted : colors.card,
            boxShadow: shadow.card,
          })}
        >
          <Text variant="small" weight="semibold" tone="primary" maxFontSizeMultiplier={1.6}>
            {t('keyboard.done')}
          </Text>
        </PressableScale>
      </View>
    </InputAccessoryView>
  );
}
