import { router } from 'expo-router';
import { useTranslations } from 'use-intl';
import { Button } from '~/components/ui/button';
import { EmptyState } from '~/components/ui/states';

/**
 * A page of one's own, with nobody signed in: reached from a link, or left
 * open when the session ended (a password changed elsewhere). The way in, and
 * back to this page after — never a spinner waiting for an account that is
 * not coming.
 */
export function SignedOut({ next }: { next?: string }) {
  const t = useTranslations();
  return (
    <EmptyState
      title={t('app.account.signedOutTitle')}
      body={t('app.account.signedOutBody')}
      action={
        <Button
          label={t('nav.signIn')}
          onPress={() => router.push(next ? { pathname: '/sign-in', params: { next } } : '/sign-in')}
        />
      }
    />
  );
}
