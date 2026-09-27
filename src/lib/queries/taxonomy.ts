import { unstable_cache } from 'next/cache';
import { raise } from './error';
import { createPublicClient } from '@/lib/supabase/public';
import { searchPhrases } from '@/lib/search/arabic';
import { logFailure } from '@/lib/observe';
import type { DeveloperRow, DistrictRow, GovernorateRow } from '@/lib/supabase/database.types';

const DAY = 60 * 60 * 24;

export const getDistricts = unstable_cache(
  async (): Promise<DistrictRow[]> => {
    const { data, error } = await createPublicClient()
      .from('districts')
      .select('*')
      .order('id');
    if (error) raise(error, 'loading districts');
    return data ?? [];
  },
  ['districts'],
  { revalidate: DAY, tags: ['taxonomy'] },
);

export const getGovernorates = unstable_cache(
  async (): Promise<GovernorateRow[]> => {
    const { data, error } = await createPublicClient()
      .from('governorates')
      .select('*')
      .order('id');
    if (error) raise(error, 'loading governorates');
    return data ?? [];
  },
  ['governorates'],
  { revalidate: DAY, tags: ['taxonomy'] },
);

export const getDevelopers = unstable_cache(
  async (): Promise<DeveloperRow[]> => {
    const { data, error } = await createPublicClient()
      .from('developers')
      .select('*')
      .order('name_en');
    if (error) raise(error, 'loading developers');
    return data ?? [];
  },
  ['developers'],
  { revalidate: DAY, tags: ['taxonomy'] },
);

export async function getDistrictBySlug(slug: string): Promise<DistrictRow | null> {
  const districts = await getDistricts();
  return districts.find((d) => d.slug === slug) ?? null;
}

export async function getDistrictMap(): Promise<Map<number, DistrictRow>> {
  const districts = await getDistricts();
  return new Map(districts.map((d) => [d.id, d]));
}

/**
 * The multi-word names a board search should keep together — every district
 * and governorate name, in both languages, and every alias (migration 68).
 *
 * Cached with the taxonomy it is built from, and rebuilt when that is. An
 * error reading the aliases degrades to the taxonomy's own names rather than
 * failing the search: a database the migration has not reached yet has no
 * aliases table, and "New Cairo" should still be one phrase there.
 */
export const getSearchPhrases = unstable_cache(
  async (): Promise<string[][]> => {
    const [districts, governorates, aliases] = await Promise.all([
      getDistricts(),
      getGovernorates(),
      createPublicClient().from('search_aliases').select('alias'),
    ]);

    if (aliases.error) {
      logFailure('taxonomy', 'could not read search aliases', { code: aliases.error.code });
    }

    return searchPhrases([
      ...districts.flatMap((d) => [d.name_ar, d.name_en]),
      ...governorates.flatMap((g) => [g.name_ar, g.name_en]),
      ...(aliases.data ?? []).map((row) => row.alias),
    ]);
  },
  ['search-phrases'],
  { revalidate: DAY, tags: ['taxonomy'] },
);
