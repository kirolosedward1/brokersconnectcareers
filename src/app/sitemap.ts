import type { MetadataRoute } from 'next';
import { unstable_rethrow } from 'next/navigation';
import { env } from '@/lib/env';
import { createPublicClient } from '@/lib/supabase/public';
import { ENGLISH_ENABLED } from '@/i18n/routing';
import { buildLandingSlug, JOB_TRACKS } from '@/lib/taxonomy';
import { getAllPosts } from '@/lib/blog';

export const revalidate = 3600;

/** One entry per URL, with an ar/en pair only while English is published. */
function entry(
  path: string,
  options: { lastModified?: string | Date; changeFrequency?: MetadataRoute.Sitemap[number]['changeFrequency']; priority?: number } = {},
): MetadataRoute.Sitemap[number] {
  return {
    url: `${env.siteUrl}${path}`,
    lastModified: options.lastModified,
    changeFrequency: options.changeFrequency,
    priority: options.priority,
    ...(ENGLISH_ENABLED
      ? {
          alternates: {
            languages: {
              ar: `${env.siteUrl}${path}`,
              en: `${env.siteUrl}/en${path === '/' ? '' : path}`,
            },
          },
        }
      : {}),
  };
}

type DbRows = {
  jobs: { slug: string; published_at: string | null }[];
  companies: { slug: string; created_at: string }[];
  agents: { slug: string; created_at: string }[];
  districts: { slug: string }[];
  /** `track:districtSlug` for every pair that actually has an open listing. */
  liveLandings: Set<string>;
};

/**
 * Database-backed rows, allowed to come back empty.
 *
 * This route is prerendered at build time, so an unreachable database here
 * fails the whole deployment. It should not: the static pages, the blog and the
 * track x district landing pages are all derivable without it, and a sitemap
 * missing some URLs for one revalidation window is a far smaller problem than a
 * deploy that will not ship.
 *
 * The try covers constructing the client too, not just the queries — reading a
 * missing NEXT_PUBLIC_SUPABASE_URL throws before a query is ever issued, which
 * is exactly what a fresh clone or a misconfigured deployment hits.
 */
async function fromDatabase(): Promise<DbRows> {
  const empty: DbRows = {
    jobs: [],
    companies: [],
    agents: [],
    districts: [],
    liveLandings: new Set(),
  };

  try {
    const supabase = createPublicClient();

    const [jobs, companies, agents, districts, landings] = await Promise.all([
      supabase
        .from('jobs')
        .select('slug, published_at')
        .eq('status', 'active')
        // `.gt()` alone drops rows where expires_at is null, because NULL > x
        // is NULL in SQL — a listing with no expiry would never be advertised.
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
        .order('published_at', { ascending: false })
        .limit(5000),
      supabase.from('companies').select('slug, created_at').limit(5000),
      // Only profiles the owner has made public belong in a sitemap. A gated
      // profile must not be advertised to a crawler.
      supabase.from('agent_profiles').select('slug, created_at').eq('visibility', 'public').limit(5000),
      supabase.from('districts').select('slug'),
      /**
       * Which track x district pages have anything on them.
       *
       * The cross product is 126 pages and twelve of them had a job. The other
       * 114 were being submitted to Google as a sitemap of empty result pages —
       * the definition of thin content, and volunteered rather than crawled.
       * Only the ones with a live listing go in now; the rest stay reachable
       * and internally linked, they are simply not advertised.
       */
      supabase
        .from('jobs')
        .select('track, district:districts (slug)')
        .eq('status', 'active')
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
        .limit(5000),
    ]);

    const liveLandings = new Set<string>();
    for (const row of (landings.data ?? []) as unknown as {
      track: string;
      district: { slug: string } | null;
    }[]) {
      if (row.district?.slug) liveLandings.add(`${row.track}:${row.district.slug}`);
    }

    return {
      jobs: jobs.data ?? [],
      companies: companies.data ?? [],
      agents: agents.data ?? [],
      districts: districts.data ?? [],
      liveLandings,
    };
  } catch (error) {
    unstable_rethrow(error);

    console.warn(
      '[sitemap] database unavailable, emitting static routes only:',
      error instanceof Error ? error.message : error,
    );
    return empty;
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { jobs, companies, agents, districts, liveLandings } = await fromDatabase();

  const staticPages: MetadataRoute.Sitemap = [
    entry('/', { changeFrequency: 'daily', priority: 1 }),
    entry('/jobs', { changeFrequency: 'hourly', priority: 0.9 }),
    entry('/companies', { changeFrequency: 'daily', priority: 0.6 }),
    entry('/agents', { changeFrequency: 'daily', priority: 0.6 }),
    entry('/employers', { changeFrequency: 'monthly', priority: 0.8 }),
    entry('/blog', { changeFrequency: 'weekly', priority: 0.6 }),
  ];

  const blogPages: MetadataRoute.Sitemap = getAllPosts('ar').map((post) =>
    entry(`/blog/${post.slug}`, {
      lastModified: post.date,
      changeFrequency: 'monthly',
      priority: 0.6,
    }),
  );

  // The track x district pages that have something on them. See liveLandings.
  const landingPages: MetadataRoute.Sitemap = districts.flatMap((district) =>
    JOB_TRACKS.filter((track) => liveLandings.has(`${track}:${district.slug}`)).map((track) =>
      entry(`/jobs/${buildLandingSlug(track, district.slug)}`, {
        changeFrequency: 'daily',
        priority: 0.7,
      }),
    ),
  );

  const jobPages: MetadataRoute.Sitemap = jobs.map((job) =>
    entry(`/jobs/${job.slug}`, {
      lastModified: job.published_at ?? undefined,
      changeFrequency: 'daily',
      priority: 0.8,
    }),
  );

  const companyPages: MetadataRoute.Sitemap = companies.map((company) =>
    entry(`/companies/${company.slug}`, {
      lastModified: company.created_at,
      changeFrequency: 'weekly',
      priority: 0.5,
    }),
  );

  const agentPages: MetadataRoute.Sitemap = agents.map((agent) =>
    entry(`/agents/${agent.slug}`, {
      lastModified: agent.created_at,
      changeFrequency: 'weekly',
      priority: 0.4,
    }),
  );

  return [
    ...staticPages,
    ...blogPages,
    ...landingPages,
    ...jobPages,
    ...companyPages,
    ...agentPages,
  ];
}
