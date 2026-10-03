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
export type CompanyType = 'brokerage' | 'developer';
export type HeadcountBand = '1_10' | '11_50' | '51_200' | '201_500' | '500_plus';
export type PackKey = 'single' | 'bulk' | 'mass_hiring' | 'featured_addon';
export type ReportReason =
  | 'fake_listing'
  | 'misleading_pay'
  | 'duplicate'
  | 'spam'
  | 'discriminatory'
  | 'other'
  // Migration 317: what a report about a company or a person needs.
  | 'scam'
  | 'impersonation'
  | 'harassment'
  | 'suspicious_company'
  | 'inappropriate';

/** open -> investigating -> resolved | dismissed. `resolved` on the row follows it. */
export type ReportStatus = 'open' | 'investigating' | 'resolved' | 'dismissed';
export type ReportTargetType = 'job' | 'company' | 'agent';

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
  /** Employer: batch applicant notices into one daily email. Gated by notify_applications. */
  notify_applicant_digest: boolean;
  /** Candidate: the one-time "finish your profile" reminder. Off unless turned on (migration 337); absent before it. */
  notify_profile_nudge?: boolean;
  /**
   * Pushes, by kind, for all of the person's phones (migration 335): the day's
   * new listings, application events, and everything else. The bell has them
   * either way. Absent until that migration is applied.
   */
  push_job_alerts?: boolean;
  push_applications?: boolean;
  push_account?: boolean;
  /** Hold pushes made between 23:00 and 08:00 Cairo time until eight. Off unless turned on. */
  push_quiet_hours?: boolean;
  /**
   * Whether this account may act. Candidates arrive approved; companies wait
   * for an admin, because the side that collects CVs and phone numbers is the
   * side worth checking by hand. Separate from company verification, which
   * asks whether the papers are real rather than whether the account may post.
   */
  approval_status: ApprovalStatus;
  approved_at: string | null;
  /** full_name folded for search (migration 68). Generated, never written. */
  search_name?: string;
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

