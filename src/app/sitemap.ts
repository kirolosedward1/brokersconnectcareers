import type { MetadataRoute } from 'next';
import { unstable_rethrow } from 'next/navigation';
import { env } from '@/lib/env';
import { createPublicClient } from '@/lib/supabase/public';
import { ENGLISH_ENABLED } from '@/i18n/routing';
import { buildLandingSlug, JOB_TRACKS } from '@/lib/taxonomy';
import type { JobTrack } from '@/lib/supabase/database.types';
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
  /** Companies with at least one live listing, and the newest one's date. */
  companies: { slug: string; lastModified: string | undefined }[];
  districts: { id: number; slug: string }[];
  /** `track:districtId` → newest live listing there, for every pair that has one. */
  liveLandings: Map<string, string | undefined>;
};

/**
 * Supabase's API answers at most 1,000 rows however many are asked for, so a
 * `.limit(5000)` was quietly a limit of 1,000 — the 1,001st listing would
 * never have been advertised. Paged instead, in the API's own step, ordered
 * by a unique key so a row published mid-read cannot shift a page. Capped at
 * the sitemap protocol's 50,000 URLs per file.
 */
const PAGE = 1000;
const MAX_URLS = 50_000;

async function readAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < MAX_URLS; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw error instanceof Error ? error : new Error(JSON.stringify(error));
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

/**
 * Database-backed rows, allowed to come back empty.
 *
 * This route is prerendered at build time, so an unreachable database here
 * fails the whole deployment. It should not: the static pages and the blog
 * are derivable without it, and a sitemap missing some URLs for one
 * revalidation window is a far smaller problem than a deploy that will not
 * ship.
 *
 * The try covers constructing the client too, not just the queries — reading a
 * missing NEXT_PUBLIC_SUPABASE_URL throws before a query is ever issued, which
 * is exactly what a fresh clone or a misconfigured deployment hits.
 *
 * Read through the anonymous client, so nothing reaches the sitemap that an
 * anonymous visitor could not open: drafts, listings in review, a suspended
 * company's roles and every gated consultant profile are invisible to it
 * under row-level security before any filter here is applied.
 */
async function fromDatabase(): Promise<DbRows> {
  const empty: DbRows = {
    jobs: [],
    companies: [],
    districts: [],
    liveLandings: new Map(),
  };

  try {
    const supabase = createPublicClient();
    const now = new Date().toISOString();

    /*
      No consultants. The directory is behind a sign-in since migration 202 —
      it answers approved employers and admins and nobody else — so a profile
      URL in a sitemap would advertise a page every crawler is turned away
      from, and name a person while doing it.
    */
    const [jobs, districts] = await Promise.all([
      /*
        Every live listing — live by the date, not only the label, because
        the nightly cron that writes `expired` can be a day late. The same
        predicate the board and jobIsLive() use, so the sitemap never lists a
        page that answers with a closed banner and noindex.
      */
      readAll<{
        slug: string;
        published_at: string | null;
        track: JobTrack;
        district_id: number;
        company: { slug: string } | null;
      }>((from, to) =>
        supabase
          .from('jobs')
          .select('slug, published_at, track, district_id, company:companies!inner (slug)')
          .eq('status', 'active')
          .gt('expires_at', now)
          .order('id')
          .range(from, to) as unknown as PromiseLike<{
          data: {
            slug: string;
            published_at: string | null;
            track: JobTrack;
            district_id: number;
            company: { slug: string } | null;
          }[] | null;
          error: unknown;
        }>,
      ),
      supabase.from('districts').select('id, slug'),
    ]);

    const newest = (a: string | undefined, b: string | null) =>
      b && (!a || b > a) ? b : a;

    /*
      Companies and landing pages both come from the live listings.

      A company is advertised while it is hiring — the directory lists only
      those, and the company page is noindex otherwise — so every company row
      is no longer submitted just for existing. A track x district page is
      advertised while it has a listing on it; the other hundred-odd stay
      reachable and linked, but an empty result page is thin content.
    */
    const companies = new Map<string, string | undefined>();
    const liveLandings = new Map<string, string | undefined>();
    for (const job of jobs) {
      if (job.company?.slug) {
        companies.set(job.company.slug, newest(companies.get(job.company.slug), job.published_at));
      }
      const key = `${job.track}:${job.district_id}`;
      liveLandings.set(key, newest(liveLandings.get(key), job.published_at));
    }

    return {
      jobs: [...jobs].sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? '')),
      companies: [...companies.entries()].map(([slug, lastModified]) => ({ slug, lastModified })),
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
  const { jobs, companies, districts, liveLandings } = await fromDatabase();

  const staticPages: MetadataRoute.Sitemap = [
    entry('/', { changeFrequency: 'daily', priority: 1 }),
    entry('/jobs', { changeFrequency: 'hourly', priority: 0.9 }),
    entry('/companies', { changeFrequency: 'daily', priority: 0.6 }),
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
    JOB_TRACKS.filter((track) => liveLandings.has(`${track}:${district.id}`)).map((track) =>
      entry(`/jobs/${buildLandingSlug(track, district.slug)}`, {
        lastModified: liveLandings.get(`${track}:${district.id}`),
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
      lastModified: company.lastModified,
      changeFrequency: 'weekly',
      priority: 0.5,
    }),
  );

  return [...staticPages, ...blogPages, ...landingPages, ...jobPages, ...companyPages];
}
