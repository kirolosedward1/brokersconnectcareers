import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Download, Lock, MapPin, MessageCircle, UserRound } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { alternatesFor, localized, routing, type Locale } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getAgentCard } from '@/lib/queries/agents';
import { getDistrictMap, getDevelopers } from '@/lib/queries/taxonomy';
import { getViewer } from '@/lib/auth';
import { CV_BUCKET, signedUrl } from '@/lib/storage';
import { whatsappLink } from '@/lib/utils';
import { employerToAgentOpener } from '@/lib/whatsapp';

type Params = { locale: Locale; slug: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const agent = await getAgentCard(slug);
  if (!agent) return {};

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
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const agent = await getAgentCard(slug);
  if (!agent) notFound();

  const [districts, developers, viewer] = await Promise.all([
    getDistrictMap(),
    getDevelopers(),
    getViewer(),
  ]);

  const t = await getTranslations('agents');
  const tTrack = await getTranslations('track');
  const tAvailability = await getTranslations('availability');

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
      <header className="flex flex-wrap items-start gap-4">
        <span
          aria-hidden
          className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-full bg-muted"
        >
          {agent.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={agent.avatar_url} alt="" className="size-full object-cover" />
          ) : (
            <UserRound className="size-7 text-muted-foreground" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            {name}
            {agent.is_unlocked ? null : (
              <Lock className="size-4 text-muted-foreground" aria-label={t('locked')} />
            )}
          </h1>
          {headline ? <p className="mt-1 text-muted-foreground">{headline}</p> : null}
          <p className="numeral mt-2 text-sm text-muted-foreground">
            {t('yearsExperience', { count: agent.years_experience })}
          </p>
        </div>
      </header>

      {agent.is_unlocked ? (
        <div className="mt-6 flex flex-wrap gap-2">
          {contactUrl ? (
            <Button asChild size="lg">
              <a href={contactUrl} target="_blank" rel="noopener noreferrer">
                <MessageCircle />
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
                  {language === 'ar' ? 'العربية' : language === 'en' ? 'English' : language}
                </Badge>
              ))}
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}
