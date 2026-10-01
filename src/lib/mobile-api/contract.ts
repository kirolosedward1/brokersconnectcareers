import type { ActionResult } from '@/lib/action-result';
import type {
  AGENT_REPORT_REASONS,
  COMPANY_REPORT_REASONS,
  REPORT_REASONS,
} from '@/lib/taxonomy';
import type {
  AgentAvailability,
  AgentVisibility,
  AppealSubjectType,
  ApplicationNoteRow,
  ApplicationStatus,
  Benefit,
  CommissionType,
  CompanyType,
  EmploymentType,
  ExperienceBand,
  HeadcountBand,
  JobTrack,
  LeadsSource,
  SalaryReferenceRow,
} from '@/lib/supabase/database.types';

/**
 * What the mobile app may ask the server to do, and what it gets back.
 *
 * Every write the app makes goes through `POST /api/mobile/v1/actions/<name>`
 * with a JSON body `{ "input": … }` (multipart for `uploadImage`) and a bearer
 * token, and runs the same server action the website's form runs — emails,
 * file checks, slugs, rate limits and all. The answer is always HTTP 200 with
 * the action's own result; other statuses mean the request never reached the
 * action (400 malformed, 401 token, 404 name, 413 size, 415 type, 5xx).
 *
 * Imported by both sides. The server's registry is typed against the outputs
 * here, so an action whose result changes shape fails the web typecheck
 * before the app ever sees it. The inputs mirror each action's zod schema;
 * the action re-validates, so a mismatch is an `invalid`, never a bad write.
 *
 * Types only, and one list of names: nothing here runs on the server.
 */

/** The email-sending actions answer this, so an address cannot be probed. */
export type EmailRequestResult = { ok: true } | { ok: false; error: 'wait' | 'invalid' };

/** How long the sign-in form should wait, and whether to show the challenge. */
export type AuthFriction = { pause: number; challenge: boolean };

export type ContactRevealResult =
  | { ok: true; data: { fullName: string; phone: string; whatsappUrl: string; hasCv: boolean } }
  | {
      ok: false;
      error: 'invalid' | 'unauthenticated' | 'forbidden' | 'locked' | 'not_found' | 'rate_limit' | 'failed';
      retryAfterSeconds?: number;
    };

/** Where following a notification lands: its link, or the feed with a reason. */
export type NotificationDestination = { href: string } | { fallback: string };

/** Why an appeal was not filed — the database's refusals (migration 328), as submitAppeal names them. */
export type AppealRefusal =
  | 'message_required'
  | 'not_appealable'
  | 'appeal_open'
  | 'appeal_limit'
  | 'appeal_too_soon'
  | 'rate_limit'
  | 'company_suspended'
  | 'unavailable';

type Nullable<T> = T | null | undefined;

export type OnboardingInput = {
  role: 'candidate' | 'employer';
  fullName: string;
  whatsapp: string;
  locale: 'ar' | 'en';
  company?: {
    nameAr: string;
    website?: Nullable<string>;
    headcountBand?: Nullable<HeadcountBand>;
    districtId?: Nullable<number>;
  };
};

export type AgentProfileInput = {
  fullName: string;
  whatsapp: string;
  headlineAr?: Nullable<string>;
  headlineEn?: Nullable<string>;
  yearsExperience: number;
  tracks: JobTrack[];
  districtIds: number[];
  developerIds: number[];
  languages: string[];
  availability: AgentAvailability;
  visibility: AgentVisibility;
  /** A path in the caller's own `cvs/<uid>/` folder, uploaded first; absent means unchanged. */
  cvPath?: Nullable<string>;
  /** Take the CV off the profile (the file is kept: an application may have been sent with it). */
  removeCv?: boolean;
};

export type ApplyInput = {
  jobId: string;
  fullName: string;
  whatsapp: string;
  experienceBand: ExperienceBand;
  cvPath?: Nullable<string>;
  note?: Nullable<string>;
};

