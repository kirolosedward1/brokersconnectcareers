import { router } from 'expo-router';
import { useTranslations } from 'use-intl';
import { canAccessEmployerArea, hasVerifiedCompany, isSuspended } from '@/lib/permissions';
import { Button } from '~/components/ui/button';
import { EmptyState, NotFoundState } from '~/components/ui/states';
import { Text } from '~/components/ui/text';
import { useCompanyPage } from '~/features/employer/company';
import { routeInside } from '~/lib/links';
import { useSession } from '~/lib/session';
import { useTheme } from '~/theme/provider';
import { Lock, ShieldAlert, ShieldCheck } from '~/components/ui/lucide';

/**
 * The Consultants tab for an employer the directory does not answer yet.
 * Every employer has the tab (tabs.ts: the bar changes with the role, not the
 * standing), so until canBrowseAgentDirectory lets them in it says why and
 * what to do: a company not verified yet is told the consultants open once it
 * is, with the way to its verification papers — a company admin's to upload,
 * so a recruiter is told who can; a verified company's account still under
 * review is told it opens after the review; a suspended account, that it is
 * suspended. Anybody else reaching it has no such tab: not found.
 */
export function DirectoryClosed() {
  const t = useTranslations();
  const { colors } = useTheme();
  const { actor } = useSession();
  const unverified = canAccessEmployerArea(actor) && !isSuspended(actor) && !hasVerifiedCompany(actor);
  const page = useCompanyPage({ enabled: unverified });

  if (!canAccessEmployerArea(actor)) return <NotFoundState />;
  if (isSuspended(actor)) return <EmptyState icon={ShieldAlert} title={t('account.suspendedTitle')} body={t('account.suspendedBody')} />;
  if (!unverified) return <EmptyState icon={Lock} title={t('employer.pendingTitle')} body={t('app.directory.reviewing')} />;

  // With no company yet, making one is the first step, and that is theirs to
  // take; otherwise the way on waits for who they are in it, rather than
  // showing one thing and then the other.
  const mayVerify = !actor?.company || page.data?.isAdmin === true;
  const recruiter = Boolean(actor?.company) && page.data?.isAdmin === false;
  return (
    <EmptyState
      icon={ShieldCheck}
      title={t('app.directory.verifyTitle')}
      body={t('app.directory.verifyBody')}
      action={
        mayVerify ? (
          <Button
            label={t('agents.lockedCta')}
            icon={<ShieldCheck size={18} color={colors.primaryForeground} />}
            onPress={() => router.navigate(routeInside('/employer/company', actor) as never)}
          />
        ) : recruiter ? (
          <Text variant="small" tone="mutedForeground" style={{ textAlign: 'center' }}>
            {t('agents.lockedRecruiter')}
          </Text>
        ) : undefined
      }
    />
  );
}
