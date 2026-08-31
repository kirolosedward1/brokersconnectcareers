import { setRequestLocale } from 'next-intl/server';
import type { Locale } from '@/i18n/routing';
import { AgentProfileForm } from '@/components/dashboard/agent-profile-form';
import { requireCandidate } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getDistricts, getDevelopers } from '@/lib/queries/taxonomy';
import type { AgentProfileRow } from '@/lib/supabase/database.types';

export default async function ProfilePage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const viewer = await requireCandidate(locale);
  const supabase = await createClient();

  const { data: agent } = await supabase
    .from('agent_profiles')
    .select('*')
    .eq('user_id', viewer.userId)
    .maybeSingle();

  const { data: agentDevelopers } = agent
    ? await supabase.from('agent_developers').select('developer_id').eq('agent_id', agent.id)
    : { data: [] as { developer_id: number }[] };

  const [districts, developers] = await Promise.all([getDistricts(), getDevelopers()]);

  return (
    <AgentProfileForm
      locale={locale}
      profile={viewer.profile}
      agent={(agent as AgentProfileRow | null) ?? null}
      districts={districts}
      developers={developers}
      selectedDeveloperIds={(agentDevelopers ?? []).map((row) => row.developer_id)}
    />
  );
}
