import { router, Stack } from 'expo-router';
import { useTranslations } from 'use-intl';
import { isSuspended } from '@/lib/permissions';
import { JobWizard } from '~/components/employer/job-wizard';
import { Button } from '~/components/ui/button';
import { EmptyState, LoadingState } from '~/components/ui/states';
import { useSession } from '~/lib/session';

/**
 * A new listing — the website's /employer/jobs/new: the wizard, for somebody
 * with a company to post it under. A suspended account is told it can do
 * nothing here rather than handed a form the database will refuse.
 */
export default function NewJobScreen() {
  const t = useTranslations();
  const { session, viewer, actor } = useSession();
  const header = <Stack.Screen options={{ title: t('employer.newJob') }} />;

  let body: React.ReactNode;
  if (!session || !viewer?.profile) body = <LoadingState />;
  else if (isSuspended(actor)) body = <EmptyState title={t('account.suspendedTitle')} body={t('account.suspendedBody')} />;
  else if (!viewer.company) {
    body = (
      <EmptyState
        title={t('employer.createCompanyFirst')}
        body={t('employer.createCompanyFirstBody')}
        action={<Button label={t('employer.company')} onPress={() => router.navigate('/employer/company' as never)} />}
      />
    );
  } else body = <JobWizard job={null} developerIds={[]} />;

  return (
    <>
      {header}
      {body}
    </>
  );
}
