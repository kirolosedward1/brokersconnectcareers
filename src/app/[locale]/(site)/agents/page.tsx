import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ShieldCheck, UsersRound } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { asLocale, alternatesFor, type Locale } from '@/i18n/routing';
import { AgentCard } from '@/components/agents/agent-card';
import { AgentFilters } from '@/components/agents/agent-filters';
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
      <header>
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="mt-1 text-muted-foreground">{t('subtitle')}</p>
        <p className="numeral mt-2 text-sm text-muted-foreground">
          {tJobs('resultsCount', { count: total })}
        </p>
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

      <div className="mt-6 grid gap-8 lg:grid-cols-[16rem_1fr]">
        <aside>
          <AgentFilters locale={locale} districts={districts} activeCount={activeCount} />
        </aside>

        <div>
          {agents.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border py-16 text-center">
              <UsersRound className="mx-auto size-8 text-muted-foreground" aria-hidden />
              <p className="mt-4 font-medium">{t('empty')}</p>
            </div>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {agents.map((agent) => (
                <li key={agent.id}>
                  <AgentCard agent={agent} locale={locale} districts={districtMap} />
                </li>
              ))}
            </ul>
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
