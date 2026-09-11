import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Eye } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { asLocale, type Locale } from '@/i18n/routing';
import { AgentProfileForm } from '@/components/dashboard/agent-profile-form';
import { CvEditor } from '@/components/dashboard/cv-editor';
import { ProfileRecordForm } from '@/components/dashboard/profile-record-form';
import { ProfileGaps } from '@/components/dashboard/profile-gaps';
import { requireCandidate } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getDistricts, getDevelopers } from '@/lib/queries/taxonomy';
import type {
  AgentCertificationRow,
  AgentEducationRow,
  AgentExperienceRow,
  AgentProfileRow,
} from '@/lib/supabase/database.types';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'dashboard' });
  return { title: t('profile'), robots: { index: false, follow: false } };
}

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

  const t = await getTranslations('dashboard');

  /*
    Narrower than the shell allows. Every block on this page is a form or a
    list of sentences, and neither is readable at the width a grid of stat
    tiles needs — which is what the console shell is sized for.
  */
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('profile')}</h1>
          <p className="mt-1 text-muted-foreground">{t('profileLede')}</p>
        </div>
        {/* The result of everything below, one tap away. The gaps list says
            what to fill in; this is why. get_agent_card() lets an owner open
            their own page whatever the visibility setting (migration 40), and
            the page itself says which audience sees what. */}
        {typedAgent ? (
          <Button asChild variant="outline">
            <Link href={`/agents/${typedAgent.slug}`}>
              <Eye aria-hidden />
              {t('profilePreview')}
            </Link>
          </Button>
        ) : null}
      </header>

      {/* Above the form, because it is the reason to scroll into it. Renders
          nothing once the profile is complete. */}
      {typedAgent ? (
        <ProfileGaps
          agent={typedAgent}
          completeness={typeof completeness?.data === 'number' ? completeness.data : 0}
          hasExperience={(experience?.data ?? []).length > 0}
          hasEducation={(education?.data ?? []).length > 0}
        />
      ) : null}

      <div id="profile-form" className="scroll-mt-20" />

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
            locale={locale}
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