export type JobInput = {
  id?: string;
  titleAr: string;
  titleEn?: Nullable<string>;
  track: JobTrack;
  employmentType: EmploymentType;
  experienceBand: ExperienceBand;
  seats: number;
  districtId: number;
  basicSalaryMin?: Nullable<number>;
  basicSalaryMax?: Nullable<number>;
  commissionType: CommissionType;
  commissionValue?: Nullable<number>;
  commissionNoteAr?: Nullable<string>;
  leadsSource: LeadsSource;
  benefits: Benefit[];
  descriptionAr: string;
  descriptionEn?: Nullable<string>;
  requirementsAr?: Nullable<string>;
  developerIds: number[];
  version?: number;
  /** Made once per form and repeated on every retry, so a retry cannot post twice. */
  idempotencyKey?: string;
  /** true sends it to review; false keeps it a draft. */
  submit: boolean;
};

export type CompanyInput = {
  nameAr: string;
  nameEn?: Nullable<string>;
  aboutAr?: Nullable<string>;
  aboutEn?: Nullable<string>;
  website?: Nullable<string>;
  headcountBand?: Nullable<HeadcountBand>;
  companyType?: Nullable<CompanyType>;
  districtId?: Nullable<number>;
  version?: number;
};

export type ReportInput =
  | { target: 'job'; targetId: string; reason: (typeof REPORT_REASONS)[number]; detail?: string }
  | { target: 'company'; targetId: string; reason: (typeof COMPANY_REPORT_REASONS)[number]; detail?: string }
  | { target: 'agent'; targetId: string; reason: (typeof AGENT_REPORT_REASONS)[number]; detail?: string };

