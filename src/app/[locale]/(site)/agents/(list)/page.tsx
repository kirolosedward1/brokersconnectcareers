import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ShieldCheck } from 'lucide-react';
import { EmptyIllustration } from '@/components/illustration';
import { Link } from '@/i18n/navigation';
import { asLocale, alternatesFor, type Locale } from '@/i18n/routing';
import { AgentCard } from '@/components/agents/agent-card';
import { AgentFilters } from '@/components/agents/agent-filters';
import { MobileFilters } from '@/components/mobile-filters';
import { Pagination } from '@/components/pagination';
import { Button } from '@/components/ui/button';
import { getDistricts, getDistrictMap } from '@/lib/queries/taxonomy';
import {
  parseAgentFilters,
  queryAgents,
  serializeAgentFilters,
  shortlistedAgentIds,
} from '@/lib/queries/agents';
import { getViewer } from '@/lib/auth';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: rawLocale } = await params;
  const locale = asLocale(rawLocale);
  const t = await getTranslations({ locale, namespace: 'agents' });
  return {
    title: t('title'),
    description: t('subtitle'),
    alternates: alternatesFor('/agents', locale),
  };
}

export default async function AgentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale: rawLocale } = await params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);

  const filters = parseAgentFilters(await searchParams);
  const [{ agents, total, pageCount, page }, districts, districtMap, viewer] = await Promise.all([
    queryAgents(filters),
    getDistricts(),
    getDistrictMap(),
    getViewer(),
  ]);

  /*
    Which of these the viewer's company already keeps.

    Only for somebody who has a company to keep them in, and only for the ids
    on this page — the directory itself is the same list for everybody, and
    folding a per-reader column into it would make every result set personal.
  */
  const canShortlist = Boolean(viewer?.company);
  const shortlisted = canShortlist
    ? await shortlistedAgentIds(agents.map((agent) => agent.id))
    : new Set<string>();

  const t = await getTranslations('agents');
  const tJobs = await getTranslations('jobs');

  const activeCount =
    filters.tracks.length +
    filters.districtSlugs.length +
    (filters.availability ? 1 : 0) +
    (filters.minYears ? 1 : 0);

  const unlocked = agents.some((agent) => agent.is_unlocked && agent.full_name);
  const showGate = !unlocked && viewer?.company?.verification_status !== 'verified';

  return (
    <div className="shell py-6">
      <header className="max-w-2xl">
        <h1 className="text-xl font-bold">{t('title')}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      {showGate ? (
        <div className="mt-4 flex flex-wrap items-center gap-4 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3.5">
          <ShieldCheck className="size-6 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{t('locked')}</p>
            <p className="text-sm text-muted-foreground">{t('lockedBody')}</p>
          </div>
          <Button asChild>
            <Link href="/employer/company">{t('lockedCta')}</Link>
          </Button>
        </div>
      ) : null}

      {/* Behind a sheet on a phone. Expanded, this rail is two selects,
          six specialisation checkboxes and a district list — fifteen controls
          between the heading and the first consultant, on the page whose job
          is to show consultants. */}
      <div className="mt-4 lg:hidden">
        <MobileFilters count={activeCount} total={total} locale={locale} clearHref="/agents">
          <AgentFilters locale={locale} districts={districts} activeCount={activeCount} />
        </MobileFilters>
      </div>

      {/* The rail sits where the jobs board puts its own — leading side, same
          width, no box around it. It was on the trailing side in a shadowed
          card, so the two list pages of one product filtered from opposite
          edges of the screen. */}
      <div className="mt-4 grid gap-6 lg:mt-5 lg:grid-cols-[15.5rem_minmax(0,1fr)] xl:gap-8">
        <aside className="hidden lg:block">
          <div className="sticky top-20 max-h-[calc(100dvh-6rem)] overflow-y-auto pe-2">
            <AgentFilters locale={locale} districts={districts} activeCount={activeCount} />
          </div>
        </aside>

        <div className="min-w-0">
          {/* The count sits with the results rather than under the title: it
              describes the list, and it changes when the filters do. */}
          <p className="mb-3 text-sm text-muted-foreground">
            {tJobs('resultsCount', { count: total })}
          </p>

          {agents.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center">
              <EmptyIllustration name="choose" />
              <p className="font-medium">{t('empty')}</p>
            </div>
          ) : (
            <>
              {/* Same reason as the board: the cards are h3s, so without a
                  heading for the region the page skips h1 to h3. */}
              <h2 className="sr-only">{tJobs('resultsCount', { count: total })}</h2>

              <ul className="grid gap-2 xl:grid-cols-2">
              {agents.map((agent) => (
                <li key={agent.id}>
                  <AgentCard
                    agent={agent}
                    locale={locale}
                    districts={districtMap}
                    shortlistable={canShortlist}
                    shortlisted={shortlisted.has(agent.id)}
                  />
                </li>
              ))}
              </ul>
            </>
          )}

          {/* `page`, not `filters.page`: a request past the end is answered
              with the last page, and the footer has to say which page that is
              rather than the one nobody got. */}
          <Pagination
            page={page}
            pageCount={pageCount}
            buildHref={(next) => {
              const query = serializeAgentFilters({ ...filters, page: next }).toString();
              return query ? `/agents?${query}` : '/agents';
            }}
          />
        </div>
      </div>
    </div>
  );
}
