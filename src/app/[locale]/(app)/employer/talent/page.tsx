import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { UsersRound } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { asLocale, localized, type Locale } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Pagination } from '@/components/pagination';
import { ShortlistList, type ShortlistRow } from '@/components/employer/shortlist-list';
import { requireEmployer } from '@/lib/auth';
import { querySavedAgents } from '@/lib/queries/agents';
import { getDistrictMap } from '@/lib/queries/taxonomy';
import { formatDate, formatList, formatNumber } from '@/lib/utils';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'employer' });
  return { title: t('shortlist'), robots: { index: false, follow: false } };
}

/**
 * The company's shortlist, across every listing and none.
 *
 * Not a second applicant inbox. The inbox answers "who applied to this role";
 * this answers "who do we want to talk to when a role comes up", which is the
 * question a brokerage hiring continuously actually has — and the one nothing
 * here could hold, because shortlisting was a status on an application and
 * therefore belonged to one listing.
 *
 * Everything shown is decided by `saved_agent_cards()`, which re-derives each
 * consultant's visibility on every read. A row can come back empty, and that
 * is a real state rather than an error: the consultant has left the directory,
 * and the only thing this page may still say about them is that the company
 * once kept them. It says exactly that, and offers the way to let go.
 *
 * This side resolves everything locale-dependent — names, areas, dates, the
 * availability label — and hands the list over as strings. The rendering lives
 * in a client component because removing somebody has to remove their row, and
 * only the browser can do that to a list it is looking at.
 */
export default async function TalentPoolPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);
  await requireEmployer(locale);

  const asked = Number.parseInt((await searchParams).page ?? '1', 10);
  const requested = Number.isFinite(asked) && asked > 0 ? Math.min(asked, 50) : 1;

  const [{ agents, total, pageCount, page }, districts] = await Promise.all([
    querySavedAgents(requested),
    getDistrictMap(),
  ]);

  const t = await getTranslations('employer');
  const tAgents = await getTranslations('agents');
  const tTrack = await getTranslations('track');
  const tAvailability = await getTranslations('availability');

  const rows: ShortlistRow[] = agents.map((agent) => {
    const areas = (agent.district_ids ?? [])
      .map((id) => districts.get(id))
      .filter((d): d is NonNullable<typeof d> => Boolean(d))
      .slice(0, 2);
    const moreAreas = (agent.district_ids?.length ?? 0) - areas.length;

    return {
      id: agent.id,
      slug: agent.slug,
      isListed: agent.is_listed,
      isUnlocked: agent.is_unlocked,
      name: agent.full_name,
      avatarUrl: agent.avatar_url,
      headline: localized(locale, agent.headline_ar, agent.headline_en),
      tracks: (agent.tracks ?? []).slice(0, 3).map((track) => tTrack(track)),
      years:
        agent.years_experience != null
          ? tAgents('yearsExperience', { count: agent.years_experience })
          : null,
      areas: areas.length
        ? formatList(areas.map((d) => localized(locale, d.name_ar, d.name_en)), locale)
        : null,
      moreAreas: moreAreas > 0 ? `+${formatNumber(moreAreas, locale)}` : null,
      availability: agent.availability ? tAvailability(agent.availability) : null,
      looking: agent.availability === 'actively_searching',
      savedNote: agent.saved_by_name
        ? t('shortlistSavedBy', {
            name: agent.saved_by_name,
            date: formatDate(agent.saved_at, locale),
          })
        : t('shortlistSavedOn', { date: formatDate(agent.saved_at, locale) }),
    };
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">{t('shortlist')}</h1>
        <p className="mt-1 text-muted-foreground">{t('shortlistLede')}</p>
      </header>

      {total === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <UsersRound className="mx-auto size-8 text-muted-foreground" aria-hidden />
          <p className="mt-4 font-medium">{t('shortlistEmpty')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('shortlistEmptyHint')}</p>
          <Button asChild className="mt-5">
            <Link href="/agents">{tAgents('title')}</Link>
          </Button>
        </div>
      ) : (
        <>
          <ShortlistList rows={rows} />

          <Pagination
            page={page}
            pageCount={pageCount}
            buildHref={(next) => (next > 1 ? `/employer/talent?page=${next}` : '/employer/talent')}
          />
        </>
      )}
    </div>
  );
}
