import { buildLandingSlug } from '@/lib/taxonomy';

/**
 * The pages a sitelink should be able to name, beyond the board and the
 * company directory that the main nav already carries.
 *
 * Two anchors share /employers: the page is the indexable door for a company,
 * and "أعلن عن وظيفة" is the action that page is for. The post button in the
 * header still goes to the sign-in wall; these two stay on the public page.
 */
export const SITELINK_PAGES = [
  { href: '/sign-in', key: 'signIn' },
  { href: '/sign-up', key: 'signUp' },
  { href: '/employers', key: 'forEmployers' },
  { href: '/employers', key: 'announceJob' },
] as const;

/**
 * Indexable track × district landings, not the filtered board.
 *
 * `/jobs?district=` is rewritten to /board and kept out of the index, so a
 * footer link there cannot become a sitelink. These three are the areas the
 * result should be able to name, on the primary-sales landing that is indexed
 * while it has live jobs.
 */
export const SITELINK_AREAS = [
  { slug: 'new-cairo', key: 'areaNewCairo' },
  { slug: 'new-capital', key: 'areaNewCapital' },
  { slug: 'sheikh-zayed', key: 'areaSheikhZayed' },
] as const;

export function areaLandingPath(slug: (typeof SITELINK_AREAS)[number]['slug']): string {
  return `/jobs/${buildLandingSlug('primary', slug)}`;
}
