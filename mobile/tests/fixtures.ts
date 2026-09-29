import type { JobDetail, JobListItem } from '@/lib/job-list';
import type { BrowseResponse, CompanyListResponse, CompanyPageResponse, JobBoardResponse, JobDetailResponse } from '@/lib/mobile-api/reads';
import type { CompanyRow, DistrictRow, GovernorateRow } from '@/lib/supabase/database.types';

/*
  A small, realistic board: one brokerage in New Cairo with one open role.
  Typed against the website's own read shapes, so a change on the server side
  that the app has not followed fails the test typecheck first.
*/

export const cairo: GovernorateRow = { id: 1, name_ar: 'القاهرة', name_en: 'Cairo', slug: 'cairo' };

export const newCairo: DistrictRow = {
  id: 7,
  governorate_id: 1,
  name_ar: 'القاهرة الجديدة',
  name_en: 'New Cairo',
  slug: 'new-cairo',
};

export const company: CompanyRow = {
  id: '0f5e2a3e-0000-4000-8000-000000000001',
  owner_id: '0f5e2a3e-0000-4000-8000-0000000000aa',
  name_ar: 'نايل بروكرز',
  name_en: 'Nile Brokers',
  slug: 'nile-brokers',
  logo_url: null,
  about_ar: 'وساطة عقارية في شرق القاهرة.',
  about_en: null,
  website: 'https://nile.example',
  headcount_band: '11_50',
  company_type: 'brokerage',
  district_id: newCairo.id,
  verification_status: 'verified',
  verified_at: '2026-08-01T10:00:00Z',
  post_credits: 0,
  version: 1,
  created_at: '2026-07-01T10:00:00Z',
};

const inAMonth = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

export const listing: JobListItem = {
  id: '5b0c7d1e-0000-4000-8000-000000000101',
  slug: 'sales-consultant-a1b2',
  title_ar: 'استشاري مبيعات عقارية',
  title_en: 'Real estate sales consultant',
  company_id: company.id,
  district_id: newCairo.id,
  track: 'primary',
  employment_type: 'full_time',
  experience_band: 'junior_1_3',
  seats: 3,
  basic_salary_min: 10000,
  basic_salary_max: 15000,
  commission_type: 'percentage',
  commission_value: 1.5,
  commission_note_ar: null,
  leads_source: 'company_provided',
  benefits: ['social_insurance', 'medical'],
  status: 'active',
  is_featured: false,
  published_at: new Date().toISOString(),
  expires_at: inAMonth,
  company: {
    id: company.id,
    name_ar: company.name_ar,
    name_en: company.name_en,
    slug: company.slug,
    logo_url: null,
    verification_status: 'verified',
  },
  district: newCairo,
};

export const detail: JobDetail = {
  ...listing,
  description_ar: 'بيع وحدات سكنية في مشروعات القاهرة الجديدة.',
  description_en: null,
  requirements_ar: 'خبرة سنة على الأقل.',
  featured_until: null,
  view_count: 42,
  rejection_note: null,
  version: 1,
  idempotency_key: null,
  created_at: '2026-09-01T10:00:00Z',
  company: { ...company, district: newCairo },
  job_developers: [{ developer: { id: 3, name_ar: 'بالم هيلز', name_en: 'Palm Hills', slug: 'palm-hills' } }],
};

export const board = (jobs: JobListItem[] = [listing], extra: Partial<JobBoardResponse> = {}): JobBoardResponse => ({
  jobs,
  total: jobs.length,
  page: 1,
  pageCount: 1,
  pageSize: 20,
  relaxations: [],
  company: null,
  ...extra,
});

export const jobPage: JobDetailResponse = { job: detail, similar: [], reference: { sample: 6, low: 8000, high: 14000 } };

export const browse: BrowseResponse = {
  total: 1,
  tracks: [{ track: 'primary', count: 1 }],
  districts: [{ districtId: newCairo.id, count: 1 }],
  companyTypes: [{ type: 'brokerage', count: 1 }],
  pairs: [{ track: 'primary', districtId: newCairo.id, count: 1 }],
};

export const directory: CompanyListResponse = {
  companies: [{ ...company, district: newCairo, open_roles: [{ count: 1 }] }],
  total: 1,
  page: 1,
  pageCount: 1,
};

export const companyPage: CompanyPageResponse = {
  company: {
    id: company.id,
    slug: company.slug,
    name_ar: company.name_ar,
    name_en: company.name_en,
    logo_url: null,
    about_ar: company.about_ar,
    about_en: null,
    website: company.website,
    headcount_band: company.headcount_band,
    company_type: company.company_type,
    verification_status: 'verified',
    verified_at: company.verified_at,
    district: newCairo,
  },
  jobs: [listing],
  total: 1,
};
