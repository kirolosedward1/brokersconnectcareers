import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  ArrowRight,
  Building2,
  CircleDot,
  Download,
  Languages,
  Lock,
  MapPin,
  UserRound,
} from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { asLocale, localized, type Locale } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { FactLine } from '@/components/ui/fact-line';
import {
  AgentAbout,
  AgentCertifications,
  AgentEducation,
  AgentExperience,
  SectionHeading,
} from '@/components/agents/agent-cv';
import { AgentContact } from '@/components/agents/agent-contact';
import { ShortlistButton } from '@/components/agents/shortlist-toggle';
import { Button } from '@/components/ui/button';
import { getAgentCard, shortlistedAgentIds } from '@/lib/queries/agents';
import { recordAgentView } from '@/lib/agent-views';
import { getDistrictMap, getDevelopers } from '@/lib/queries/taxonomy';
import { actorOf, getViewer, requireAgentProfileViewer } from '@/lib/auth';
import { canContactAgent, canShortlistAgents, isAdmin } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import { CV_BUCKET, signedUrl } from '@/lib/storage';
import { employerToAgentOpener } from '@/lib/whatsapp';
import type { AgentExperienceRow } from '@/lib/supabase/database.types';

type Params = { locale: string; slug: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { locale: rawLocale, slug } = await params;
  const locale = asLocale(rawLocale);
  const t = await getTranslations({ locale, namespace: 'agents' });

  /*
    No name in the title, whoever is asking. A directory page is never
    indexed — it is behind a sign-in — and the metadata streams before the
    page's own guard has run, so it must not carry anything the guard exists
    to withhold. The heading on the page is where the name is.
  */
  return {
    title: t('title'),
    description: t('subtitle'),
    robots: { index: false, follow: false },
    alternates: { canonical: `/agents/${slug}` },
  };
}

/**
 * One consultant, as a company sees them.
 *
 * Who may open the page: the directory's readers, and the consultant whose
 * page it is. get_agent_card() has already refused everybody else a row, so
 * `agent` being null is "no such consultant, or not for you" — and the guard
 * below turns the second into a redirect rather than a 404 for a candidate
 * who typed a colleague's address.
 *
 * What the page shows is decided row by row by the database: the name, the
 * photo, the number and the CV arrive only on an unlocked card, and the work
 * history, education and certifications arrive only when RLS lets this viewer
 * read the profile they hang on. Nothing is fetched and then hidden.
 */
