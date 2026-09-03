import { setRequestLocale } from 'next-intl/server';
import { asLocale, type Locale } from '@/i18n/routing';
import { AgentProfileForm } from '@/components/dashboard/agent-profile-form';
import { CvEditor } from '@/components/dashboard/cv-editor';
import { ProfileRecordForm } from '@/components/dashboard/profile-record-form';
import { requireCandidate } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getDistricts, getDevelopers } from '@/lib/queries/taxonomy';
import type {
  AgentCertificationRow,
  AgentEducationRow,
  AgentExperienceRow,
  AgentProfileRow,
} from '@/lib/supabase/database.types';

export default async function ProfilePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: rawLocale } = await params;
  const locale = asLocale(rawLocale);
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

  const typedAgent = (agent as AgentProfileRow | null) ?? null;

  // The CV sections only exist once there is a profile to hang them on.
  const [experience, education, certifications, completeness] = typedAgent
    ? await Promise.all([
        supabase.from('agent_experience').select('*').eq('agent_id', typedAgent.id).order('started', { ascending: false }),
        supabase.from('agent_education').select('*').eq('agent_id', typedAgent.id).order('graduated', { ascending: false }),
        supabase.from('agent_certifications').select('*').eq('agent_id', typedAgent.id).order('issued', { ascending: false }),
        supabase.rpc('profile_completeness', { p_agent_id: typedAgent.id }),
      ])
    : [null, null, null, null];

  return (
    <div className="space-y-8">
      <AgentProfileForm
        locale={locale}
        profile={viewer.profile}
        agent={typedAgent}
        districts={districts}
        developers={developers}
        selectedDeveloperIds={(agentDevelopers ?? []).map((row) => row.developer_id)}
      />

      {/* Everything below needs a profile row to attach to. Until the form
          above has been saved once there is nothing to add sections to. */}
      {typedAgent ? (
        <>
          <ProfileRecordForm
            agent={typedAgent}
            completeness={typeof completeness?.data === 'number' ? completeness.data : 0}
          />
          <CvEditor
            agentId={typedAgent.id}
            experience={(experience?.data ?? []) as AgentExperienceRow[]}
            education={(education?.data ?? []) as AgentEducationRow[]}
            certifications={(certifications?.data ?? []) as AgentCertificationRow[]}
          />
        </>
      ) : null}
    </div>
  );
}
