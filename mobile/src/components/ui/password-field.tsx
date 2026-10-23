import { forwardRef, useState } from 'react';
import { Pressable, type TextInput, type TextInputProps, type TextInputInstance } from 'react-native';
import { useTranslations } from 'use-intl';
import { Eye, EyeOff } from '~/components/ui/lucide';
import { useTheme } from '~/theme/provider';
import { hitTarget, space } from '~/theme/tokens';
import { TextField } from './text-field';

/**
 * A password, typed left to right and hidden — with an eye at its end that
 * shows what was typed and hides it again. On a phone a mistyped character
 * cannot be seen and costs a refused sign-in, or a new password nobody can
 * repeat; the website leaves this to the browser, the phone has no such help.
 *
 * Hidden again whenever the field is left, so a password shown for a moment
 * does not stay on the screen.
 */
export const PasswordField = forwardRef<TextInputInstance, Omit<TextInputProps, 'secureTextEntry'>>(function PasswordField(
  { onBlur, ...props },
  ref,
) {
  const t = useTranslations('app.auth');
  const { colors } = useTheme();
  const [shown, setShown] = useState(false);
  const Icon = shown ? EyeOff : Eye;

  return (
    <TextField
      ref={ref}
      ltr
      autoCapitalize="none"
      autoCorrect={false}
      spellCheck={false}
      {...props}
      secureTextEntry={!shown}
      onBlur={(event) => {
        setShown(false);
        onBlur?.(event);
      }}
      trailing={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={shown ? t('hidePassword') : t('showPassword')}
          onPress={() => setShown((now) => !now)}
          // The glyph, not its 44-point box, on the field's inner margin.
          style={({ pressed }) => ({
            width: hitTarget,
            height: hitTarget,
            marginEnd: -space[3],
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.55 : 1,
          })}
        >
          <Icon size={20} color={colors.mutedForeground} strokeWidth={1.75} />
        </Pressable>
      }
    />
  );
});
