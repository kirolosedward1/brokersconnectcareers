import { JsonLd } from '@/components/json-ld';
import { breadcrumbJsonLd } from '@/lib/seo/breadcrumbs';

/**
 * BreadcrumbList for a page that already has a title, without drawing a trail.
 *
 * The visible chrome stays as it is. The list is only the structured data
 * Google reads when it builds a path under a result.
 */
export function BreadcrumbJsonLd({
  crumbs,
  locale,
}: {
  crumbs: { name: string; path?: string }[];
  locale: string;
}) {
  return <JsonLd data={breadcrumbJsonLd(crumbs, locale)} />;
}
