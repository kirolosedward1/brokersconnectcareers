import { useCallback } from 'react';
import { Alert } from 'react-native';
import { useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useTranslations } from 'use-intl';

/**
 * Asks before throwing away what was typed. What a form holds lives in the
 * screen alone, and a Back, a swipe from the edge or a sheet pulled down took
 * a listing's eight thousand characters with it, unasked.
 */
export function useConfirmDiscard() {
  const t = useTranslations();
  return useCallback(
    (discard: () => void) =>
      Alert.alert(t('app.leave.title'), t('app.leave.body'), [
        { text: t('app.leave.stay'), style: 'cancel' },
        { text: t('app.leave.discard'), style: 'destructive', onPress: discard },
      ]),
    [t],
  );
}

/** The same question for leaving the screen itself, while `dirty`. */
export function useLeaveGuard(dirty: boolean) {
  const navigation = useNavigation();
  const confirm = useConfirmDiscard();
  usePreventRemove(dirty, ({ data }) => confirm(() => navigation.dispatch(data.action)));
}
