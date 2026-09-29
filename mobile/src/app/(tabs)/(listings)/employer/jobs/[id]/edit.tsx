import { Stack, useLocalSearchParams } from 'expo-router';
import { useTranslations } from 'use-intl';
import { isSuspended } from '@/lib/permissions';
import { JobWizard } from '~/components/employer/job-wizard';
import { ViewerPending } from '~/components/navigation/viewer-pending';
import { EmptyState, ErrorState, LoadingState, NotFoundState } from '~/components/ui/states';
import { useEditableJob } from '~/features/employer/job-form';
import { useSession } from '~/lib/session';

/**
 * Changing a listing — the website's /employer/jobs/<id>/edit: the company's
 * own listing, loaded with its developers and the version the save is
 * matched on. Somebody else's listing, or none, is not found.
 */
export default function EditJobScreen() {
  const t = useTranslations();
  const { id: raw } = useLocalSearchParams<{ id: string }>();
  const id = typeof raw === 'string' ? raw : '';
  const { session, viewer, actor } = useSession();
  const editable = useEditableJob(id);
  const header = <Stack.Screen options={{ title: t('employer.editJob') }} />;

  let body: React.ReactNode;
  if (!session || !viewer?.profile) body = <ViewerPending />;
  else if (isSuspended(actor)) body = <EmptyState title={t('account.suspendedTitle')} body={t('account.suspendedBody')} />;
  else if (!viewer.company) body = <NotFoundState />;
  else if (editable.isPending) body = <LoadingState />;
  else if (editable.isError) body = <ErrorState error={editable.error} onRetry={() => editable.refetch()} />;
  else if (!editable.data) body = <NotFoundState />;
  else {
    body = (
      <JobWizard
        key={`${editable.data.job.id}:${editable.data.job.version}`}
        job={editable.data.job}
        developerIds={editable.data.developerIds}
      />
    );
  }

  return (
    <>
      {header}
      {body}
    </>
  );
}
