import { useTranslations } from 'use-intl';
import { canAccessEmployerArea, isSuspended } from '@/lib/permissions';
import { EmptyState, NotFoundState } from '~/components/ui/states';
import { useSession } from '~/lib/session';
import { Lock, ShieldAlert } from '~/components/ui/lucide';

/**
 * The Consultants tab for an employer the directory does not answer yet.
 * Every employer has the tab (tabs.ts: the bar changes with the role, not the
 * standing), so until canBrowseAgentDirectory lets them in it says who the
 * directory is for — in the website's words — or that the account is
 * suspended. Anybody else reaching it has no such tab: not found.
 */
export function DirectoryClosed() {
  const t = useTranslations();
  const { actor } = useSession();
  if (!canAccessEmployerArea(actor)) return <NotFoundState />;
  if (isSuspended(actor)) return <EmptyState icon={ShieldAlert} title={t('account.suspendedTitle')} body={t('account.suspendedBody')} />;
  return <EmptyState icon={Lock} title={t('agents.title')} body={t('agents.subtitle')} />;
}
