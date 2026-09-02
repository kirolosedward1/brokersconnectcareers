import 'server-only';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { marked } from 'marked';
import type { Locale } from '@/i18n/routing';

/**
 * Legal documents, kept as markdown files rather than as components.
 *
 * These get edited by whoever reviews them — which should be a lawyer, not a
 * developer — and a .md file is something a non-developer can read, comment on
 * and hand back. Burying the text inside JSX would make every wording change a
 * code review.
 *
 * Same shape as the blog: an Arabic file with an English sibling, Arabic
 * winning when the English one is missing.
 */

const LEGAL_DIR = join(process.cwd(), 'content', 'legal');

export type LegalDoc = {
  slug: LegalSlug;
  title: string;
  updated: string;
  html: string;
};

export const LEGAL_SLUGS = ['privacy', 'terms'] as const;
export type LegalSlug = (typeof LEGAL_SLUGS)[number];

/** `key: value` lines above a `---`, the same subset the blog parses. */
function parseFrontmatter(raw: string): { data: Record<string, string>; body: string } {
  if (!raw.startsWith('---')) return { data: {}, body: raw };

  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { data: {}, body: raw };

  const data: Record<string, string> = {};
  for (const line of raw.slice(3, end).split('\n')) {
    const at = line.indexOf(':');
    if (at === -1) continue;
    const key = line.slice(0, at).trim();
    if (!key) continue;
    data[key] = line
      .slice(at + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
  }

  return { data, body: raw.slice(end + 4) };
}

function read(slug: LegalSlug, locale: Locale): LegalDoc | null {
  let raw: string;
  try {
    raw = readFileSync(join(LEGAL_DIR, `${slug}.${locale}.md`), 'utf8');
  } catch {
    return null;
  }

  const { data, body } = parseFrontmatter(raw);
  return {
    slug,
    title: data.title ?? '',
    updated: data.updated ?? '',
    html: marked.parse(body, { async: false }) as string,
  };
}

export function getLegalDoc(slug: LegalSlug, locale: Locale): LegalDoc | null {
  return read(slug, locale) ?? read(slug, locale === 'ar' ? 'en' : 'ar');
}
