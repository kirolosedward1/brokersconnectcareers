import { Pressable } from 'react-native';
import { Stack } from 'expo-router';
import { X } from 'lucide-react-native';
import { useTranslations } from 'use-intl';
import { useStackOptions } from '~/components/navigation/stack-options';
import { useTheme } from '~/theme/provider';
import { hitTarget } from '~/theme/tokens';

/**
 * The sign-in sheet: sign in, create an account, forgotten password and the
 * new password a reset link leads to, in one stack presented over whatever
 * the reader was doing. Its first screen has a close button; the ones pushed
 * after it go back. Signing in closes the whole sheet (useCloseFlow), and
 * what was under it — a listing, the board — is still there.
 */
export default function AuthLayout() {
  const options = useStackOptions();

  return (
    <Stack
      screenOptions={({ navigation, route }) => {
        const first = navigation.getState()?.routes[0]?.key === route.key;
        return {
          ...options,
          title: '',
          headerLeft: first ? () => <CloseSheet onPress={() => navigation.getParent()?.goBack()} /> : undefined,
        };
      }}
    />
  );
}

function CloseSheet({ onPress }: { onPress: () => void }) {
  const t = useTranslations('common');
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('close')}
      onPress={onPress}
      hitSlop={8}
      style={{ minWidth: hitTarget, minHeight: hitTarget, alignItems: 'center', justifyContent: 'center' }}
    >
      <X size={22} color={colors.foreground} />
    </Pressable>
  );
}
