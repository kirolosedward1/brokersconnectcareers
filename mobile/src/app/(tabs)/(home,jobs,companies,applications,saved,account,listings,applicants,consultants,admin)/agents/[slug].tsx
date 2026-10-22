import { useLocalSearchParams } from 'expo-router';
import { AgentProfile } from '~/components/directory/agent-profile';

/**
 * /agents/<slug> — a consultant's page, opened by its slug or, for a card
 * locked to this company, by its id. In the group every tab shares: a
 * profile opens from the directory, the shortlist, an applicant or a link,
 * and stays in the tab it was opened from.
 */
export default function AgentScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return <AgentProfile handle={typeof slug === 'string' ? slug.toLowerCase() : ''} />;
}