export default async function AgentPage({ params }: { params: Promise<Params> }) {
  const { locale: rawLocale, slug } = await params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);

  const [agent, viewer] = await Promise.all([getAgentCard(slug), getViewer()]);

  // The row itself — summary, record, owner — under the reader's own session.
  // Read before the guard so the guard can be told whose page this is.
  // Allowed to fail quietly: RLS returns nothing for a card this viewer may
  // see but not read in full, which is the anonymised state, not a failure.
  const supabase = await createClient();
  const { data: profileRow } = agent
    ? await supabase
        .from('agent_profiles')
        .select('summary_ar, summary_en, units_closed, volume_egp, user_id, visibility, created_at')
        .eq('id', agent.id)
        .maybeSingle()
    : { data: null };

  if (!agent) {
    // Nothing came back: either no such consultant, or not for this viewer.
    // A signed-in directory reader gets the not-found page; anybody else is
    // sent where they belong, which is what they would have got for a real
    // profile too.
    await requireAgentProfileViewer(locale, { user_id: null });
    notFound();
  }

  const owner = profileRow?.user_id ?? null;
  await requireAgentProfileViewer(locale, { user_id: owner });
  const actor = actorOf(viewer);
  const isOwner = Boolean(viewer && owner && owner === viewer.userId);

  const [districts, developers, experience, education, certifications] = await Promise.all([
    getDistrictMap(),
    getDevelopers(),
    supabase.from('agent_experience').select('*').eq('agent_id', agent.id).order('started', { ascending: false }),
    supabase.from('agent_education').select('*').eq('agent_id', agent.id).order('graduated', { ascending: false }),
    supabase.from('agent_certifications').select('*').eq('agent_id', agent.id).order('issued', { ascending: false }),
  ]);

  const t = await getTranslations('agents');
  const tTrack = await getTranslations('track');
  const tAvailability = await getTranslations('availability');
  const tLanguage = await getTranslations('language');
  const tCv = await getTranslations('cv');

  const name = agent.is_unlocked && agent.full_name ? agent.full_name : t('anonymous');
  const headline = localized(locale, agent.headline_ar, agent.headline_en);

  // cv_path is only ever returned by get_agent_card() when the viewer is
  // entitled to it, so its presence is the authorisation.
  const cvUrl = agent.cv_path ? await signedUrl(CV_BUCKET, agent.cv_path, 600) : null;

  const contactable =
    canContactAgent(actor, { ...agent, user_id: owner }) && viewer?.company ? true : false;

  /*
    Only for somebody with a company to keep them in, and only on an unlocked
    card — which is also all migration 60's insert policy permits, so the
    button is offered exactly where it can work rather than offered everywhere
    and refused.
  */
  const canShortlist = canShortlistAgents(actor) && agent.is_unlocked && !isOwner;
  const shortlisted = canShortlist ? (await shortlistedAgentIds([agent.id])).has(agent.id) : false;

  /*
    And the fact that they looked. The function itself decides whether the
    row is worth writing, including the owner's own preview — and it runs
    after the response through after(), so nobody waits on it.
  */
  if (viewer?.company && !isOwner) recordAgentView(agent.slug ?? agent.id);

  const areas = agent.district_ids
    .map((id) => districts.get(id))
    .filter((d): d is NonNullable<typeof d> => Boolean(d));

  const soldFor = developers.filter((d) => agent.developer_ids.includes(d.id));

  const history = (experience.data ?? []) as AgentExperienceRow[];
  // The current role, if the history says there is one: the most recent
  // entry with no end date. Not invented from anything else.
  const current = history.find((row) => !row.ended) ?? null;

  const looking = agent.availability === 'actively_searching';

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
      {/* The way back, for the reader who arrived from the list. Not for the
          owner, who came from their editor and has no directory to return to. */}
      {isOwner ? null : (
        <Link
          href="/agents"
          className="mb-4 inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowRight className="rtl-flip size-4 rotate-180" aria-hidden />
          {t('backToDirectory')}
        </Link>
      )}

      {/* The owner, reading their own card. They see everything because RLS
          already lets them read every one of these columns; what they need to
          know is what everybody else sees, which depends on one setting. */}
      {isOwner ? (
        <div className="mb-6 rounded-xl border border-primary/25 bg-primary/5 p-4 text-sm">
          <p className="font-semibold">
            <Badge variant="primary" className="me-2 align-middle">{t('previewOnly')}</Badge>
            {t('ownerBanner')}
          </p>
          <p className="mt-1 text-muted-foreground">
            {profileRow?.visibility === 'public'
              ? t('ownerPublic')
              : profileRow?.visibility === 'hidden'
                ? t('ownerHidden')
                : t('ownerVerified')}
          </p>
          <Link href="/dashboard/profile" className="mt-2 inline-block font-medium text-primary hover:underline">
            {t('ownerEdit')}
          </Link>
        </div>
      ) : null}

      {/* The header: compact, one column on a phone. The photo is a fact about
          the person, drawn at the size of a fact — not a hero. */}
      <header className="flex items-start gap-4">
        {agent.is_unlocked ? (
          <Avatar name={agent.full_name ?? ''} src={agent.avatar_url} seed={agent.slug ?? agent.id} size="lg" />
        ) : (
          <span
            aria-hidden
            className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-full bg-muted"
          >
            <UserRound className="size-7 text-muted-foreground" />
          </span>
        )}

        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold leading-tight sm:text-2xl">
            <bdi>{name}</bdi>
            {agent.is_unlocked ? null : (
              <Lock className="size-4 shrink-0 text-muted-foreground" aria-label={t('locked')} />
            )}
          </h1>

          <p className="mt-1 text-muted-foreground">{headline || t('noHeadline')}</p>

          <FactLine className="mt-2 text-sm text-muted-foreground">
            <span>{t('yearsExperience', { count: agent.years_experience })}</span>
            {current ? (
              <span className="inline-flex items-center gap-1">
                <Building2 className="size-3.5" aria-hidden />
                {current.company_name}
              </span>
            ) : null}
            {areas.length ? (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" aria-hidden />
                {localized(locale, areas[0].name_ar, areas[0].name_en)}
                {areas.length > 1 ? (
                  <span className="numeral">+{areas.length - 1}</span>
                ) : null}
              </span>
            ) : null}
            <span className={looking ? 'inline-flex items-center gap-1 font-medium text-success' : 'inline-flex items-center gap-1'}>
              <CircleDot className="size-3.5" aria-hidden />
              {tAvailability(agent.availability)}
            </span>
          </FactLine>
        </div>
      </header>

      {/* Actions. Contact is its own block below; here only the two things
          that are not contact — the CV and the shortlist. */}
      {agent.is_unlocked && (cvUrl || canShortlist) ? (
        <div className="mt-5 flex flex-wrap gap-2">
          {cvUrl ? (
            <Button asChild variant="outline">
              <a href={cvUrl} target="_blank" rel="noopener noreferrer">
                <Download />
                {t('downloadCv')}
              </a>
            </Button>
          ) : null}
          {canShortlist ? (
            <ShortlistButton
              agentId={agent.id}
              initialSaved={shortlisted}
              labels={{ add: t('shortlistAdd'), remove: t('shortlistRemove') }}
            />
          ) : null}
        </div>
      ) : null}

      {/* The contact block, for a company that may use it. The number itself
          only ever arrived because the card is unlocked for this viewer. */}
      {contactable && agent.whatsapp_phone ? (
        <div className="mt-5">
          <AgentContact
            phone={agent.whatsapp_phone}
            opener={employerToAgentOpener({
              agentName: agent.full_name ?? name,
              companyName: localized(locale, viewer!.company!.name_ar, viewer!.company!.name_en),
              locale,
            })}
          />
        </div>
      ) : null}

      {/* A locked card explains itself once, to a company that could unlock
          it. An admin never sees a locked card. */}
      {agent.is_unlocked || isAdmin(actor) ? null : (
        <div className="mt-5 flex flex-wrap items-center gap-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <Lock className="size-5 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{t('locked')}</p>
            <p className="text-sm text-muted-foreground">{t('lockedBody')}</p>
          </div>
          <Button asChild variant="outline">
            <Link href="/employer/company">{t('lockedCta')}</Link>
          </Button>
        </div>
      )}

      <div className="mt-8 space-y-8">
        <AgentAbout
          locale={locale}
          summary={localized(locale, profileRow?.summary_ar, profileRow?.summary_en) || null}
          unitsClosed={profileRow?.units_closed ?? null}
          volumeEgp={profileRow?.volume_egp ?? null}
        />

        <AgentExperience locale={locale} experience={history} districts={districts} />

        {agent.tracks.length ? (
          <section aria-labelledby="agent-tracks">
            <SectionHeading id="agent-tracks">{t('tracks')}</SectionHeading>
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {agent.tracks.map((track) => (
                <li key={track}>
                  <Badge variant="primary" size="lg">
                    {tTrack(track)}
                  </Badge>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {areas.length ? (
          <section aria-labelledby="agent-areas">
            <SectionHeading id="agent-areas" icon={<MapPin className="size-4 text-muted-foreground" aria-hidden />}>
              {t('districts')}
            </SectionHeading>
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {areas.map((district) => (
                <li key={district.id}>
                  <Badge variant="outline" size="lg">
                    {localized(locale, district.name_ar, district.name_en)}
                  </Badge>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {soldFor.length ? (
          <section aria-labelledby="agent-developers">
            <SectionHeading id="agent-developers" icon={<Building2 className="size-4 text-muted-foreground" aria-hidden />}>
              {t('soldFor')}
            </SectionHeading>
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {soldFor.map((developer) => (
                <li key={developer.id}>
                  <Badge variant="outline" size="lg">
                    <bdi>{localized(locale, developer.name_ar, developer.name_en)}</bdi>
                  </Badge>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {agent.languages.length ? (
          <section aria-labelledby="agent-languages">
            <SectionHeading id="agent-languages" icon={<Languages className="size-4 text-muted-foreground" aria-hidden />}>
              {t('languages')}
            </SectionHeading>
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {agent.languages.map((language) => (
                <li key={language}>
                  <Badge variant="outline" size="lg">
                    {tLanguage(language as 'ar')}
                  </Badge>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <AgentEducation education={education.data ?? []} />
        <AgentCertifications certifications={certifications.data ?? []} />

        {/* The owner, with an empty profile: say what a company would see
            instead of a page of nothing. */}
        {isOwner && !history.length && !profileRow?.summary_ar && !agent.tracks.length ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            {tCv('experienceEmpty')}{' '}
            <Link href="/dashboard/profile#profile-form" className="font-medium text-primary hover:underline">
              {t('ownerEdit')}
            </Link>
          </p>
        ) : null}
      </div>
    </div>
  );
}
