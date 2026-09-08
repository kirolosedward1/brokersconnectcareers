import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ShieldCheck, UsersRound } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { asLocale, alternatesFor, type Locale } from '@/i18n/routing';
import { AgentCard } from '@/components/agents/agent-card';
import { AgentFilters } from '@/components/agents/agent-filters';
import { MobileFilters } from '@/components/mobile-filters';
import { Pagination } from '@/components/pagination';
import { Button } from '@/components/ui/button';
import { getDistricts, getDistrictMap } from '@/lib/queries/taxonomy';
import { parseAgentFilters, queryAgents, serializeAgentFilters } from '@/lib/queries/agents';
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
  const [{ agents, total, pageCount }, districts, districtMap, viewer] = await Promise.all([
    queryAgents(filters),
    getDistricts(),
    getDistrictMap(),
    getViewer(),
  ]);

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
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="max-w-2xl">
        <h1 className="text-3xl font-bold">{t('title')}</h1>
        <p className="mt-2 text-lg leading-relaxed text-muted-foreground">{t('subtitle')}</p>
      </header>

      {showGate ? (
        <div className="mt-6 flex flex-wrap items-center gap-4 rounded-xl border border-primary/30 bg-primary/5 p-5">
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

      {/* Behind a disclosure on a phone. Expanded, this rail is two selects,
          six specialisation checkboxes and a district list — fifteen controls
          between the heading and the first consultant, on the page whose job
          is to show consultants. */}
      <div className="mt-6 lg:hidden">
        <MobileFilters count={activeCount}>
          <AgentFilters locale={locale} districts={districts} activeCount={activeCount} />
        </MobileFilters>
      </div>

      <div className="mt-6 grid gap-6 lg:mt-8 lg:grid-cols-[1fr_18rem] lg:gap-8">
        <aside className="hidden lg:col-start-2 lg:row-start-1 lg:block">
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm lg:sticky lg:top-24">
            <AgentFilters locale={locale} districts={districts} activeCount={activeCount} />
          </div>
        </aside>

        <div className="lg:col-start-1 lg:row-start-1">
          {/* The count sits with the results rather than under the title: it
              describes the list, and it changes when the filters do. */}
          <p className="mb-4 text-sm text-muted-foreground">
            {tJobs('resultsCount', { count: total })}
          </p>

          {agents.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border py-16 text-center">
              <UsersRound className="mx-auto size-8 text-muted-foreground" aria-hidden />
              <p className="mt-4 font-medium">{t('empty')}</p>
            </div>
          ) : (
            <>
              {/* Same reason as the board: the cards are h3s, so without a
                  heading for the region the page skips h1 to h3. */}
              <h2 className="sr-only">{tJobs('resultsCount', { count: total })}</h2>

              <ul className="space-y-4">
              {agents.map((agent) => (
                <li key={agent.id}>
                  <AgentCard agent={agent} locale={locale} districts={districtMap} />
                </li>
              ))}
              </ul>
            </>
          )}

          <Pagination
            page={filters.page}
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
