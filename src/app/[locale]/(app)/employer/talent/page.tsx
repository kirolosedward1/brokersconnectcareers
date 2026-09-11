import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Briefcase, CircleDot, Lock, MapPin, UserRound, UsersRound } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { asLocale, localized, type Locale } from '@/i18n/routing';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Pagination } from '@/components/pagination';
import { ShortlistToggle } from '@/components/agents/shortlist-toggle';
import { requireEmployer } from '@/lib/auth';
import { querySavedAgents } from '@/lib/queries/agents';
import { getDistrictMap } from '@/lib/queries/taxonomy';
import { formatDate, formatList, formatNumber, isoDate } from '@/lib/utils';

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

  const requested = Number.parseInt((await searchParams).page ?? '1', 10);
  const page = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 50) : 1;

  const [{ agents, total, pageCount }, districts] = await Promise.all([
    querySavedAgents(page),
    getDistrictMap(),
  ]);

  const t = await getTranslations('employer');
  const tAgents = await getTranslations('agents');
  const tTrack = await getTranslations('track');
  const tAvailability = await getTranslations('availability');
  const tJobs = await getTranslations('jobs');

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">{t('shortlist')}</h1>
        <p className="mt-1 text-muted-foreground">{t('shortlistLede')}</p>
      </header>

      {agents.length === 0 ? (
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
          <p className="text-sm text-muted-foreground">{tJobs('resultsCount', { count: total })}</p>

          <ul className="space-y-3">
            {agents.map((agent) => {
              const headline = localized(locale, agent.headline_ar, agent.headline_en);
              const areas = (agent.district_ids ?? [])
                .map((id) => districts.get(id))
                .filter((d): d is NonNullable<typeof d> => Boolean(d))
                .slice(0, 2);
              const moreAreas = (agent.district_ids?.length ?? 0) - areas.length;
              const looking = agent.availability === 'actively_searching';

              return (
                <li
                  key={agent.id}
                  className="relative rounded-2xl border border-border bg-card p-5 shadow-sm"
                >
                  <div className="flex gap-4">
                    {agent.is_unlocked && agent.full_name ? (
                      <Avatar
                        name={agent.full_name}
                        src={agent.avatar_url}
                        seed={agent.slug ?? agent.id}
                        size="lg"
                      />
                    ) : (
                      <span
                        aria-hidden
                        className="grid size-16 shrink-0 place-items-center rounded-full bg-muted"
                      >
                        <UserRound className="size-7 text-muted-foreground" />
                      </span>
                    )}

                    <div className="min-w-0 flex-1">
                      <h2 className="flex items-center gap-1.5 text-lg font-semibold leading-tight">
                        {/* A consultant who has left the directory has no page
                            to link to, and their slug is their name
                            transliterated — so there is no link and no name,
                            only the fact that this row is here. */}
                        {agent.is_listed && agent.slug ? (
                          <Link
                            href={`/agents/${agent.slug}`}
                            className="after:absolute after:inset-0 hover:text-primary"
                          >
                            {agent.is_unlocked && agent.full_name
                              ? agent.full_name
                              : tAgents('anonymous')}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">{t('shortlistGone')}</span>
                        )}

                        {agent.is_listed && !agent.is_unlocked ? (
                          <Lock
                            className="size-3.5 shrink-0 text-muted-foreground"
                            aria-label={tAgents('locked')}
                          />
                        ) : null}
                      </h2>

                      {agent.is_listed ? (
                        headline ? (
                          <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                            {headline}
                          </p>
                        ) : null
                      ) : (
                        <p className="mt-1 text-sm text-muted-foreground">{t('shortlistGoneHint')}</p>
                      )}

                      {agent.tracks?.length ? (
                        <ul className="mt-3 flex flex-wrap gap-1.5">
                          {agent.tracks.slice(0, 3).map((track) => (
                            <li
                              key={track}
                              className="rounded-full bg-primary/8 px-2.5 py-1 text-xs font-medium text-primary"
                            >
                              {tTrack(track)}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>

                    <ShortlistToggle
                      agentId={agent.id}
                      initialSaved
                      labels={{ add: tAgents('shortlistAdd'), remove: tAgents('shortlistRemove') }}
                      className="-mt-1 -me-1"
                    />
                  </div>

                  <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-4 text-sm text-muted-foreground">
                    {agent.years_experience != null ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Briefcase className="size-4" aria-hidden />
                        {tAgents('yearsExperience', { count: agent.years_experience })}
                      </span>
                    ) : null}

                    {areas.length ? (
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin className="size-4" aria-hidden />
                        {formatList(
                          areas.map((d) => localized(locale, d.name_ar, d.name_en)),
                          locale,
                        )}
                        {moreAreas > 0 ? (
                          <span className="numeral">+{formatNumber(moreAreas, locale)}</span>
                        ) : null}
                      </span>
                    ) : null}

                    {agent.availability ? (
                      <span
                        className={`inline-flex items-center gap-1.5 ${
                          looking ? 'font-medium text-success' : ''
                        }`}
                      >
                        <CircleDot className="size-4" aria-hidden />
                        {tAvailability(agent.availability)}
                      </span>
                    ) : null}

                    {/* Who kept them, and when. A company is a team, so the
                        colleague who has been meaning to call this person is
                        a fact the rest of the team needs. */}
                    <span className="ms-auto">
                      {agent.saved_by_name
                        ? t('shortlistSavedBy', {
                            name: agent.saved_by_name,
                            date: formatDate(agent.saved_at, locale),
                          })
                        : t('shortlistSavedOn', { date: formatDate(agent.saved_at, locale) })}
                      <time className="sr-only" dateTime={isoDate(agent.saved_at)} />
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>

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
