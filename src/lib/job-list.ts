/**
 * What a listing is in a list, as data: the columns, the joined company and
 * district, and the select string that fetches exactly that.
 *
 * Out of queries/jobs.ts, which pulls in the server client, so the mobile app
 * can type the board it receives from /api/mobile/v1/jobs with the very shape
 * the website's query produces. queries/jobs.ts re-exports all of it.
 */
import type { CompanyRow, DistrictRow, JobRow } from '@/lib/supabase/database.types';

/**
 * The columns a listing needs to be drawn in a list: the card, the ranking
 * the dashboard applies, the weekly alert. Named, not `*`.
 *
 * `*` carried the whole listing into every card — the description (1,200
 * characters of Arabic is normal), the requirements, and the generated search
 * vector, none of which a card shows. Measured on a realistic board that is
 * about 5 KB a row, 100 KB out of the database for a page of twenty, on the
 * busiest query on the site; named, it is under a fifth of that. Database
 * egress is a monthly quota on the Free plan, and the rendered page carried
 * the same bytes again in its payload.
 *
 * The type follows the list, so anything that starts reading a column this
 * leaves out is a compile error rather than an `undefined` on a card.
 */
export const LIST_COLUMNS = [
  'id', 'slug', 'title_ar', 'title_en', 'company_id', 'district_id',
  'track', 'employment_type', 'experience_band', 'seats',
  'basic_salary_min', 'basic_salary_max',
  'commission_type', 'commission_value', 'commission_note_ar', 'leads_source', 'benefits',
  'status', 'is_featured', 'published_at', 'expires_at',
] as const;

export type JobListItem = Pick<JobRow, (typeof LIST_COLUMNS)[number]> & {
  company: Pick<
    CompanyRow,
    'id' | 'name_ar' | 'name_en' | 'slug' | 'logo_url' | 'verification_status'
  >;
  district: DistrictRow;
};

/** A listing as the lists draw it. Shared with the company page and the saved list. */
export const LIST_SELECT = `
  ${LIST_COLUMNS.join(', ')},
  company:companies!inner (id, name_ar, name_en, slug, logo_url, verification_status),
  district:districts!inner (id, governorate_id, name_ar, name_en, slug)
`;

/** One listing as its page draws it: the row, its company, its district, its developers. */
export type JobDetail = JobRow & {
  company: CompanyRow & { district: DistrictRow | null };
  district: DistrictRow;
  job_developers: { developer: { id: number; name_ar: string; name_en: string; slug: string } }[];
};
