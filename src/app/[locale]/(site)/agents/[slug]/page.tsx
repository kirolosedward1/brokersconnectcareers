import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Download, Lock, MapPin, UserRound } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { asLocale, alternatesFor, localized, routing, type Locale } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { AgentCv } from '@/components/agents/agent-cv';
import { Button } from '@/components/ui/button';
import { getAgentCard } from '@/lib/queries/agents';
import { getDistrictMap, getDevelopers } from '@/lib/queries/taxonomy';
import { getViewer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { CV_BUCKET, signedUrl } from '@/lib/storage';
import { whatsappLink } from '@/lib/utils';
import { employerToAgentOpener } from '@/lib/whatsapp';
import { WhatsAppMark } from '@/components/brand-marks';

type Params = { locale: string; slug: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { locale: rawLocale, slug } = await params;
  const locale = asLocale(rawLocale);
  const agent = await getAgentCard(slug);
  // notFound() here rather than returning empty metadata, so a missing record
  // takes one path instead of rendering a page with no title and then failing
  // in the body.
  //
  // It does NOT make the status a 404, and I tried: this route streams, so the
  // headers are gone before either check runs and Next can only serve the
  // not-found UI under a 200. Metadata streams with it, so moving the check
  // earlier changes nothing. The only way to a real 404 here is to delete
  // loading.tsx and give up the skeleton on the three page types that most
  // need one, which is a worse trade than a soft 404 that carries
  // `robots: noindex` — Google never indexes these, and what is left is a
  // Search Console warning rather than a penalty. /blog returns a true 404
  // only because it has no loading.tsx and therefore does not stream.
  if (!agent) notFound();

  const t = await getTranslations({ locale, namespace: 'agents' });
  const name = agent.is_unlocked && agent.full_name ? agent.full_name : t('anonymous');
  const path = `/agents/${slug}`;

  return {
    title: name,
    description: localized(locale, agent.headline_ar, agent.headline_en) || t('subtitle'),
    alternates: alternatesFor(path, locale),
    // A gated profile has nothing worth indexing and should not be cached by
    // search engines in its anonymised form.
    robots: agent.is_unlocked ? undefined : { index: false, follow: true },
  };
}

export default async function AgentPage({ params }: { params: Promise<Params> }) {
  const { locale: rawLocale, slug } = await params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);

  const agent = await getAgentCard(slug);
  if (!agent) notFound();

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

  const isOwner = Boolean(viewer?.userId && profileRow.data?.user_id === viewer.userId);

  const name = agent.is_unlocked && agent.full_name ? agent.full_name : t('anonymous');
  const headline = localized(locale, agent.headline_ar, agent.headline_en);

  // cv_path is only ever returned by get_agent_card() when the viewer is
  // entitled to it, so its presence is the authorisation.
  const cvUrl = agent.cv_path ? await signedUrl(CV_BUCKET, agent.cv_path, 600) : null;

  const contactUrl =
    agent.whatsapp_phone && viewer?.company
      ? whatsappLink(
          agent.whatsapp_phone,
          employerToAgentOpener({
            agentName: agent.full_name ?? name,
            companyName: localized(locale, viewer.company.name_ar, viewer.company.name_en),
            locale,
          }),
        )
      : null;

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
          {contactUrl ? (
            <Button asChild size="lg">
              <a href={contactUrl} target="_blank" rel="noopener noreferrer">
                <WhatsAppMark className="size-5 shrink-0" />
                {t('contact')}
              </a>
            </Button>
          ) : null}
          {cvUrl ? (
            <Button asChild variant="outline" size="lg">
              <a href={cvUrl} target="_blank" rel="noopener noreferrer">
                <Download />
                {t('downloadCv')}
              </a>
            </Button>
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
    </div>
  );
}
