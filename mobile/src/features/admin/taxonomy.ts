import { useQuery } from '@tanstack/react-query';
import type { DeveloperRow, DistrictRow, GovernorateRow, TaxonomyKind } from '@/lib/supabase/database.types';
import { COMPANY_TYPES, EMPLOYMENT_TYPES, EXPERIENCE_BANDS, JOB_TRACKS } from '@/lib/taxonomy';
import { supabase } from '~/lib/supabase';
import { useOpen } from './record';

/**
 * The lists the product is built from — the website's /admin/taxonomy.
 * Districts, governorates and developers are rows: added and renamed through
 * saveTaxonomy, deleted through deleteTaxonomy only when nothing uses them
 * (the database refuses otherwise, counting a district that only a
 * consultant's profile names). A slug is permanent: it is part of public
 * URLs. Tracks, experience bands, employment types and company types are
 * fixed in the code and the database, and shown as such.
 *
 * Read here as the admin: the rows beside their use counts
 * (admin_taxonomy_usage), under ['admin'] so every lever reads them again.
 * The app's own taxonomy reads (features/taxonomy.ts, kept across launches
 * under ['taxonomy']) are read again after a change too (useAfterLever).
 */
export const TAXONOMY_TABS = ['district', 'governorate', 'developer', 'fixed'] as const;
export type TaxonomyTab = (typeof TAXONOMY_TABS)[number];

/** The tab a link names (`?kind=` on /admin/taxonomy), or the districts. */
export function taxonomyTabOf(value: string | undefined): TaxonomyTab {
  return (TAXONOMY_TABS as readonly string[]).includes(value ?? '') ? (value as TaxonomyTab) : 'district';
}

export const NAME_MAX = 80;
export const SLUG_MAX = 60;
/** Lowercase latin letters, digits and single hyphens — the website's pattern, and the database's. */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export type TaxonomyEntry = {
  id: number;
  name_ar: string;
  name_en: string;
  slug: string;
  /** A district's governorate; null for the other kinds. */
  governorate_id: number | null;
  /** Listings, companies, profiles and experience that name it: deletable only at nought. */
  uses: number;
};

export type Governorate = Pick<GovernorateRow, 'id' | 'name_ar' | 'name_en'>;

export type TaxonomyList = { rows: TaxonomyEntry[]; governorates: Governorate[] };

function tableOf(kind: TaxonomyKind): 'districts' | 'governorates' | 'developers' {
  return kind === 'district' ? 'districts' : kind === 'governorate' ? 'governorates' : 'developers';
}

export function useTaxonomyList(kind: TaxonomyKind) {
  const open = useOpen();
  return useQuery({
    queryKey: ['admin', 'taxonomy', kind],
    enabled: open,
    queryFn: async (): Promise<TaxonomyList> => {
      const [rowsRead, usageRead, governoratesRead] = await Promise.all([
        // Developers by their English name, places by id — the website's order.
        supabase.from(tableOf(kind)).select('*').order(kind === 'developer' ? 'name_en' : 'id'),
        supabase.rpc('admin_taxonomy_usage', { p_kind: kind }),
        // The governorates a district is filed under: named on each row, chosen in the form.
        kind === 'district' ? supabase.from('governorates').select('id, name_ar, name_en').order('id') : null,
      ]);
      if (rowsRead.error) throw rowsRead.error;
      if (usageRead.error) throw usageRead.error;
      if (governoratesRead?.error) throw governoratesRead.error;

      const uses = new Map((usageRead.data ?? []).map((row) => [row.id, Number(row.uses)]));
      const rows = ((rowsRead.data ?? []) as (DistrictRow | GovernorateRow | DeveloperRow)[]).map((row) => ({
        id: row.id,
        name_ar: row.name_ar,
        name_en: row.name_en,
        slug: row.slug,
        governorate_id: 'governorate_id' in row ? row.governorate_id : null,
        uses: uses.get(row.id) ?? 0,
      }));
      return { rows, governorates: (governoratesRead?.data ?? []) as Governorate[] };
    },
  });
}

/** What the add and rename forms hold. */
export type TaxonomyDraft = {
  kind: TaxonomyKind;
  nameAr: string;
  nameEn: string;
  /** Only when adding: the slug is permanent once set. */
  slug?: string;
  governorateId: number | null;
};

/**
 * The website's own checks (the zod schema in actions/admin.ts and the
 * database's) applied before the sheet is opened, so a slip is said in the
 * form rather than refused after a confirmation: both names, up to eighty
 * characters; a slug of lowercase letters, digits and single hyphens, up to
 * sixty; a district filed under a governorate.
 */
export function taxonomyProblem(draft: TaxonomyDraft): 'invalid_name' | 'invalid_slug' | 'invalid_governorate' | null {
  const ar = draft.nameAr.trim();
  const en = draft.nameEn.trim();
  if (!ar || !en || ar.length > NAME_MAX || en.length > NAME_MAX) return 'invalid_name';
  if (draft.slug !== undefined) {
    const slug = draft.slug.trim();
    if (!slug || slug.length > SLUG_MAX || !SLUG_PATTERN.test(slug)) return 'invalid_slug';
  }
  if (draft.kind === 'district' && !draft.governorateId) return 'invalid_governorate';
  return null;
}

/**
 * The fixed lists, each with the catalogue namespace its values are named in
 * and the console's title for it (admin.track, admin.experience, …).
 */
export const FIXED_LISTS = [
  { title: 'track', namespace: 'track', values: JOB_TRACKS },
  { title: 'experience', namespace: 'experienceBand', values: EXPERIENCE_BANDS },
  { title: 'employmentType', namespace: 'employmentType', values: EMPLOYMENT_TYPES },
  { title: 'companyType', namespace: 'companyType', values: COMPANY_TYPES },
] as const;