export type MobileActions = {
  // Account
  /** An account made with Apple sends a fresh authorization code, so the grant is revoked too. */
  deleteMyAccount: { input: { appleAuthorizationCode?: string }; output: ActionResult };
  /** A company owner, whom deleteMyAccount refuses, asking us to do it; the answer is the request's reference. */
  requestAccountDeletion: { input: { key: string; client?: string }; output: ActionResult<{ reference: string }> };
  announcePasswordChange: { input: undefined; output: ActionResult };
  updateNotificationPreferences: {
    input: {
      notify_applications: boolean;
      notify_status: boolean;
      notify_digest: boolean;
      notify_applicant_digest: boolean;
    };
    output: ActionResult;
  };
  /** Which kinds reach the person's phones, and quiet hours (migration 335). */
  updatePushPreferences: {
    input: {
      push_job_alerts: boolean;
      push_applications: boolean;
      push_account: boolean;
      push_quiet_hours: boolean;
    };
    output: ActionResult;
  };
  /** `{ storagePath: null }` removes the photo; uploading one is `uploadImage`. */
  saveAvatar: { input: { storagePath: string | null }; output: ActionResult };
  /** Multipart: `kind` (avatar | logo), `file`, and `companyId` for a logo. */
  uploadImage: { input: FormData; output: ActionResult<{ url: string }> };

  // Signed-out: sign-in friction and the two emails
  reportAuthOutcome: {
    input: { kind: 'sign_in_failed' | 'sign_up_failed' | 'reset_requested' | 'sign_in_locked_out'; email?: string };
    output: AuthFriction;
  };
  requestPasswordReset: { input: { email: string; captchaToken?: string }; output: EmailRequestResult };
  resendConfirmation: {
    input: { email: string; redirectTo: string; captchaToken?: string };
    output: EmailRequestResult;
  };

  // Onboarding
  completeOnboarding: { input: OnboardingInput; output: ActionResult<{ role: string }> };

  // Candidate: applying and the pipeline they can see
  applyToJob: { input: ApplyInput; output: ActionResult };
  withdrawApplication: { input: { applicationId: string }; output: ActionResult };

  // Candidate: profile and CV
  saveAgentProfile: { input: AgentProfileInput; output: ActionResult };
  saveExperience: {
    input: {
      id?: string;
      agentId: string;
      companyName: string;
      title: string;
      track?: Nullable<JobTrack>;
      districtId?: Nullable<number>;
      /** YYYY-MM-DD */
      started: string;
      ended?: Nullable<string>;
      highlights?: Nullable<string>;
    };
    output: ActionResult<{ id: string }>;
  };
  saveEducation: {
    input: {
      id?: string;
      agentId: string;
      institution: string;
      degree?: Nullable<string>;
      field?: Nullable<string>;
      graduated?: Nullable<number>;
    };
    output: ActionResult<{ id: string }>;
  };
  saveCertification: {
    input: {
      id?: string;
      agentId: string;
      name: string;
      issuer?: Nullable<string>;
      issued?: Nullable<string>;
      expires?: Nullable<string>;
    };
    output: ActionResult<{ id: string }>;
  };
  deleteCvEntry: {
    input: { section: 'experience' | 'education' | 'certification'; id: string };
    output: ActionResult;
  };
  saveProfileRecord: {
    input: { summaryAr?: Nullable<string>; unitsClosed?: Nullable<number>; volumeEgp?: Nullable<number> };
    output: ActionResult;
  };

  // Jobs, saved jobs, searches and follows
  toggleSavedJob: { input: { jobId: string }; output: ActionResult<{ saved: boolean }> };
  recordJobView: { input: { slug: string }; output: ActionResult };
  reportTarget: { input: ReportInput; output: ActionResult };
  saveSearch: { input: { label: string; query: string }; output: ActionResult<{ id: string }> };
  deleteSavedSearch: { input: { id: string }; output: ActionResult };
  setSearchAlerts: { input: { id: string; alerts: boolean }; output: ActionResult };
  followCompany: { input: { slug: string; label: string }; output: ActionResult<{ id: string }> };
  unfollowCompany: { input: { slug: string }; output: ActionResult };

  // Employer: listings
  saveJob: { input: JobInput; output: ActionResult<{ id: string }> };
  transitionJob: { input: { jobId: string; status: 'draft' | 'pending_review' | 'closed' }; output: ActionResult };
  findSimilarListing: {
    input: { titleAr: string; districtId: number; excludeId?: Nullable<string> };
    output: ActionResult<{ match: { id: string; title: string; seats: number } | null }>;
  };
  salaryReferenceFor: {
    input: { track: JobTrack; districtId: number };
    output: ActionResult<{ reference: SalaryReferenceRow | null }>;
  };

  // Employer: applicants
  setApplicationStatus: {
    input: {
      applicationId: string;
      status: ApplicationStatus;
      decisionNote?: Nullable<string>;
      /** The status the card showed, so a colleague's move is not overwritten. */
      from?: ApplicationStatus;
    };
    output: ActionResult;
  };
  addApplicationNote: {
    input: { applicationId: string; body: string };
    output: ActionResult<{ note: ApplicationNoteRow }>;
  };
  deleteApplicationNote: { input: { id: number }; output: ActionResult };
  /** The inbox has shown these cards: the candidate may now see "opened". */
  markApplicantsSeen: { input: { ids: string[] }; output: ActionResult };

  // Employer: company and team
  saveCompany: { input: CompanyInput; output: ActionResult<{ id: string }> };
  /** `{ companyId, storagePath: null }` removes the logo; uploading one is `uploadImage`. */
  saveCompanyLogo: { input: { companyId: string; storagePath: string | null }; output: ActionResult };
  recordCompanyDocument: {
    input: { companyId: string; docType: 'commercial_register' | 'tax_card'; storagePath: string };
    output: ActionResult;
  };
  claimMonthlyFreePost: { input: undefined; output: ActionResult<{ claimed: boolean }> };
  addCompanyMember: { input: { email: string; role: 'admin' | 'recruiter' }; output: ActionResult };
  removeCompanyMember: { input: { userId: string }; output: ActionResult };

  // Employer: the consultant directory
  revealAgentContact: { input: { handle: string; locale: 'ar' | 'en' }; output: ContactRevealResult };
  toggleSavedAgent: { input: { agentId: string }; output: ActionResult<{ saved: boolean }> };
  /** A company opened a profile; record_agent_view() decides whether it counts. Always ok. */
  recordAgentView: { input: { slug: string }; output: ActionResult };

  // Notifications
  openNotification: { input: { id: string }; output: ActionResult<NotificationDestination> };

  // Asking for a moderator's decision to be looked at again
  submitAppeal: {
    input: { subjectType: AppealSubjectType; subjectId: string; message: string };
    output: ActionResult;
  };
};

export type MobileActionName = keyof MobileActions;
export type MobileActionInput<N extends MobileActionName> = MobileActions[N]['input'];
export type MobileActionOutput<N extends MobileActionName> = MobileActions[N]['output'];

/** Callable with no signed-in user; every other action refuses one with 401. */
export const PUBLIC_ACTIONS = [
  'reportAuthOutcome',
  'requestPasswordReset',
  'resendConfirmation',
  'recordJobView',
] as const satisfies readonly MobileActionName[];

/** Sent as multipart/form-data rather than JSON. */
export const MULTIPART_ACTIONS = ['uploadImage'] as const satisfies readonly MobileActionName[];
