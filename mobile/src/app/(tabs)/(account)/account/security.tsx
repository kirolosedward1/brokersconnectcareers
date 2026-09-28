import { ScrollView } from 'react-native';
import { router, Stack } from 'expo-router';
import { useTranslations } from 'use-intl';
import { EmailSettings, PasswordSettings } from '~/components/account/credentials';
import { TwoFactorSettings } from '~/components/account/two-factor';
import { Button } from '~/components/ui/button';
import { EmptyState } from '~/components/ui/states';
import { useSession } from '~/lib/session';
import { space } from '~/theme/tokens';

/**
 * Signing in, and keeping others out — the email address, the password and
 * the second factor from the website's /dashboard/account, each through
 * Supabase Auth against this session. An account made with Google or Apple
 * has no password to change, and is told so rather than offered a form that
 * would set one it can never use.
 */
export default function SecurityScreen() {
  const t = useTranslations();
  const { session } = useSession();
  const header = <Stack.Screen options={{ title: t('app.account.security') }} />;

  if (!session) {
    return (
      <>
        {header}
        <EmptyState
          title={t('app.account.signedOutTitle')}
          action={<Button label={t('nav.signIn')} onPress={() => router.push('/sign-in')} />}
        />
      </>
    );
  }

  const providers = (session.user.identities ?? []).map((identity) => identity.provider);
  const provider = providers.includes('email')
    ? 'email'
    : providers.includes('apple') && !providers.includes('google')
      ? 'apple'
      : 'google';

  return (
    <>
      {header}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        contentContainerStyle={{ padding: space[4], paddingBottom: space[10], gap: space[4] }}
      >
        <EmailSettings email={session.user.email ?? ''} />
        <PasswordSettings provider={provider} />
        <TwoFactorSettings />
      </ScrollView>
    </>
  );
}
