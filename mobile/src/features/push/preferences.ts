import { useMutation, useQueryClient } from '@tanstack/react-query';
import { pushPreferencesOf, type PushPreferences } from '@/lib/push-preferences';
import { callAction } from '~/lib/api';

/**
 * What reaches the person's phones (migration 335). The shape is the
 * website's (`src/lib/push-preferences.ts`): the account page reads it too.
 * A kind turned off still shows in the bell.
 */
export { pushPreferencesOf, type PushPreferences };

/**
 * Saves the switches given, through the website, as the email switches are
 * saved — only those: the others as this phone last read them may be older
 * than what another phone has saved since.
 */
export function useSavePushPreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (change: Partial<PushPreferences>) => {
      const result = await callAction('updatePushPreferences', change);
      if (!result.ok) throw new Error(result.error);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['viewer'] }),
  });
}
