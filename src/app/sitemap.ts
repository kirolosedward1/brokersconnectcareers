import type { MetadataRoute } from 'next';
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

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const supabase = createPublicClient();

  const [{ data: jobs }, { data: companies }, { data: agents }, { data: districts }] =
    await Promise.all([
      supabase
        .from('jobs')
        .select('slug, published_at')
        .eq('status', 'active')
        .gt('expires_at', new Date().toISOString())
        .order('published_at', { ascending: false })
        .limit(5000),
      supabase.from('companies').select('slug, created_at').limit(5000),
      // Only profiles the owner has made public belong in a sitemap. A gated
      // profile must not be advertised to a crawler.
      supabase
        .from('agent_profiles')
        .select('slug, created_at')
        .eq('visibility', 'public')
        .limit(5000),
      supabase.from('districts').select('slug'),
    ]);

  const staticPages: MetadataRoute.Sitemap = [
    entry('/', { changeFrequency: 'daily', priority: 1 }),
    entry('/jobs', { changeFrequency: 'hourly', priority: 0.9 }),
    entry('/companies', { changeFrequency: 'daily', priority: 0.6 }),
    entry('/agents', { changeFrequency: 'daily', priority: 0.6 }),
    entry('/blog', { changeFrequency: 'weekly', priority: 0.6 }),
  ];

  const blogPages: MetadataRoute.Sitemap = getAllPosts('ar').map((post) =>
    entry(`/blog/${post.slug}`, {
      lastModified: post.date,
      changeFrequency: 'monthly',
      priority: 0.6,
    }),
  );

  // The track x district cross product — the organic traffic engine.
  const landingPages: MetadataRoute.Sitemap = (districts ?? []).flatMap((district) =>
    JOB_TRACKS.map((track) =>
      entry(`/jobs/${buildLandingSlug(track, district.slug)}`, {
        changeFrequency: 'daily',
        priority: 0.7,
      }),
    ),
  );

  const jobPages: MetadataRoute.Sitemap = (jobs ?? []).map((job) =>
    entry(`/jobs/${job.slug}`, {
      lastModified: job.published_at ?? undefined,
      changeFrequency: 'daily',
      priority: 0.8,
    }),
  );

  const companyPages: MetadataRoute.Sitemap = (companies ?? []).map((company) =>
    entry(`/companies/${company.slug}`, {
      lastModified: company.created_at,
      changeFrequency: 'weekly',
      priority: 0.5,
    }),
  );

  const agentPages: MetadataRoute.Sitemap = (agents ?? []).map((agent) =>
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
