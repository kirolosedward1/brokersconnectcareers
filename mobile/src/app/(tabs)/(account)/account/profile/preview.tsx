import { Stack } from 'expo-router';
import { canAccessCandidateArea } from '@/lib/permissions';
import { AgentProfile } from '~/components/directory/agent-profile';
import { ErrorState, LoadingState, NotFoundState } from '~/components/ui/states';
import { useAgentProfile } from '~/features/profile/queries';
import { useSession } from '~/lib/session';

/**
 * The candidate's own card, as companies see it — the website's
 * /agents/<own slug>, which get_agent_card() answers for its owner whatever
 * the visibility setting. Here rather than under /agents, which is the
 * directory's and not a candidate's to open; the page itself says which
 * audience sees what.
 */
export default function ProfilePreviewScreen() {
  const { actor } = useSession();
  const profile = useAgentProfile();
  const header = <Stack.Screen options={{ title: '' }} />;

  if (!canAccessCandidateArea(actor)) {
    return (
      <>
        {header}
        <NotFoundState />
      </>
    );
  }
  if (profile.isPending) {
    return (
      <>
        {header}
        <LoadingState />
      </>
    );
  }
  if (profile.isError && !profile.data) {
    return (
      <>
        {header}
        <ErrorState error={profile.error} onRetry={() => profile.refetch()} />
      </>
    );
  }
  const slug = profile.data?.agent?.slug;
  if (!slug) {
    return (
      <>
        {header}
        <NotFoundState />
      </>
    );
  }
  return <AgentProfile handle={slug} />;
}
