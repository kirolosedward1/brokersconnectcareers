import { ScrollView } from 'react-native';
import { router, Stack } from 'expo-router';
import { useTranslations } from 'use-intl';
import { EmailSettings, PasswordSettings } from '~/components/account/credentials';
import { TwoFactorSettings } from '~/components/account/two-factor';
import { Button } from '~/components/ui/button';
import { EmptyState } from '~/components/ui/states';
import { useSession } from '~/lib/session';
import { gutter, space } from '~/theme/tokens';
import { Trash2, UserRound } from '~/components/ui/lucide';
import { useTheme } from '~/theme/provider';

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
  const { colors } = useTheme();
  const header = <Stack.Screen options={{ title: t('app.account.security') }} />;

  if (!session) {
    return (
      <>
        {header}
        <EmptyState
          icon={UserRound}
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
        contentContainerStyle={{ padding: gutter, paddingBottom: space[10], gap: space[4] }}
      >
        <EmailSettings email={session.user.email ?? ''} />
        <PasswordSettings provider={provider} />
        <TwoFactorSettings />
        {/*
          Off the Account tab itself, but kept in the app: the App Store asks
          an app that makes accounts to let them be deleted from inside it
          (guideline 5.1.1(v)), and a person looks for it with their sign-in.
        */}
        <Button
          label={t('account.deleteTitle')}
          variant="ghost"
          size="sm"
          icon={<Trash2 size={16} color={colors.destructive} />}
          onPress={() => router.push('/account/delete')}
          style={{ alignSelf: 'center', marginTop: space[4] }}
        />
      </ScrollView>
    </>
  );
}
