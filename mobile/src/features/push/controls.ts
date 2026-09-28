import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocale } from 'use-intl';
import {
  askPermission,
  dismissPushPrompt,
  forgetThisPhone,
  readPermission,
  registerThisPhone,
  setPushOff,
  type PushPermission,
} from '~/features/push/device';
import { useSession } from '~/lib/session';

/**
 * Turning pushes on and off from the app — the prompt on Home and the switch
 * in the account. On: the phone's question if it has not been asked, then
 * this phone registered for the person signed in. Off: the phone forgotten
 * by the database, and the choice kept, so the next launch does not register
 * it again. Refused by the phone, it stays off until the phone's settings say
 * otherwise.
 */
export function usePushControls() {
  const queryClient = useQueryClient();
  const locale = useLocale();
  const userId = useSession().session?.user.id ?? null;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['push', 'state'] });

  const turnOn = useMutation({
    mutationFn: async (): Promise<PushPermission> => {
      if (!userId) return 'undetermined';
      let permission = await readPermission();
      if (permission === 'undetermined') permission = await askPermission();
      if (permission !== 'granted') return permission;
      await setPushOff(userId, false);
      await registerThisPhone(locale);
      return permission;
    },
    onSettled: refresh,
  });

  const turnOff = useMutation({
    mutationFn: async () => {
      if (!userId) return;
      await setPushOff(userId, true);
      await forgetThisPhone();
    },
    onSettled: refresh,
  });

  const dismissPrompt = useMutation({
    mutationFn: async () => {
      if (userId) await dismissPushPrompt(userId);
    },
    onSettled: refresh,
  });

  return { turnOn, turnOff, dismissPrompt };
}
