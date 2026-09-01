import 'server-only';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { marked } from 'marked';
import type { Locale } from '@/i18n/routing';

const BLOG_DIR = join(process.cwd(), 'content', 'blog');

export type PostMeta = {
  slug: string;
  locale: Locale;
  title: string;
  description: string;
  date: string;
  author: string;
  tags: string[];
  readingMinutes: number;
  /** Which cover illustration to draw. Falls back to one derived from the slug. */
  cover: string | null;
};

export type Post = PostMeta & { html: string };

/**
 * Frontmatter is a deliberately small YAML subset — `key: value` and
 * `key: [a, b]` — because we author every one of these files. A real YAML
 * parser would be a dependency earning its keep on nothing.
 */
function parseFrontmatter(raw: string): { data: Record<string, string | string[]>; body: string } {
  if (!raw.startsWith('---')) return { data: {}, body: raw };

  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { data: {}, body: raw };

  const data: Record<string, string | string[]> = {};
  for (const line of raw.slice(3, end).split('\n')) {
    const at = line.indexOf(':');
    if (at === -1) continue;

    const key = line.slice(0, at).trim();
    let value = line.slice(at + 1).trim();
    if (!key) continue;

    if (value.startsWith('[') && value.endsWith(']')) {
      data[key] = value
        .slice(1, -1)
        .split(',')
        .map((item) => item.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
      continue;
    }
    value = value.replace(/^["']|["']$/g, '');
    data[key] = value;
  }

  return { data, body: raw.slice(end + 4) };
}

/** Arabic averages far fewer characters per word than English; 900 vs 1100. */
function estimateReadingMinutes(body: string, locale: Locale): number {
  const words = body.trim().split(/\s+/).length;
  const perMinute = locale === 'ar' ? 180 : 220;
  return Math.max(1, Math.round(words / perMinute));
}

function fileName(slug: string, locale: Locale) {
  return `${slug}.${locale}.md`;
}

function readPost(slug: string, locale: Locale): Post | null {
  let raw: string;
  try {
    raw = readFileSync(join(BLOG_DIR, fileName(slug, locale)), 'utf8');
  } catch {
    return null;
  }

  const { data, body } = parseFrontmatter(raw);
  const str = (key: string) => (typeof data[key] === 'string' ? (data[key] as string) : '');

  return {
    slug,
    locale,
    title: str('title'),
    description: str('description'),
    date: str('date'),
    author: str('author'),
    tags: Array.isArray(data.tags) ? data.tags : [],
    readingMinutes: estimateReadingMinutes(body, locale),
    cover: str('cover') || null,
    html: marked.parse(body, { async: false }) as string,
  };
}

export function getPostSlugs(): string[] {
  try {
    return [
      ...new Set(
        readdirSync(BLOG_DIR)
          .filter((file) => file.endsWith('.md'))
          .map((file) => file.replace(/\.(ar|en)\.md$/, '')),
      ),
    ];
  } catch {
    return [];
  }
}

/**
 * Arabic is the product, so a post that exists only in Arabic is still served
 * on the English side rather than 404-ing — the same fallback the database
 * content uses.
 */
export function getPost(slug: string, locale: Locale): Post | null {
  return readPost(slug, locale) ?? readPost(slug, locale === 'ar' ? 'en' : 'ar');
}

export function getAllPosts(locale: Locale): PostMeta[] {
  return getPostSlugs()
    .map((slug) => getPost(slug, locale))
    .filter((post): post is Post => Boolean(post))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Which locales a given post actually has a file for, for hreflang. */
export function getPostLocales(slug: string): Locale[] {
  return (['ar', 'en'] as Locale[]).filter((locale) => readPost(slug, locale) !== null);
}
