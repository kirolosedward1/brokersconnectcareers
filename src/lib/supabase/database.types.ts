/**
 * Hand-maintained mirror of supabase/migrations/*.sql.
 *
 * Once the project is linked, regenerate instead of editing:
 *   pnpm db:types
 */

export type UserRole = 'candidate' | 'employer' | 'admin';
export type JobTrack =
  | 'primary'
  | 'resale'
  | 'rental'
  | 'commercial'
  | 'property_management'
  | 'back_office';
export type EmploymentType = 'full_time' | 'part_time' | 'freelance_commission_only';
export type ExperienceBand = 'fresh_0_1' | 'junior_1_3' | 'mid_3_5' | 'senior_5_plus';
export type LeadsSource = 'company_provided' | 'self_generated' | 'hybrid';
export type CommissionType = 'percentage' | 'split' | 'undisclosed' | 'none';
export type JobStatus = 'draft' | 'pending_review' | 'active' | 'expired' | 'closed' | 'rejected';
export type ApplicationStatus = 'new' | 'shortlisted' | 'interview' | 'hired' | 'rejected';
export type VerificationStatus = 'unverified' | 'pending' | 'verified' | 'rejected';
export type AgentVisibility = 'public' | 'verified_employers_only' | 'hidden';
export type AgentAvailability = 'open_to_offers' | 'employed_not_looking' | 'actively_searching';
export type Benefit =
  | 'social_insurance'
  | 'medical'
  | 'transport'
  | 'training'
  | 'mobile_allowance';
export type HeadcountBand = '1_10' | '11_50' | '51_200' | '201_500' | '500_plus';
export type PackKey = 'single' | 'bulk' | 'mass_hiring' | 'featured_addon';
export type ReportReason =
  | 'fake_listing'
  | 'misleading_pay'
  | 'duplicate'
  | 'spam'
  | 'discriminatory'
  | 'other';

type Timestamped = { created_at: string };

export type ProfileRow = Timestamped & {
  id: string;
  role: UserRole;
  full_name: string;
  whatsapp_phone: string;
  avatar_url: string | null;
  locale: 'ar' | 'en';
  /** Employer: a candidate applied to one of my jobs. */
  notify_applications: boolean;
  /** Candidate: my application moved, or moderation decided on my job. */
  notify_status: boolean;
  /** Candidate: the weekly roundup of matching roles. */
  notify_digest: boolean;
  /** Credential for the unsubscribe link, which has no session to rely on. */
  unsubscribe_token: string;
};

export type GovernorateRow = {
  id: number;
  name_ar: string;
  name_en: string;
  slug: string;
};

export type DistrictRow = {
  id: number;
  governorate_id: number;
  name_ar: string;
  name_en: string;
  slug: string;
};

export type DeveloperRow = {
  id: number;
  name_ar: string;
  name_en: string;
  slug: string;
};

export type CompanyRow = Timestamped & {
  id: string;
  owner_id: string;
  name_ar: string;
  name_en: string | null;
  slug: string;
  logo_url: string | null;
  about_ar: string | null;
  about_en: string | null;
  website: string | null;
  headcount_band: HeadcountBand | null;
  district_id: number | null;
  verification_status: VerificationStatus;
  verified_at: string | null;
  post_credits: number;
};

export type CompanyDocumentRow = Timestamped & {
  id: string;
  company_id: string;
  doc_type: 'commercial_register' | 'tax_card';
  storage_path: string;
  status: VerificationStatus;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
};

export type JobRow = Timestamped & {
  id: string;
  company_id: string;
  title_ar: string;
  title_en: string | null;
  slug: string;
  track: JobTrack;
  employment_type: EmploymentType;
  experience_band: ExperienceBand;
  seats: number;
  district_id: number;
  basic_salary_min: number | null;
  basic_salary_max: number | null;
  commission_type: CommissionType;
  commission_value: number | null;
  commission_note_ar: string | null;
  leads_source: LeadsSource;
  benefits: Benefit[];
  description_ar: string;
  description_en: string | null;
  requirements_ar: string | null;
  status: JobStatus;
  is_featured: boolean;
  featured_until: string | null;
  published_at: string | null;
  expires_at: string | null;
  view_count: number;
  rejection_note: string | null;
};

export type ApplicationRow = Timestamped & {
  id: string;
  job_id: string;
  candidate_id: string;
  status: ApplicationStatus;
  cv_path: string | null;
  note: string | null;
  experience_band: ExperienceBand | null;
  employer_viewed_at: string | null;
};

export type AgentProfileRow = Timestamped & {
  id: string;
  user_id: string;
  slug: string;
  headline_ar: string | null;
  headline_en: string | null;
  years_experience: number;
  tracks: JobTrack[];
  district_ids: number[];
  languages: string[];
  cv_path: string | null;
  availability: AgentAvailability;
  visibility: AgentVisibility;
};

export type SavedJobRow = Timestamped & {
  candidate_id: string;
  job_id: string;
};

