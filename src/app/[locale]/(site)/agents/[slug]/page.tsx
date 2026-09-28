import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Download, Lock, MapPin, UserRound } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { asLocale, localized, type Locale } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { AgentCv } from '@/components/agents/agent-cv';
import { ContactReveal } from '@/components/agents/contact-reveal';
import { ShortlistButton } from '@/components/agents/shortlist-toggle';
import { Button } from '@/components/ui/button';
import { getAgentCard, shortlistedAgentIds } from '@/lib/queries/agents';
import { ReportDialog } from '@/components/jobs/report-job-dialog';
import { recordAgentView } from '@/lib/agent-views';
import { getDistrictMap, getDevelopers } from '@/lib/queries/taxonomy';
import { getViewer, requireAgentProfileViewer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

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
    indexed — it is behind a sign-in since migration 322, so there is no
    "public profile" for a crawler to be told about — and the metadata
    streams before the page's own guard has run, so it must not carry
    anything the guard exists to withhold. The heading on the page is where
    the name is.
  */
  return {
    title: t('title'),
    description: t('subtitle'),
    robots: { index: false, follow: false, noarchive: true, nosnippet: true },
    alternates: { canonical: `/agents/${slug}` },
  };
}

export default async function AgentPage({ params }: { params: Promise<Params> }) {
  const { locale: rawLocale, slug } = await params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);

  const agent = await getAgentCard(slug);

  /*
    Who may be here (migration 322): the directory's readers — an approved
    employer or an admin — and the consultant whose page it is. The card is
    fetched first because the card is what says whose page this is:
    get_agent_card() returns a row only to those groups, so a null here for
    anybody else means "not for you", and the guard turns that into a
    redirect to their own console rather than a 404 for a candidate who typed
    a colleague's address. A directory reader with no row gets the 404.
  */
  if (!agent) {
    await requireAgentProfileViewer(locale, { user_id: null });
    notFound();
  }

  const [districts, developers, viewer] = await Promise.all([
    getDistrictMap(),
    getDevelopers(),
    getViewer(),
  ]);

  // Read through the reader's own session. RLS decides what comes back, so a
  // gated profile yields empty arrays here rather than needing a check below.
  const supabase = await createClient();
  const [experience, education, certifications, profileRow] = await Promise.all([
    supabase.from('agent_experience').select('*').eq('agent_id', agent.id).order('started', { ascending: false }),
    supabase.from('agent_education').select('*').eq('agent_id', agent.id).order('graduated', { ascending: false }),
    supabase.from('agent_certifications').select('*').eq('agent_id', agent.id).order('issued', { ascending: false }),
    supabase.from('agent_profiles').select('summary_ar, summary_en, units_closed, volume_egp, user_id, visibility').eq('id', agent.id).maybeSingle(),
  ]);

  const t = await getTranslations('agents');
  const tTrack = await getTranslations('track');
  const tAvailability = await getTranslations('availability');
  // Was a ternary over two of the three languages the product offers, so a
  // consultant who ticked French had their badge render the string "fr".
  const tLanguage = await getTranslations('language');

  // The same question again with the owner known, so the consultant opens
  // their own preview and nobody else slips through on a card the database
  // answered for a reason of its own.
  await requireAgentProfileViewer(locale, { user_id: profileRow.data?.user_id ?? null });

  const isOwner = Boolean(viewer?.userId && profileRow.data?.user_id === viewer.userId);

  const name = agent.is_unlocked && agent.full_name ? agent.full_name : t('anonymous');
  const headline = localized(locale, agent.headline_ar, agent.headline_en);

  /*
    No number on this page, and no CV link, until somebody asks.

    get_agent_card() stopped returning either (migration 304). `can_reveal` says
    whether this viewer — an employer in good standing with a company, or an
    admin — may ask, and the button below asks: one call, one recorded
    reveal, and the number arrives in the response to a press rather than in
    the HTML of a page a scraper can fetch. The owner reads their own CV
    through the same route, which recognises them.
  */
  const canReveal = agent.can_reveal && !isOwner;
  const ownCvHref = isOwner && agent.has_cv ? `/api/agent-cv/${encodeURIComponent(agent.slug)}` : null;

  /*
    Only for somebody with a company to keep them in, and only on an unlocked
    card — which is also all migration 60's insert policy permits, so the
    button is offered exactly where it can work rather than offered everywhere
    and refused.
  */
  const canShortlist = Boolean(viewer?.company) && agent.is_unlocked && !isOwner;
  const shortlisted = canShortlist ? (await shortlistedAgentIds([agent.id])).has(agent.id) : false;

  /*
    And the fact that they looked.

    Called for anybody with a company — the function itself decides whether the
    row is worth writing, including the owner's own preview — and never awaited
    by the page. A consultant who fills in a profile has had no signal that it
    is working; this is where that signal starts.
  */
  if (viewer?.company) await recordAgentView(agent.slug);

  const areas = agent.district_ids
    .map((id) => districts.get(id))
    .filter((d): d is NonNullable<typeof d> => Boolean(d));

  const soldFor = developers.filter((d) => agent.developer_ids.includes(d.id));

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      {/* The owner, reading their own card. They see everything because RLS
          already lets them read every one of these columns; what they need to
          know is what everybody else sees, which depends on one setting. */}
      {isOwner ? (
        <div className="mb-6 rounded-xl border border-primary/25 bg-primary/5 p-4 text-sm">
          <p className="font-semibold">{t('ownerBanner')}</p>
          <p className="mt-1 text-muted-foreground">
            {profileRow.data?.visibility === 'public'
              ? t('ownerPublic')
              : profileRow.data?.visibility === 'hidden'
                ? t('ownerHidden')
                : t('ownerVerified')}
          </p>
          <Link href="/dashboard/profile" className="mt-2 inline-block font-medium text-primary hover:underline">
            {t('ownerEdit')}
          </Link>
        </div>
      ) : null}
      <header className="flex flex-wrap items-start gap-4">
        {/* Same treatment as the directory card: a monogram rather than a
            silhouette when there is no photo, and a fallback when the photo
            fails to load. A locked profile keeps the silhouette — an initial
            is more than an anonymous profile is allowed to say. */}
        {agent.is_unlocked ? (
          <Avatar name={agent.full_name ?? ''} src={agent.avatar_url} seed={agent.slug} size="lg" />
        ) : (
          <span
            aria-hidden
            className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-full bg-muted"
          >
            <UserRound className="size-7 text-muted-foreground" />
          </span>
        )}

        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            {name}
            {agent.is_unlocked ? null : (
              <Lock className="size-4 text-muted-foreground" aria-label={t('locked')} />
            )}
          </h1>
          {headline ? <p className="mt-1 text-muted-foreground">{headline}</p> : null}
          <p className="mt-2 text-sm text-muted-foreground">
            {t('yearsExperience', { count: agent.years_experience })}
          </p>
        </div>
      </header>

      {agent.is_unlocked ? (
        <div className="mt-6 flex flex-wrap gap-2">
          {canReveal ? <ContactReveal handle={agent.slug} hasCv={agent.has_cv} /> : null}
          {ownCvHref ? (
            <Button asChild variant="outline" size="lg">
              <a href={ownCvHref} target="_blank" rel="noopener noreferrer">
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
      ) : (
        <div className="mt-6 flex flex-wrap items-center gap-4 rounded-xl border border-primary/30 bg-primary/5 p-5">
          <Lock className="size-5 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{t('locked')}</p>
            <p className="text-sm text-muted-foreground">{t('lockedBody')}</p>
          </div>
          <Button asChild>
            <Link href="/employer/company">{t('lockedCta')}</Link>
          </Button>
        </div>
      )}

      <dl className="mt-8 space-y-6">
        <div>
          <dt className="text-sm font-semibold">{t('availability')}</dt>
          <dd className="mt-2">
            <Badge variant="primary" size="lg">
              {tAvailability(agent.availability)}
            </Badge>
          </dd>
        </div>

        {agent.tracks.length ? (
          <div>
            <dt className="text-sm font-semibold">{t('tracks')}</dt>
            <dd className="mt-2 flex flex-wrap gap-1.5">
              {agent.tracks.map((track) => (
                <Badge key={track} variant="outline" size="lg">
                  {tTrack(track)}
                </Badge>
              ))}
            </dd>
          </div>
        ) : null}

        {areas.length ? (
          <div>
            <dt className="text-sm font-semibold">{t('districts')}</dt>
            <dd className="mt-2 flex flex-wrap gap-1.5">
              {areas.map((district) => (
                <Badge key={district.id} variant="outline" size="lg">
                  <MapPin aria-hidden />
                  {localized(locale, district.name_ar, district.name_en)}
                </Badge>
              ))}
            </dd>
          </div>
        ) : null}

        {soldFor.length ? (
          <div>
            <dt className="text-sm font-semibold">{t('soldFor')}</dt>
            <dd className="mt-2 flex flex-wrap gap-1.5">
              {soldFor.map((developer) => (
                <Badge key={developer.id} variant="outline" size="lg">
                  {localized(locale, developer.name_ar, developer.name_en)}
                </Badge>
              ))}
            </dd>
          </div>
        ) : null}

        {agent.languages.length ? (
          <div>
            <dt className="text-sm font-semibold">{t('languages')}</dt>
            <dd className="mt-2 flex flex-wrap gap-1.5">
              {agent.languages.map((language) => (
                <Badge key={language} variant="outline" size="lg">
                  {tLanguage(language)}
                </Badge>
              ))}
            </dd>
          </div>
        ) : null}
      </dl>

      <AgentCv
        locale={locale}
        summary={localized(locale, profileRow.data?.summary_ar, profileRow.data?.summary_en) || null}
        unitsClosed={profileRow.data?.units_closed ?? null}
        volumeEgp={profileRow.data?.volume_egp ?? null}
        experience={experience.data ?? []}
        education={education.data ?? []}
        certifications={certifications.data ?? []}
        districts={districts}
      />

      {/* Impersonation is the report a directory of people most needs to
          hear, and the profile is where somebody notices it. */}
      {isOwner ? null : (
        <div className="mt-10 flex justify-end border-t border-border pt-4">
          <ReportDialog
            target="agent"
            targetId={agent.id}
            signedIn={Boolean(viewer)}
            returnPath={`/agents/${agent.slug}`}
            label={t('report')}
          />
        </div>
      )}
    </div>
  );
}