/** An extra name for exactly one district, governorate or track (migration 68). */
export type SearchAliasRow = {
  id: number;
  alias: string;
  district_id: number | null;
  governorate_id: number | null;
  track: JobTrack | null;
  created_at: string;
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
  /** Stated by the company. Null is unclassified, and absent before migration 67. */
  company_type?: CompanyType | null;
  district_id: number | null;
  verification_status: VerificationStatus;
  verified_at: string | null;
  post_credits: number;
  /** Bumped on every update; the edit form sends back the one it loaded. */
  version: number;
  /**
   * An admin's firm-level switch (migration 317). A suspended company has
   * nothing on the board and can submit nothing. Optional because code
   * reaches production before the migration as often as after.
   */
  suspended_at?: string | null;
  suspension_reason?: string | null;
  /**
   * Both names folded for search (migration 68). Generated by the database,
   * never written; absent before that migration.
   */
  search_name?: string;
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

export type CompanyMemberRole = 'admin' | 'recruiter';

export type CompanyMemberRow = Timestamped & {
  company_id: string;
  user_id: string;
  role: CompanyMemberRole;
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
  /**
   * Always null since migration 347: a moderator's note is in job_moderation,
   * for the listing's company. Read through src/lib/listing-notes.ts, which
   * falls back to this column on a database before 347.
   */
  rejection_note: string | null;
  /** Bumped on every update; the edit form sends back the one it loaded. */
  version: number;
  /**
   * Made once by the posting wizard and repeated on every retry, so a request
   * that timed out after the server committed converges on the listing it
   * already made. Null on everything written before migration 55.
   */
  idempotency_key: string | null;
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
  /**
   * Distinct companies that opened this consultant's profile in the last
   * thirty days. Companies, not visits — the log holds one row per company per
   * day, so a brokerage that came back on Thursday is two rows and one
   * company. Zero until somebody looks; the dashboard shows nothing then.
   */
  profile_views_30d: number;
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
      /**
       * Ended and repostable — expired, closed, or still labelled active with a
       * window that has already closed, because the cron that relabels needs a
       * key production does not have.
       */
      ended_jobs: number;
      total_views: number;
      seats_advertised: number;
      applicants_total: number;
      applicants_new: number;
      /** Never opened by anybody at the company — the digest email's definition. */
      applicants_unseen: number;
      applicants_7d: number;
      applicants_prev_7d: number;
      credits: number;
      verification: VerificationStatus;
    };

export type AdminSummary = {
  queue_total: number;
  queue_over_24h: number;
  reports_open: number;
  /** Migration 328. Absent before it. */
  appeals_open?: number;
  companies_pending: number;
  /** Employer accounts between signing up and being allowed to post. */
  accounts_pending: number;
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
  | 'application_submitted'
  | 'application_received'
  | 'application_withdrawn'
  | 'application_moved'
  | 'job_published'
  | 'job_rejected'
  | 'company_verified'
  | 'account_approved'
  | 'account_rejected'
  // Migration 300.
  | 'job_expiring'
  | 'job_expired'
  | 'company_verification_needed'
  | 'profile_visibility_changed'
  | 'password_changed'
  // Migration 200: support answered a request (written by 201's answer function).
  | 'support_replied'
  // Moderation (migration 325): the decision's subject is told, and so is
  // whoever reported or appealed.
  | 'report_reviewed'
  | 'company_suspended'
  | 'company_restored'
  | 'profile_restricted'
  | 'profile_restored'
  | 'account_held'
  | 'appeal_decided'
  // Migrations 333–334: the day's new listings from a person's saved searches
  // and followed companies (/api/cron/new-jobs).
  | 'new_jobs';

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
    company_ar?: string;
    company_en?: string | null;
    visibility?: string;
    expires_at?: string;
    /** password_changed: when the change happened. */
    at?: string;
    /** application_received: applicants folded into this row since it was last read. */
    count?: number;
    /** support_replied: the request's quotable reference and topic. */
    reference?: string;
    topic?: string;
    /** report_reviewed: what the report was about, and whether it led to action. */
    target_type?: ReportTargetType;
    outcome?: 'actioned' | 'reviewed' | 'upheld' | 'overturned';
    /** appeal_decided: what the appeal was about. */
    subject_type?: AppealSubjectType;
    /** new_jobs: what found the listings — one followed company, one search, or several. */
    source?: 'follow' | 'search' | 'mixed';
    /** new_jobs: the saved search's own name, when one search found them. */
    label?: string;
  };
  href: string | null;
  read_at: string | null;
  created_at: string;
  /** Platform-written; what makes two notifications the same one (migration 300). */
  dedupe_key: string | null;
  /** Absorbed into this unread applicant row; hidden from the feed (migration 302). */
  folded_into: string | null;
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

/**
 * The company's own note on an applicant.
 *
 * Not a column on `applications`: row-level security is row-level, so a column
 * would reach the candidate through their own select policy whatever the query
 * asked for. See migration 58.
 */
export type ApplicationNoteRow = {
  id: number;
  application_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
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
  /**
   * When the owner last chose who sees the card, on the database's clock
   * (migration 336). Null for a card made before anybody was asked. Send any
   * value to mark an explicit choice; the database replaces it with now().
   */
  visibility_chosen_at?: string | null;
  /** Set by an admin (migration 317); pins visibility to hidden until lifted. */
  restricted_at?: string | null;
  restriction_reason?: string | null;
  /** Both headlines folded for search (migration 68). Generated, never written. */
  search_headline?: string;
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
  /**
   * When the alert job last looked at this search, whether or not it found
   * anything. The job's cursor: it orders by this, so a search with nothing
   * new moves to the back of the line instead of starving the ones behind it.
   * Job-written only, same guard as last_sent_at.
   */
  last_checked_at: string | null;
  /** The daily new-jobs job's own cursor (migration 334), apart from the weekly email's. Job-written only. */
  bell_checked_at: string | null;
};

export type EmailStatus =
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'bounced'
  | 'complained'
  | 'failed'
  | 'suppressed'
  /** Not attempted again: by retry time there was nothing left to send (recipient opted out, entity gone, superseded). */
  | 'cancelled';

/**
 * The outbox. Metadata only — no message body is stored, because the question
 * it exists to answer is "did it go and what happened to it".
 */
export type EmailLogRow = {
  id: string;
  dedupe_key: string | null;
  template: string;
  recipient: string;
  user_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  status: EmailStatus;
  attempts: number;
  provider_id: string | null;
  error: string | null;
  created_at: string;
  sent_at: string | null;
  delivered_at: string | null;
  /** When the sweeper may next try. Null once the row is finished or given up on. */
  next_attempt_at: string | null;
  /** A sweeper's lease on the row; past it, the worker is presumed dead. */
  locked_until: string | null;
  lock_token: string | null;
  last_attempt_at: string | null;
  /** Dead-lettered: set when retries are exhausted, the failure is permanent, or the window elapsed. */
  gave_up_at: string | null;
  /** How many times a sweeper has leased this row. Bounds a row that crashes its worker. */
  leases: number;
  /** An admin put a dead-lettered row back in the queue; restarts the retry window. */
  requeued_at: string | null;
};

export type SuppressionReason = 'hard_bounce' | 'complaint' | 'provider' | 'repeated_soft_bounce';

export type EmailSuppressionRow = {
  email: string;
  reason: SuppressionReason;
  created_at: string;
};

/** What email_activity() returns — the outbox minus the recipient's user id. */
export type EmailActivityRow = {
  id: string;
  template: string;
  recipient: string;
  status: EmailStatus;
  attempts: number;
  entity_type: string | null;
  entity_id: string | null;
  error: string | null;
  created_at: string;
  sent_at: string | null;
  delivered_at: string | null;
};

/** A row email_dead_letters() returns: a message the system stopped trying to send. */
export type EmailDeadLetterRow = {
  id: string;
  template: string;
  recipient: string;
  attempts: number;
  entity_type: string | null;
  entity_id: string | null;
  error: string | null;
  created_at: string;
  last_attempt_at: string | null;
  gave_up_at: string;
};

/** What lease_due_emails() hands a sweeper: the row and the token that proves it holds it. */
export type LeasedEmailRow = {
  id: string;
  template: string;
  entity_id: string | null;
  /** The recipient the row recorded; some rebuilders need it (rebuild.ts). */
  user_id: string | null;
  attempts: number;
  lock_token: string;
};

/** Somebody asking for help, or an owner asking for their account to be deleted (migrations 201, 330). */
export type SupportRequestTopic =
  | 'login'
  | 'verification_email'
  | 'apply'
  | 'cv_upload'
  | 'company_verification'
  | 'job_not_published'
  | 'profile_visibility'
  | 'directory_access'
  | 'account_deletion'
  | 'other';

export type SupportRequestRow = {
  id: string;
  reference: string;
  request_key: string;
  user_id: string | null;
  role: 'candidate' | 'employer' | 'admin' | 'onboarding' | null;
  contact_email: string | null;
  topic: SupportRequestTopic;
  message: string;
  error_reference: string | null;
  route: string | null;
  client: string | null;
  locale: 'ar' | 'en' | null;
  release: string | null;
  status: 'open' | 'answered' | 'closed';
  reply: string | null;
  replied_by: string | null;
  replied_at: string | null;
  created_at: string;
  updated_at: string;
};

/** A phone signed in with the app (migration 329). Written through register_push_device only. */
/** One agreement to the Terms of use and the Privacy policy (migration 336). Written by record_policy_acceptance() only. */
export type PolicyAcceptanceRow = {
  id: number;
  user_id: string;
  /** The documents' `updated` dates (content/legal/*.ar.md). */
  terms_version: string;
  privacy_version: string;
  accepted_at: string;
};

export type PushDeviceRow = {
  id: string;
  user_id: string;
  token: string;
  platform: 'ios' | 'android';
  locale: 'ar' | 'en';
  app_version: string | null;
  created_at: string;
  last_seen_at: string;
  disabled_at: string | null;
  disabled_reason: string | null;
};

export type PushOutboxRow = {
  id: number;
  notification_id: string;
  user_id: string;
  status: 'queued' | 'sent' | 'skipped' | 'failed';
  attempts: number;
  leases: number;
  next_attempt_at: string;
  lease_until: string | null;
  lock_token: string | null;
  created_at: string;
  settled_at: string | null;
  detail: string | null;
};

export type PushTicketRow = {
  ticket_id: string;
  device_id: string;
  outbox_id: number | null;
  created_at: string;
};

/** What lease_due_pushes() hands the sender: the row and the token that proves it holds it. */
export type LeasedPushRow = {
  id: number;
  notification_id: string;
  user_id: string;
  attempts: number;
  lock_token: string;
};

export type SettlePushOutcome = 'sent' | 'skipped' | 'retry' | 'failed';

export type OutboxOverview = {
  /** Eligible for a retry right now. */
  due: number;
  /** Leased by a sweeper whose lease has not run out. */
  in_flight: number;
  /** Retryable later (failed, waiting out its backoff). */
  waiting: number;
  /** Given up on in the last 30 days. */
  dead: number;
  oldest_due_at: string | null;
};

export type JobRunStatus = 'running' | 'succeeded' | 'failed' | 'skipped';

/** One execution of a scheduled job. Stats are counts only — never a payload. */
export type JobRunRow = {
  id: string;
  job: string;
  status: JobRunStatus;
  started_at: string;
  finished_at: string | null;
  lease_until: string | null;
  duration_ms: number | null;
  stats: Record<string, number | boolean | string>;
  error: string | null;
};

/** One row per scheduled job, for the operations screen. */
export type ScheduledJobOverviewRow = {
  job: string;
  last_started_at: string | null;
  last_status: JobRunStatus | null;
  last_duration_ms: number | null;
  last_error: string | null;
  last_stats: Record<string, number | boolean> | null;
  last_success_at: string | null;
  failures_7d: number;
  running: boolean;
};

export type SettleLeasedOutcome = 'cancelled' | 'dead' | 'defer' | 'failed';

export type SavedJobRow = Timestamped & {
  candidate_id: string;
  job_id: string;
};

/**
 * What a report was about, as it stood when it was filed (migration 326).
 * Written by the database, never by the reporter.
 */
export type ReportSnapshot = {
  label_ar?: string;
  label_en?: string | null;
  slug?: string;
  status?: string;
  company_id?: string;
  company_name_ar?: string;
  company_name_en?: string | null;
  website?: string | null;
  user_id?: string;
  excerpt?: string | null;
};

export type ReportSource = 'user' | 'system';
/** From the reason alone: 3 fraud or harm alleged, 2 misleading or offensive, 1 quality. */
export type ReportSeverity = 1 | 2 | 3;

/**
 * At most one of job_id, company_id and agent_id is set — none once the
 * target has been deleted, when target_type/target_id still say what it was.
 */
export type ReportRow = Timestamped & {
  id: string;
  job_id: string | null;
  company_id: string | null;
  agent_id: string | null;
  reporter_id: string | null;
  reason: ReportReason;
  detail: string | null;
  status: ReportStatus;
  resolved: boolean;
  resolved_by: string | null;
  resolved_at: string | null;
  /** Migration 326; optional so code can run before it. */
  target_type?: ReportTargetType;
  target_id?: string;
  target_snapshot?: ReportSnapshot;
  source?: ReportSource;
  abusive?: boolean;
  severity?: ReportSeverity;
};

/** One reported thing and every open report about it (admin_report_cases). */
export type AdminReportCase = {
  target_type: ReportTargetType;
  target_id: string;
  label_ar: string | null;
  label_en: string | null;
  company_id: string | null;
  company_name_ar: string | null;
  company_name_en: string | null;
  /** The target as it is now: a job status, suspended/listed, restricted/visibility, or deleted. */
  target_state: string;
  reports: number;
  reporters: number;
  open_reports: number;
  investigating_reports: number;
  system_flags: number;
  max_severity: ReportSeverity;
  reasons: ReportReason[];
  first_at: string;
  last_at: string;
  fresh_reporters: number;
  noisy_reporters: number;
  employer_reporters: number;
  report_ids: string[];
  total_count: number;
};

/** A report with what a moderator needs to weigh the person who sent it (admin_report_rows). */
export type AdminReportDetail = {
  id: string;
  target_type: ReportTargetType;
  target_id: string;
  target_live: boolean;
  reason: ReportReason;
  severity: ReportSeverity;
  detail: string | null;
  status: ReportStatus;
  source: ReportSource;
  abusive: boolean;
  created_at: string;
  resolved_at: string | null;
  target_snapshot: ReportSnapshot;
  reporter_id: string | null;
  reporter_name: string | null;
  reporter_role: UserRole | null;
  reporter_since: string | null;
  reporter_company_ar: string | null;
  reporter_company_en: string | null;
  reporter_filed: number;
  reporter_dismissed: number;
  reporter_abusive: number;
  reporter_restricted: boolean;
  total_count: number;
};

/** A text flag (migration 327): what raised it, and how much it weighs. */
export type SafetyFlag = {
  flag:
    | 'asks_for_money'
    | 'asks_for_documents'
    | 'shortened_link'
    | 'telegram_link'
    | 'form_link'
    | 'suspicious_link'
    | 'whatsapp_link'
    | 'external_link'
    | 'phone_in_text'
    | 'email_in_text'
    | 'impersonation';
  weight: 'high' | 'low';
  evidence?: string;
  kind?: 'developer' | 'company';
};

export type SignalCompanyRef = { id: string; name_ar: string; name_en: string | null; suspended: boolean };

/** A company signal (migration 327). Each is a fact for review, never a verdict. */
export type CompanySignal =
  | { signal: 'mass_posting'; day: number; week: number }
  | { signal: 'rejections'; count: number }
  | { signal: 'duplicate_listings'; count: number }
  | { signal: 'copied_listings'; companies: SignalCompanyRef[] }
  | { signal: 'reported'; reporters: number; reports: number }
  | { signal: 'company_text'; flags: SafetyFlag[] }
  | { signal: 'flagged_listings'; count: number }
  | { signal: 'shared_phone'; companies: SignalCompanyRef[] }
  | { signal: 'phone_of_suspended_account'; count: number }
  | { signal: 'shared_website'; site: string; companies: SignalCompanyRef[] };

export type CompanySignals = {
  signals: CompanySignal[];
  facts: { new?: boolean; verified?: boolean; suspended?: boolean };
};

export type AppealSubjectType = 'job' | 'company' | 'account' | 'agent';
export type AppealStatus = 'open' | 'upheld' | 'overturned';

/** One message about one decision, and one answer (migration 328). */
export type AppealRow = {
  id: string;
  subject_type: AppealSubjectType;
  subject_id: string;
  appellant_id: string | null;
  message: string;
  decision_snapshot: {
    status?: string;
    note?: string | null;
    label_ar?: string | null;
    label_en?: string | null;
    suspended_at?: string;
    restricted_at?: string;
    company_id?: string;
  };
  status: AppealStatus;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
};

/** What the page offers about one decision (my_appeal_state, migration 328). */
export type AppealState = {
  appealable: boolean;
  open: { id: string; created_at: string } | null;
  last: { status: Exclude<AppealStatus, 'open'>; decided_at: string; note: string | null } | null;
};

/** A company's suspension reason, readable by its members and admins only (migration 327). */
export type CompanyModerationRow = {
  company_id: string;
  suspension_reason: string | null;
  updated_at: string;
};

/**
 * Why a moderator refused or took down a listing (migration 347): the
 * listing's company and the admins read it. Before 347 it was the listing's
 * own rejection_note, which is always null since.
 */
export type JobModerationRow = {
  job_id: string;
  rejection_note: string | null;
  updated_at: string;
};

/** One move of an application (migration 42). Written only by a trigger. */
export type ApplicationEventRow = {
  id: number;
  application_id: string;
  from_status: ApplicationStatus | null;
  to_status: ApplicationStatus;
  actor_id: string | null;
  created_at: string;
};

export type AuditTargetType = 'user' | 'company' | 'job' | 'agent' | 'application' | 'report' | 'taxonomy';

/** Append-only (migration 316). Readable by admins, written only by admin_audit(). */
export type AdminAuditRow = {
  id: number;
  actor_id: string | null;
  actor_name: string | null;
  /** `<noun>.<verb>`, e.g. job.unpublish, company.suspended. */
  action: string;
  target_type: AuditTargetType;
  target_id: string;
  target_label: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  via: 'console' | 'direct';
  created_at: string;
};

export type ModerationNoteRow = {
  id: number;
  target_type: AuditTargetType;
  target_id: string;
  author_id: string | null;
  author_name: string | null;
  body: string;
  created_at: string;
};

export type AdminOverview = {
  jobs: {
    live: number;
    pending: number;
    pending_24h: number;
    expired: number;
    closed: number;
    rejected: number;
    draft: number;
    expiring_7d: number;
    featured: number;
    live_no_applicants: number;
  };
  applications: { total: number; last_7d: number; prev_7d: number; unopened_7d: number };
  companies: { total: number; hiring: number; pending: number; verified: number; suspended: number };
  accounts: {
    candidates: number;
    employers: number;
    admins: number;
    pending: number;
    suspended: number;
    signups_7d: number;
  };
  agents: { total: number; public: number; gated: number; hidden: number; restricted: number };
  reports: {
    open_targets: number;
    open_jobs: number;
    open_companies: number;
    open_agents: number;
    investigating: number;
    last_7d: number;
  };
  recent: Pick<
    AdminAuditRow,
    'id' | 'actor_name' | 'action' | 'target_type' | 'target_id' | 'target_label' | 'via' | 'created_at'
  >[];
  generated_at: string;
};

/** admin_search_users(): no phone, no email — those come one at a time from admin_reveal_contact. */
export type AdminUserSearchRow = {
  id: string;
  role: UserRole;
  full_name: string;
  avatar_url: string | null;
  approval_status: ApprovalStatus;
  approval_note: string | null;
  created_at: string;
  company_id: string | null;
  company_name_ar: string | null;
  company_name_en: string | null;
  agent_slug: string | null;
  agent_restricted: boolean;
  total_count: number;
};

export type AdminSearchKind = 'user' | 'company' | 'job' | 'agent' | 'application';

export type AdminSearchRow = {
  kind: AdminSearchKind;
  id: string;
  label: string | null;
  sublabel: string | null;
  state: string | null;
};

export type AdminUserFacts = {
  email_confirmed?: boolean;
  last_sign_in_at?: string | null;
  auth_created_at?: string | null;
  providers?: string[];
};

export type TaxonomyKind = 'district' | 'governorate' | 'developer';

export type OrderRow = Timestamped & {
  id: string;
  company_id: string;
  pack_key: PackKey;
  credits: number;
  amount_egp: number;
  paymob_order_id: string | null;
  status: 'pending' | 'paid' | 'failed' | 'refunded';
};

/**
 * Row shape returned by the get_agent_card() RPC.
 *
 * No phone number and no CV path, since migration 304: the card says whether a
 * CV exists and whether this viewer may ask for the contact, and the contact
 * itself comes from reveal_agent_contact(), which counts what it hands over.
 * `slug` is the card's public handle — the real slug when the name is
 * visible, the row's id when it is not.
 */
export type AgentCardDetail = {
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
  developer_ids: number[];
  has_cv: boolean;
  can_reveal: boolean;
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
 * Row shape returned by the salary_reference() RPC — at most one row, and
 * none at all below the sample-size threshold, which is how "we do not know
 * yet" is expressed without a number attached to it.
 */
export type SalaryReferenceRow = {
  /** Live listings the range is made of. Always shown beside it. */
  sample: number;
  /** Median of the advertised floors. */
  low: number;
  /** Median of the advertised ceilings. */
  high: number;
};

/**
 * The company's shortlist. Nothing here is a copy of the directory: the row
 * is an id and a timestamp, and `saved_agent_cards()` decides on every read
 * what of the consultant may still be shown.
 */
export type SavedAgentRow = {
  company_id: string;
  agent_id: string;
  saved_by: string | null;
  created_at: string;
};

/**
 * Row shape returned by the saved_agent_cards() RPC.
 *
 * Everything but `id`, `is_listed` and `saved_at` is nullable, and not as a
 * convenience: a consultant who has left the directory comes back as a row
 * with nothing in it, which is what lets an employer tidy a list they can no
 * longer read without the list telling them anything about why.
 */
export type SavedAgentCardRow = {
  id: string;
  slug: string | null;
  is_listed: boolean;
  is_unlocked: boolean;
  full_name: string | null;
  avatar_url: string | null;
  headline_ar: string | null;
  headline_en: string | null;
  years_experience: number | null;
  tracks: JobTrack[] | null;
  district_ids: number[] | null;
  languages: string[] | null;
  availability: AgentAvailability | null;
  saved_at: string;
  saved_by_name: string | null;
  total_count: number;
};

/**
 * The half of a profile nobody but the platform reads (migration 305). The
 * unsubscribe token is a credential; the approval note is a reviewer's remark.
 * Neither has a policy that lets a user read it, and only the service role and
 * set_account_approval() write here.
 */
export type ProfilePrivateRow = {
  user_id: string;
  unsubscribe_token: string;
  approval_note: string | null;
  updated_at: string;
};

/** A threshold the database enforces, as a row an admin can tune (migration 304). */
export type AbuseLimitRow = {
  key: string;
  window_seconds: number;
  max_hits: number;
  note: string | null;
  updated_at: string;
};

/** One consultant contact handed to one viewer (migration 304). */
export type AgentContactRevealRow = {
  id: number;
  agent_id: string;
  viewer_id: string;
  company_id: string | null;
  created_at: string;
};

/** A decision somebody made, recorded by the table it changed (migration 303). */
export type AuditLogRow = {
  id: number;
  actor_id: string | null;
  actor_role: string;
  action: string;
  target_type: string;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type SecuritySeverity = 'info' | 'warning' | 'critical';

/** Something the platform noticed rather than decided (migration 303). */
export type SecurityEventRow = {
  id: number;
  kind: string;
  severity: SecuritySeverity;
  actor_id: string | null;
  subject_hash: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

/** What the security page draws (migration 313). */
export type SecuritySummary = {
  window_hours: number;
  events_by_kind: { kind: string; count: number }[];
  events_total: number;
  events_warning: number;
  events_critical: number;
  reveals_24h: number;
  reveals_top_viewers: { viewer_id: string; count: number }[];
  rate_limited_24h: number;
  uploads_rejected_24h: number;
  auth_failures_24h: number;
  accounts_suspended: number;
  accounts_pending: number;
  reports_open: number;
  jobs_pending: number;
  signups_24h: number;
  applications_24h: number;
};

/** What reveal_agent_contact() answers with — one row, always. */
export type ContactRevealRow = {
  status: 'ok' | 'unauthenticated' | 'forbidden' | 'locked' | 'not_found' | 'rate_limited';
  retry_after_seconds: number | null;
  full_name: string | null;
  whatsapp_phone: string | null;
  cv_path: string | null;
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
      company_members: Table<
        CompanyMemberRow,
        Insertable<CompanyMemberRow, 'company_id' | 'user_id'>
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
      /** Written only by refresh_job_search(), from triggers. Read to filter the board. */
      job_search_documents: Table<{ job_id: string; document: string; refreshed_at: string }, never>;
      search_aliases: Table<SearchAliasRow, Insertable<SearchAliasRow, 'alias'>>;
      applications: Table<ApplicationRow, Insertable<ApplicationRow, 'job_id' | 'candidate_id'>>;
      application_notes: Table<
        ApplicationNoteRow,
        Insertable<ApplicationNoteRow, 'application_id' | 'body'>
      >;
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
      /**
       * No Update shape that means anything — every column is either the
       * identity of the row or a record of who made it and when, so the
       * table carries no update policy either.
       */
      saved_agents: Table<
        SavedAgentRow,
        Insertable<SavedAgentRow, 'company_id' | 'agent_id' | 'saved_by'>
      >;
      reports: Table<ReportRow, Insertable<ReportRow, 'reason'>>;
      orders: Table<OrderRow, Insertable<OrderRow, 'company_id' | 'pack_key' | 'credits' | 'amount_egp'>>;
      monthly_free_post_grants: Table<
        { company_id: string; period: string; granted_at: string },
        { company_id: string; period: string; granted_at?: string }
      >;
      /**
       * Written through claim_email/record_email_attempt rather than a plain
       * insert, so the unique dedupe key is claimed in one statement. RLS is on
       * with no policies at all: the only readers are the service role and
       * admins going through email_activity().
       */
      email_log: Table<EmailLogRow, never>;
      /** Scheduled-job runs. RLS on, no policies: service role and admin functions only. */
      job_runs: Table<JobRunRow, never>;
      /** Its owner reads it; register_push_device / unregister_push_device write it; the sender disables it. */
      push_devices: Table<PushDeviceRow, never>;
      policy_acceptances: Table<PolicyAcceptanceRow, never>;
      /** Read by its sender and by admins; written only through submit_support_request(), answered through admin_answer_support_request(). */
      support_requests: Table<SupportRequestRow, never>;
      /** Queued by the notifications trigger; RLS on, no policies: the sender (service role) only. */
      push_outbox: Table<PushOutboxRow, never>;
      /** Expo tickets awaiting their receipts; the sender (service role) only. */
      push_tickets: Table<PushTicketRow, Pick<PushTicketRow, 'ticket_id' | 'device_id'> & Partial<PushTicketRow>>;
      application_events: Table<ApplicationEventRow, never>;
      /** No Insertable: admin_audit() is the only writer, and it is not callable from the API. */
      admin_audit_log: Table<AdminAuditRow, never>;
      /** Written through admin_add_note(). */
      moderation_notes: Table<ModerationNoteRow, never>;
      /** Admin-only, written through admin_set_reporting_restriction(). */
      reporting_restrictions: Table<
        { user_id: string; reason: string; restricted_by: string | null; created_at: string },
        never
      >;
      /** Written through submit_appeal() and admin_decide_appeal() only. */
      moderation_appeals: Table<AppealRow, never>;
      /** Written by admin_set_company_suspension() only. */
      company_moderation: Table<CompanyModerationRow, never>;
      /** Written by admin_moderate_job() and the suspension levers only. */
      job_moderation: Table<JobModerationRow, never>;
      email_suppressions: Table<
        EmailSuppressionRow,
        { email: string; reason: SuppressionReason; created_at?: string }
      >;
      /** Service role and set_account_approval() only; admins may read. */
      profile_private: Table<ProfilePrivateRow, never>;
      abuse_limits: Table<AbuseLimitRow, Insertable<AbuseLimitRow, 'key' | 'window_seconds' | 'max_hits'>>;
      /** Written by reveal_agent_contact() alone. */
      agent_contact_reveals: Table<AgentContactRevealRow, never>;
      /** Written by triggers and audit() alone. */
      audit_log: Table<AuditLogRow, never>;
      /** Written by record_security_event() alone. */
      security_events: Table<SecurityEventRow, never>;
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
          /** Matched against the headline, and the name only where the card shows it. */
          p_q?: string | null;
        };
        Returns: AgentCardRow[];
      };
      /** By slug or by id: a locked card is linked by its id. */
      get_agent_card: { Args: { p_handle: string }; Returns: AgentCardDetail[] };
      /**
       * The contact behind a card. Authenticated only; refuses in a status
       * column rather than an exception so a refusal it records — the rate
       * limit — is not rolled back with it.
       */
      reveal_agent_contact: { Args: { p_handle: string }; Returns: ContactRevealRow[] };
      is_company_admin: { Args: { target: string }; Returns: boolean };
      /** Service role only: the server's own counter (migration 306). */
      rate_limit_hit: {
        Args: { p_key: string; p_window_seconds: number; p_max: number };
        Returns: { allowed: boolean; remaining: number; retry_after_seconds: number }[];
      };
      /** Service role only. Subjects arrive hashed. */
      record_security_event: {
        Args: {
          p_kind: string;
          p_severity?: SecuritySeverity;
          p_subject_hash?: string | null;
          p_metadata?: Record<string, string | number | boolean | null>;
          p_actor?: string | null;
        };
        Returns: undefined;
      };
      /** Admin only; raises `forbidden` otherwise. */
      security_summary: { Args: Empty; Returns: SecuritySummary };
      /**
       * One row per consultant per company per day, and nothing comes back.
       * Every refusal — no company, the owner's own preview, an unknown slug —
       * is silent, because none of them is a failure the page should hear
       * about. `agent_profile_views` has no SELECT policy at all: the only
       * route to a number is candidate_summary().
       */
      record_agent_view: { Args: { p_slug: string }; Returns: undefined };
      /**
       * What a role like this pays on the board right now, or nothing.
       *
       * The only SECURITY INVOKER function in this list, because it needs to
       * be: it reads active listings, which is what row-level security shows
       * everyone anyway.
       */
      salary_reference: {
        Args: { p_track: JobTrack; p_governorate_id: number };
        Returns: SalaryReferenceRow[];
      };
      /**
       * Live listings grouped by track x district x company type, under the
       * caller's own row-level security (migration 314). What the home page's
       * browse module counts, without shipping every listing to count it.
       */
      browse_counts: {
        Args: Record<string, never>;
        Returns: {
          track: JobTrack;
          district_id: number;
          company_type: string | null;
          listings: number;
        }[];
      };
      /**
       * The caller's company shortlist. No argument saying whose — it resolves
       * `my_company_id()` itself, so there is nothing to forge, and it
       * re-derives each consultant's visibility rather than trusting what was
       * true when the row was written.
       */
      saved_agent_cards: {
        Args: { p_limit?: number; p_offset?: number };
        Returns: SavedAgentCardRow[];
      };
      increment_job_view: { Args: { job_slug: string }; Returns: undefined };
      claim_monthly_free_post: { Args: Empty; Returns: boolean };
      /** The company the caller belongs to, resolved through membership. */
      my_company_id: { Args: Empty; Returns: string | null };
      /**
       * Service-role only, and called with the admin client: the answer is
       * whether an address has an account, which is not for every signed-in
       * user to ask. Used to find the colleague an employer is inviting.
       */
      user_id_by_email: { Args: { p_email: string }; Returns: string | null };
      /** Bounded since migration 204; the limit defaults to 500 per call. */
      expire_stale_jobs: { Args: { p_limit?: number }; Returns: number };

      /*
        The data lifecycle (migration 204). Service role only, except the two
        readers, which answer admins and refuse everybody else.
      */
      run_lifecycle_maintenance: { Args: Empty; Returns: Record<string, unknown> };
      /** The privacy policy's periods (migration 338): counts per kind, and `errors`. Service role. */
      run_privacy_retention: { Args: { p_limit?: number }; Returns: Record<string, unknown> };
      claim_storage_gc: {
        Args: { p_limit?: number };
        Returns: { bucket: string; path: string }[];
      };
      finish_storage_gc: {
        Args: { p_bucket: string; p_removed: string[]; p_failed?: string[]; p_error?: string | null };
        Returns: undefined;
      };
      abandoned_signups: {
        Args: { p_limit?: number };
        Returns: { user_id: string; created_at: string }[];
      };
      lifecycle_integrity_report: {
        Args: Empty;
        Returns: {
          check_name: string;
          severity: 'error' | 'warn' | 'info';
          repairable: boolean;
          found: number;
          sample: string[];
        }[];
      };
      repair_lifecycle_integrity: {
        Args: { p_apply?: boolean };
        Returns: { repair: string; affected: number; applied: boolean }[];
      };
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
      /**
       * The console's levers (migration 318). Each checks is_admin(), locks the
       * row, refuses a transition that makes no sense, and writes the audit
       * record in the same transaction.
       */
      admin_moderate_job: {
        Args: {
          p_job: string;
          p_action: 'approve' | 'reject' | 'request_changes' | 'unpublish' | 'close' | 'restore';
          p_reason?: string | null;
          /** The version the moderator read; a change since is refused (migration 346). */
          p_version?: number | null;
        };
        Returns: JobStatus;
      };
      admin_set_job_featured: { Args: { p_job: string; p_featured: boolean }; Returns: undefined };
      admin_review_company: {
        Args: {
          p_company: string;
          p_decision: 'verify' | 'reject' | 'request_changes' | 'revoke';
          p_note?: string | null;
          /** The version the reviewer read; a change since is refused (migration 346). */
          p_version?: number | null;
        };
        Returns: VerificationStatus;
      };
      /** Closes an account deletion request, on the record (migration 346). */
      admin_close_deletion_request: { Args: { p_id: string }; Returns: string };
      admin_set_company_suspension: {
        Args: { p_company: string; p_suspend: boolean; p_reason: string };
        Returns: number;
      };
      admin_set_agent_restriction: {
        Args: { p_agent: string; p_restrict: boolean; p_reason: string };
        Returns: undefined;
      };
      admin_moderate_reports: {
        Args: {
          p_target_type: ReportTargetType;
          p_target_id: string;
          p_status: Exclude<ReportStatus, 'open'>;
          p_note?: string | null;
          p_take_action?: boolean;
        };
        Returns: { reports: number; took_action: boolean };
      };
      admin_add_note: {
        Args: { p_target_type: AuditTargetType; p_target_id: string; p_body: string };
        Returns: number;
      };
      /** Moderation (migrations 326–328). Each checks is_admin() itself. */
      admin_close_reports: {
        Args: {
          p_reports: string[];
          p_status: Exclude<ReportStatus, 'open'>;
          p_note?: string | null;
          p_abusive?: boolean;
        };
        Returns: number;
      };
      admin_set_reporting_restriction: {
        Args: { p_user: string; p_restrict: boolean; p_reason: string };
        Returns: undefined;
      };
      admin_report_cases: {
        Args: {
          p_view?: 'new' | 'under_review';
          p_type?: ReportTargetType | null;
          p_reason?: ReportReason | null;
          p_min_severity?: number | null;
          p_from?: string | null;
          p_to?: string | null;
          p_min_reporters?: number | null;
          p_target?: string | null;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: AdminReportCase[];
      };
      admin_report_rows: {
        Args: {
          p_ids?: string[] | null;
          p_status?: ReportStatus | null;
          p_type?: ReportTargetType | null;
          p_reason?: ReportReason | null;
          p_min_severity?: number | null;
          p_from?: string | null;
          p_to?: string | null;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: AdminReportDetail[];
      };
      admin_job_signals: {
        Args: { p_jobs: string[] };
        Returns: { job_id: string; flags: SafetyFlag[]; company_id: string; company_signals: CompanySignals }[];
      };
      admin_company_signals: {
        Args: { p_companies: string[] };
        Returns: { company_id: string; flags: SafetyFlag[]; signals: CompanySignals }[];
      };
      admin_flagged_pending_jobs: { Args: { p_limit?: number }; Returns: string[] };
      admin_decide_appeal: {
        Args: { p_appeal: string; p_overturn: boolean; p_note?: string | null };
        Returns: Exclude<AppealStatus, 'open'>;
      };
      submit_appeal: {
        Args: { p_subject_type: AppealSubjectType; p_subject_id: string; p_message: string };
        Returns: string;
      };
      my_appeal_state: {
        Args: { p_subject_type: AppealSubjectType; p_subject_id: string };
        Returns: AppealState;
      };
      my_account_note: { Args: Empty; Returns: string | null };
      admin_reveal_contact: {
        Args: { p_user: string; p_reason: string };
        Returns: { email: string | null; whatsapp_phone: string }[];
      };
      admin_user_facts: { Args: { p_user: string }; Returns: AdminUserFacts };
      /** Returns the storage path and records that this admin opened it. */
      admin_open_document: { Args: { p_document: string }; Returns: string };
      admin_search_users: {
        Args: {
          p_query?: string | null;
          p_role?: UserRole | null;
          p_status?: ApprovalStatus | null;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: AdminUserSearchRow[];
      };
      admin_search: { Args: { p_query: string }; Returns: AdminSearchRow[] };
      admin_overview: { Args: Empty; Returns: AdminOverview };
      admin_taxonomy_usage: {
        Args: { p_kind: TaxonomyKind };
        Returns: { id: number; uses: number }[];
      };
      admin_save_taxonomy: {
        Args: {
          p_kind: TaxonomyKind;
          p_id: number | null;
          p_name_ar: string;
          p_name_en: string;
          p_slug?: string | null;
          p_governorate_id?: number | null;
        };
        Returns: number;
      };
      admin_delete_taxonomy: { Args: { p_kind: TaxonomyKind; p_id: number }; Returns: undefined };
      set_account_approval: {
        Args: { p_user: string; p_status: ApprovalStatus; p_note?: string | null };
        Returns: undefined;
      };
      /** Returns how many rows it marked, so the caller can say nothing changed. */
      mark_notifications_read: { Args: { p_up_to?: string | null }; Returns: number };
      /** Marks one of the caller's own read and returns where it points; empty for anyone else's. */
      open_notification: {
        Args: { p_id: string };
        Returns: { kind: NotificationKind; href: string | null; payload: NotificationRow['payload'] }[];
      };
      /** The expiry sweep for the caller's own company. Idempotent; returns rows written. */
      sync_my_job_notifications: { Args: Empty; Returns: number };
      /** Service role only: the expiry sweep, for one company or all of them. */
      /** Service role only: delete read notifications older than 180 days. */
      prune_notifications: { Args: { p_limit?: number }; Returns: number };
      emit_job_expiry_notifications: {
        Args: { p_company?: string | null; p_warn_days?: number };
        Returns: number;
      };
      /** Service role only: one notification under a dedupe key. */
      notify: {
        Args: {
          p_user: string;
          p_kind: NotificationKind;
          p_payload: Record<string, unknown>;
          p_href: string | null;
          p_key: string;
        };
        Returns: undefined;
      };
      /**
       * Claims the right to send one message. Returns the outbox row id, or
       * null when somebody already holds this dedupe key or the address is
       * suppressed — which are both "do not send", not errors.
       */
      claim_email: {
        Args: {
          p_dedupe_key: string | null;
          p_template: string;
          p_recipient: string;
          p_user_id?: string | null;
          p_entity_type?: string | null;
          p_entity_id?: string | null;
          /** Security notices: exempt from complaint suppression and the hourly ceiling. */
          p_essential?: boolean;
          /**
           * A sweeper's lease token. When the dedupe key is already held by a
           * row this token has leased, that row is handed back — the retry
           * happens in place, carrying its attempt count — instead of null.
           */
          p_lock_token?: string | null;
        };
        Returns: string | null;
      };
      /** The webhook's one write: replay check, forward-only status, suppression. */
      record_email_event: {
        Args: {
          p_event_id: string;
          p_provider_id: string;
          p_kind:
            | 'delivered'
            | 'bounced_hard'
            | 'bounced_soft'
            | 'complained'
            | 'failed'
            | 'suppressed'
            | 'delayed';
        };
        Returns: { duplicate: boolean; matched: number } | null;
      };
      /** True (and counted) when allowed; false when the bucket is full. Service role only. */
      hit_rate_limit: {
        Args: { p_bucket: string; p_limit: number; p_window_seconds: number };
        Returns: boolean;
      };
      record_email_attempt: {
        Args: {
          p_id: string;
          p_status: EmailStatus;
          p_provider_id?: string | null;
          p_error?: string | null;
          p_exhaust?: boolean;
          /**
           * The row's attempt count before this attempt. When given, a replay
           * of the same record (a retried RPC whose first call committed)
           * matches nothing instead of counting the attempt twice.
           */
          p_expected_attempts?: number | null;
        };
        Returns: undefined;
      };
      release_email_claim: { Args: { p_id: string }; Returns: undefined };
      pending_applicant_digests: {
        Args: { p_since?: string };
        Returns: { user_id: string; applicant_count: number; job_ids: string[] }[];
      };
      incomplete_candidate_profiles: {
        Args: { p_limit?: number };
        Returns: { user_id: string }[];
      };
      pending_emails: {
        Args: { p_limit?: number };
        Returns: {
          id: string;
          template: string;
          entity_id: string | null;
          user_id: string | null;
          attempts: number;
        }[];
      };
      /**
       * Leases up to p_limit due rows with FOR UPDATE SKIP LOCKED, so two
       * sweepers never hold the same row. Service role only.
       */
      lease_due_emails: {
        Args: { p_limit?: number; p_lease_seconds?: number };
        Returns: LeasedEmailRow[];
      };
      /**
       * Finishes a leased row the retry did not record itself. Only the lease
       * holder can: returns false when the token no longer matches.
       */
      settle_leased_email: {
        Args: {
          p_id: string;
          p_lock_token: string;
          p_outcome: SettleLeasedOutcome;
          p_detail?: string | null;
        };
        Returns: boolean;
      };
      /** Dead-letters rows past the retry window or leased too often. Returns how many. */
      reap_email_outbox: { Args: Empty; Returns: number };
      /** The sender's lease on due pushes (migration 329); service role only. */
      lease_due_pushes: {
        Args: { p_limit?: number; p_lease_seconds?: number };
        Returns: LeasedPushRow[];
      };
      /** Only the lease holder can settle: false when the token no longer matches. */
      settle_push: {
        Args: { p_id: number; p_lock_token: string; p_outcome: SettlePushOutcome; p_detail?: string | null };
        Returns: boolean;
      };
      /** Settled pushes after 30 days and tickets after two. Returns how many rows went. */
      prune_push_outbox: { Args: { p_limit?: number }; Returns: number };
      /** The signed-in caller's phone; moves the token to them if another account had it. */
      register_push_device: {
        Args: { p_token: string; p_platform: 'ios' | 'android'; p_locale?: 'ar' | 'en'; p_app_version?: string | null };
        Returns: string;
      };
      unregister_push_device: { Args: { p_token: string }; Returns: undefined };
      /** The caller agreeing to these versions of the Terms and the Privacy policy (migration 336). Once per pair. */
      record_policy_acceptance: { Args: { p_terms_version: string; p_privacy_version: string }; Returns: undefined };
      /** The day's new-jobs notification (migration 334): its id, or null when today's exists or the person is not a candidate. Service role. */
      record_new_jobs_notification: {
        Args: { p_user: string; p_payload: NotificationRow['payload']; p_href: string };
        Returns: string | null;
      };
      /** A help request, or an owner's deletion request; the answer is its reference. Retried with the same key, the same one. */
      submit_support_request: {
        Args: {
          p_key: string;
          p_topic: SupportRequestTopic;
          p_message: string;
          p_error_reference?: string | null;
          p_contact_email?: string | null;
          p_route?: string | null;
          p_client?: string | null;
          p_locale?: string | null;
          p_release?: string | null;
        };
        Returns: string;
      };
      /** Admin only. Writes the reply (ringing the sender's bell once) and the status. */
      admin_answer_support_request: {
        Args: { p_id: string; p_reply: string | null; p_status: 'open' | 'answered' | 'closed' };
        Returns: string;
      };
      /** Admin only. Puts one dead-lettered row back in the queue for one more attempt. */
      requeue_email: { Args: { p_id: string }; Returns: boolean };
      /** Admin only. */
      email_dead_letters: { Args: { p_limit?: number }; Returns: EmailDeadLetterRow[] };
      /** Admin only. One row. */
      outbox_overview: { Args: Empty; Returns: OutboxOverview[] };
      /**
       * Takes the per-job lease and opens a run row. Null when another live
       * run holds it (a 'skipped' row is written instead). A run whose lease
       * has lapsed is closed as failed first. Service role only.
       */
      begin_job_run: {
        Args: { p_job: string; p_lease_seconds: number };
        Returns: string | null;
      };
      /** Closes a running run. False when it was no longer running. Service role only. */
      finish_job_run: {
        Args: {
          p_id: string;
          p_status: 'succeeded' | 'failed';
          p_stats?: Record<string, number | boolean | string>;
          p_error?: string | null;
        };
        Returns: boolean;
      };
      /** Deletes run rows older than p_keep. Returns how many. Service role only. */
      prune_job_runs: { Args: { p_keep?: string }; Returns: number };
      /** Admin only. */
      scheduled_job_overview: { Args: Empty; Returns: ScheduledJobOverviewRow[] };
      /** Admin only. Newest first. */
      recent_job_runs: { Args: { p_limit?: number; p_job?: string | null }; Returns: JobRunRow[] };
      /** Service role only; for /api/health. Last successful finish per job. */
      job_freshness: {
        Args: Empty;
        Returns: { job: string; last_success_at: string | null }[];
      };
      mark_email_delivered: {
        Args: { p_provider_id: string; p_status: EmailStatus };
        Returns: number;
      };
      email_activity: {
        Args: { p_limit?: number; p_status?: EmailStatus | null };
        Returns: EmailActivityRow[];
      };
      email_activity_summary: {
        Args: Empty;
        Returns: { status: EmailStatus; count: number }[];
      };
      /**
       * Returns what happened rather than void: the webhook needs to tell a
       * first delivery from a retry, and every outcome here is a 200.
       */
      settle_order: {
        Args: {
          p_order_id: string;
          p_paymob_order_id: string | null;
          p_success: boolean;
          /** Signed by Paymob; the settlement refuses an order they do not describe. */
          p_amount_cents?: number | null;
          p_currency?: string | null;
        };
        Returns:
          | 'paid'
          | 'failed'
          | 'unknown_order'
          | 'already_paid'
          | 'already_failed'
          | 'already_refunded'
          | 'order_mismatch'
          | 'amount_mismatch'
          | 'currency_mismatch';
      };
    };
    Enums: {
      email_status: EmailStatus;
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