export type ReportRow = Timestamped & {
  id: string;
  job_id: string | null;
  reporter_id: string | null;
  reason: ReportReason;
  detail: string | null;
  resolved: boolean;
  resolved_by: string | null;
  resolved_at: string | null;
};

export type OrderRow = Timestamped & {
  id: string;
  company_id: string;
  pack_key: PackKey;
  credits: number;
  amount_egp: number;
  paymob_order_id: string | null;
  status: 'pending' | 'paid' | 'failed' | 'refunded';
};

/** Row shape returned by the get_agent_card() RPC. */
export type AgentCardDetail = {
  id: string;
  slug: string;
  is_unlocked: boolean;
  full_name: string | null;
  avatar_url: string | null;
  whatsapp_phone: string | null;
  headline_ar: string | null;
  headline_en: string | null;
  years_experience: number;
  tracks: JobTrack[];
  district_ids: number[];
  languages: string[];
  cv_path: string | null;
  availability: AgentAvailability;
  developer_ids: number[];
};

/** Row shape returned by the search_agents() RPC. */
export type AgentCardRow = {
  id: string;
  slug: string;
  is_unlocked: boolean;
  full_name: string | null;
  avatar_url: string | null;
  headline_ar: string | null;
  headline_en: string | null;
  years_experience: number;
  tracks: JobTrack[];
  district_ids: number[];
  languages: string[];
  availability: AgentAvailability;
  total_count: number;
};

/**
 * Insert shape: everything optional except the columns that have no default
 * and must be supplied by the caller.
 */
type Insertable<Row, Req extends keyof Row = never> = Partial<Row> & Pick<Row, Req>;

type Table<Row, Insert = Insertable<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Partial<Row>;
  Relationships: [];
};

type Empty = { [_ in never]: never };

export type Database = {
  public: {
    Tables: {
      profiles: Table<ProfileRow, Insertable<ProfileRow, 'id' | 'full_name' | 'whatsapp_phone'>>;
      governorates: Table<GovernorateRow, Insertable<GovernorateRow, 'name_ar' | 'name_en' | 'slug'>>;
      districts: Table<DistrictRow, Insertable<DistrictRow, 'governorate_id' | 'name_ar' | 'name_en' | 'slug'>>;
      developers: Table<DeveloperRow, Insertable<DeveloperRow, 'name_ar' | 'name_en' | 'slug'>>;
      companies: Table<CompanyRow, Insertable<CompanyRow, 'owner_id' | 'name_ar' | 'slug'>>;
      company_documents: Table<
        CompanyDocumentRow,
        Insertable<CompanyDocumentRow, 'company_id' | 'doc_type' | 'storage_path'>
      >;
      jobs: Table<
        JobRow,
        Insertable<
          JobRow,
          | 'company_id'
          | 'title_ar'
          | 'slug'
          | 'track'
          | 'employment_type'
          | 'experience_band'
          | 'district_id'
          | 'commission_type'
          | 'leads_source'
          | 'description_ar'
        >
      >;
      job_developers: Table<{ job_id: string; developer_id: number }, { job_id: string; developer_id: number }>;
      applications: Table<ApplicationRow, Insertable<ApplicationRow, 'job_id' | 'candidate_id'>>;
      agent_profiles: Table<AgentProfileRow, Insertable<AgentProfileRow, 'user_id' | 'slug'>>;
      agent_developers: Table<{ agent_id: string; developer_id: number }, { agent_id: string; developer_id: number }>;
      saved_jobs: Table<SavedJobRow, Insertable<SavedJobRow, 'candidate_id' | 'job_id'>>;
      reports: Table<ReportRow, Insertable<ReportRow, 'reason'>>;
      orders: Table<OrderRow, Insertable<OrderRow, 'company_id' | 'pack_key' | 'credits' | 'amount_egp'>>;
      monthly_free_post_grants: Table<
        { company_id: string; period: string; granted_at: string },
        { company_id: string; period: string; granted_at?: string }
      >;
    };
    Views: Empty;
    Functions: {
      search_agents: {
        Args: {
          p_tracks?: JobTrack[] | null;
          p_district_ids?: number[] | null;
          p_availability?: AgentAvailability | null;
          p_min_years?: number | null;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: AgentCardRow[];
      };
      get_agent_card: { Args: { p_slug: string }; Returns: AgentCardDetail[] };
      increment_job_view: { Args: { job_slug: string }; Returns: undefined };
      claim_monthly_free_post: { Args: Empty; Returns: boolean };
      expire_stale_jobs: { Args: Empty; Returns: number };
    };
    Enums: {
      user_role: UserRole;
      job_track: JobTrack;
      employment_type: EmploymentType;
      experience_band: ExperienceBand;
      leads_source: LeadsSource;
      commission_type: CommissionType;
      job_status: JobStatus;
      application_status: ApplicationStatus;
      verification_status: VerificationStatus;
      agent_visibility: AgentVisibility;
      agent_availability: AgentAvailability;
    };
    CompositeTypes: Empty;
  };
};
