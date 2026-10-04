import { router, Stack } from 'expo-router';
import { useTranslations } from 'use-intl';
import { canPostJobs, isSuspended } from '@/lib/permissions';
import { JobWizard } from '~/components/employer/job-wizard';
import { Button } from '~/components/ui/button';
import { ViewerPending } from '~/components/navigation/viewer-pending';
import { EmptyState } from '~/components/ui/states';
import { useSession } from '~/lib/session';
import { Building2, Clock, ShieldAlert } from '~/components/ui/lucide';

/**
 * A new listing — the website's /employer/jobs/new: the wizard, for somebody
 * with a company to post it under. A suspended account is told it can do
 * nothing here rather than handed a form the database will refuse — and so is
 * an account still under review: every new employer starts pending (migration
 * 16), and the database takes no listing from one, not even a draft. Four
 * steps filled in and then "restricted or suspended" was the first thing a new
 * company heard.
 */
export default function NewJobScreen() {
  const t = useTranslations();
  const { session, viewer, actor } = useSession();
  const header = <Stack.Screen options={{ title: t('employer.newJob') }} />;

  let body: React.ReactNode;
  if (!session || !viewer?.profile) body = <ViewerPending />;
  else if (isSuspended(actor)) body = <EmptyState icon={ShieldAlert} title={t('account.suspendedTitle')} body={t('account.suspendedBody')} />;
  else if (!viewer.company) {
    body = (
      <EmptyState
        icon={Building2}
        title={t('employer.createCompanyFirst')}
        body={t('employer.createCompanyFirstBody')}
        action={<Button label={t('employer.company')} onPress={() => router.navigate('/employer/company' as never)} />}
      />
    );
  } else if (!canPostJobs(actor)) {
    body = (
      <EmptyState
        icon={Clock}
        title={t('employer.pendingTitle')}
        body={t('employer.pendingBody')}
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
