import { unstable_cache } from 'next/cache';
import { raise } from './error';
import { createPublicClient } from '@/lib/supabase/public';
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
