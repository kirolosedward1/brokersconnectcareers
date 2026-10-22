import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { useTranslations } from 'use-intl';
import { appleSignInRevoked, forgetAppleSignIn } from '~/features/auth/apple-credential';
import { signOutHere } from '~/features/push/device';
import { useSession } from '~/lib/session';
import { dialog } from '~/lib/dialog';

/**
 * Ends a session made with Sign in with Apple once Apple no longer lets this
 * app use that Apple ID (turned off in Settings, or revoked): asked at launch
 * and each time the app comes back, as Apple asks apps to. The person is told
 * why, and can sign in again however they like. When nobody is signed in, the
 * record of who signed in with Apple goes, so a later sign-in by password is
 * never asked about.
 */
export function AppleCredentialWatch() {
  const t = useTranslations('app.auth');
  const { ready, session } = useSession();
  const userId = session?.user.id ?? null;

  useEffect(() => {
    if (ready && !userId) void forgetAppleSignIn();
  }, [ready, userId]);

  useEffect(() => {
    if (Platform.OS !== 'ios' || !userId) return;
    let asking = false;
    let gone = false;
    const ask = async () => {
      if (asking || gone) return;
      asking = true;
      try {
        if (!(await appleSignInRevoked(userId)) || gone) return;
        gone = true;
        await forgetAppleSignIn();
        await signOutHere();
        dialog.alert(t('appleRevokedTitle'), t('appleRevokedBody'));
      } finally {
        asking = false;
      }
    };
    void ask();
    const listening = AppState.addEventListener('change', (next) => {
      if (next === 'active') void ask();
    });
    return () => {
      gone = true;
      listening.remove();
    };
  }, [userId, t]);

  return null;
}
