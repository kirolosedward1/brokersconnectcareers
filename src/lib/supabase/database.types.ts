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
  /**
   * Whether this account may act. Candidates arrive approved; companies wait
   * for an admin, because the side that collects CVs and phone numbers is the
   * side worth checking by hand. Separate from company verification, which
   * asks whether the papers are real rather than whether the account may post.
   */
  approval_status: ApprovalStatus;
  approval_note: string | null;
  approved_at: string | null;
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
  /** The employer's reason for the current status. The candidate sees it. */
  decision_note: string | null;
};

export type CandidateSummary = {
  applications_total: number;
  applications_new: number;
  applications_moved: number;
  applications_hired: number;
  replies: number;
  saved_jobs: number;
  saved_searches: number;
  alerts_on: number;
  profile_completeness: number;
  has_profile: boolean;
  open_jobs: number;
};

/** `has_company: false` is a real state: the account exists before the company does. */
export type EmployerSummary =
  | { has_company: false }
  | {
      has_company: true;
      live_jobs: number;
      pending_jobs: number;
      draft_jobs: number;
      expiring_soon: number;
      total_views: number;
      seats_advertised: number;
      applicants_total: number;
      applicants_new: number;
      applicants_7d: number;
      applicants_prev_7d: number;
      credits: number;
      verification: VerificationStatus;
    };

export type AdminSummary = {
  queue_total: number;
  queue_over_24h: number;
  reports_open: number;
  companies_pending: number;
  companies_total: number;
  live_jobs: number;
  candidates: number;
  employers: number;
  signups_7d: number;
  published_7d: number;
  applications_7d: number;
};

export type EmployerConversionRow = {
  id: string;
  slug: string;
  title_ar: string;
  title_en: string | null;
  views: number;
  applications: number;
};

export type EmployerTrend =
  | { has_company: false }
  | {
      has_company: true;
      days: { d: string; applications: number }[];
      conversion: EmployerConversionRow[];
    };

export type AdminTrend = {
  days: { d: string; signups: number; published: number; applications: number }[];
};

export type ApprovalStatus = 'approved' | 'pending' | 'rejected';

export type NotificationKind =
  | 'application_received'
  | 'application_moved'
  | 'job_published'
  | 'job_rejected'
  | 'company_verified'
  | 'account_approved'
  | 'account_rejected';

/**
 * The payload holds data, never a rendered sentence — the site is read in two
 * languages and a sentence stored at write time is wrong for half the readers
 * forever. Every field is optional because it is a snapshot of whatever the
 * event had to hand.
 */
export type NotificationRow = {
  id: string;
  user_id: string;
  kind: NotificationKind;
  payload: {
    job_id?: string;
    slug?: string;
    title_ar?: string;
    title_en?: string | null;
    name_ar?: string;
    name_en?: string | null;
    status?: string;
    note?: string | null;
  };
  href: string | null;
  read_at: string | null;
  created_at: string;
};

export type AgentExperienceRow = Timestamped & {
  id: string;
  agent_id: string;
  company_name: string;
  title: string;
  track: JobTrack | null;
  district_id: number | null;
  started: string;
  /** Null means current. A separate flag would be a second truth that drifts. */
  ended: string | null;
  highlights: string | null;
  sort_order: number;
};

export type AgentEducationRow = Timestamped & {
  id: string;
  agent_id: string;
  institution: string;
  degree: string | null;
  field: string | null;
  graduated: number | null;
  sort_order: number;
};

export type AgentCertificationRow = Timestamped & {
  id: string;
  agent_id: string;
  name: string;
  issuer: string | null;
  issued: string | null;
  expires: string | null;
  sort_order: number;
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
  /** The objective, in the consultant's own words. */
  summary_ar: string | null;
  summary_en: string | null;
  units_closed: number | null;
  /** Self-reported closed value in EGP. The platform does not verify it. */
  volume_egp: number | null;
};

export type SavedSearchRow = Timestamped & {
  id: string;
  candidate_id: string;
  label: string;
  /** The canonical query string, minus page and sort. Parsed by parseJobFilters. */
  query: string;
  alerts: boolean;
  /** Written by the alert job only; the guard rejects an owner touching it. */
  last_sent_at: string | null;
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
      /**
       * No Insertable worth naming: nothing in the app writes one. Every row
       * comes from a trigger, and the table has no insert policy on purpose —
       * an account that can write its own notification can write one that
       * appears to come from the platform.
       */
      notifications: Table<NotificationRow, never>;
      agent_experience: Table<
        AgentExperienceRow,
        Insertable<AgentExperienceRow, 'agent_id' | 'company_name' | 'title' | 'started'>
      >;
      agent_education: Table<
        AgentEducationRow,
        Insertable<AgentEducationRow, 'agent_id' | 'institution'>
      >;
      agent_certifications: Table<
        AgentCertificationRow,
        Insertable<AgentCertificationRow, 'agent_id' | 'name'>
      >;
      agent_profiles: Table<AgentProfileRow, Insertable<AgentProfileRow, 'user_id' | 'slug'>>;
      agent_developers: Table<{ agent_id: string; developer_id: number }, { agent_id: string; developer_id: number }>;
      saved_searches: Table<
        SavedSearchRow,
        Insertable<SavedSearchRow, 'candidate_id' | 'label'>
      >;
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
      profile_completeness: { Args: { p_agent_id: string }; Returns: number };

      /**
       * One round trip per dashboard. Each scopes itself to auth.uid()
       * internally — there is no argument saying whose numbers to fetch, so
       * there is nothing to forge.
       */
      candidate_summary: { Args: Empty; Returns: CandidateSummary };
      employer_summary: { Args: Empty; Returns: EmployerSummary };
      admin_summary: { Args: Empty; Returns: AdminSummary };
      employer_trend: { Args: Empty; Returns: EmployerTrend };
      admin_trend: { Args: Empty; Returns: AdminTrend };
      set_account_approval: {
        Args: { p_user: string; p_status: ApprovalStatus; p_note?: string | null };
        Returns: undefined;
      };
      /** Returns how many rows it marked, so the caller can say nothing changed. */
      mark_notifications_read: { Args: Empty; Returns: number };
      /**
       * Returns what happened rather than void: the webhook needs to tell a
       * first delivery from a retry, and every outcome here is a 200.
       */
      settle_order: {
        Args: { p_order_id: string; p_paymob_order_id: string | null; p_success: boolean };
        Returns:
          | 'paid'
          | 'failed'
          | 'unknown_order'
          | 'already_paid'
          | 'already_failed'
          | 'already_refunded';
      };
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
