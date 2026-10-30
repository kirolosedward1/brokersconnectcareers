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
  InterviewMode,
  SavedReplyRow,
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
      error: 'invalid' | 'unauthenticated' | 'forbidden' | 'not_permitted' | 'locked' | 'not_found' | 'rate_limit' | 'failed';
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
  /** 18 or older, and agrees to the Terms of use and the Privacy policy. Nothing is created without it. */
  agreed: true;
  /** Who sees a candidate's directory card: asked, never assumed. Required for a candidate. */
  visibility?: AgentVisibility;
  /** The first visit. The app sends `{ inApp: true }`; the website usually sends nothing and the cookie is read. */
  attribution?: {
    referrer?: string | null;
    utmSource?: string | null;
    utmMedium?: string | null;
    utmCampaign?: string | null;
    gclid?: boolean;
    fbclid?: boolean;
    landingPath?: string | null;
    inApp?: boolean;
    seenAt?: string | null;
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
  /** The company's branch (migration 383); null for none, absent to leave it as it is. */
  branchId?: number | null;
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
      /** The profile reminder, off unless turned on (migration 337); sent only when the profile has it. */
      notify_profile_nudge?: boolean;
    };
    output: ActionResult;
  };
  /** Which kinds reach the person's phones, and quiet hours (migration 335): any of them, at least one. */
  updatePushPreferences: {
    input: {
      push_job_alerts?: boolean;
      push_applications?: boolean;
      push_account?: boolean;
      push_quiet_hours?: boolean;
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
  /** Agreeing to the Terms and the Privacy policy as published now (an account made before they were recorded, or since changed). */
  acceptPolicies: { input: undefined; output: ActionResult };

  // Candidate: applying and the pipeline they can see
  applyToJob: { input: ApplyInput; output: ActionResult };
  withdrawApplication: { input: { applicationId: string }; output: ActionResult };

  // Candidate: profile and CV
  saveAgentProfile: { input: AgentProfileInput; output: ActionResult };
  saveExperience: {
    input: {
      id?: string;
      /** A new entry's key, made once per form and sent with every attempt: a retry finds the entry rather than adding it twice. */
      idempotencyKey?: string;
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
      /** A new entry's key, made once per form and sent with every attempt: a retry finds the entry rather than adding it twice. */
      idempotencyKey?: string;
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
      /** A new entry's key, made once per form and sent with every attempt: a retry finds the entry rather than adding it twice. */
      idempotencyKey?: string;
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
  /**
   * The candidate's own line about a saved listing (migration 356): trimmed,
   * at most 300 characters; empty or null takes it away. `not_saved` when the
   * listing is not bookmarked (the note lives with the bookmark).
   */
  setSavedJobNote: {
    input: { jobId: string; note: string | null };
    output: ActionResult<{ note: string | null }>;
  };
  /** An ISO timestamp, or null to take the reminder away; `closing` when it is past, or not before the listing closes. */
  setSavedJobReminder: {
    input: { jobId: string; remindAt: string | null };
    output: ActionResult<{ remindAt: string | null }>;
  };
  recordJobView: { input: { slug: string }; output: ActionResult };
  reportTarget: { input: ReportInput; output: ActionResult };
  saveSearch: { input: { label: string; query: string }; output: ActionResult<{ id: string }> };
  deleteSavedSearch: { input: { id: string }; output: ActionResult };
  setSearchAlerts: { input: { id: string; alerts: boolean }; output: ActionResult };
  followCompany: { input: { slug: string; label: string }; output: ActionResult<{ id: string }> };
  unfollowCompany: { input: { slug: string }; output: ActionResult };

  // Employer: listings
  /** pendingApproval: saved, but the live listing's new pay waits for an admin (migration 380). */
  saveJob: { input: JobInput; output: ActionResult<{ id: string; pendingApproval?: boolean }> };
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
      /** Whether the candidate may read the reason; absent is yes. Unticked, it is kept as the company's own note. */
      shareReason?: boolean;
    };
    /**
     * reasonKept: false when an unshared reason could not be kept as a note (the move itself stands).
     * pendingApproval: the company has an admin approve declines (migration 380); the move waits.
     */
    output: ActionResult<{ reasonKept: boolean; pendingApproval?: boolean }>;
  };
  /** Up to fifty moves at once, each as a single move (Phase B 01). */
  setApplicationStatuses: {
    input: {
      items: { applicationId: string; from: ApplicationStatus }[];
      status: ApplicationStatus;
      decisionNote?: Nullable<string>;
      shareReason?: boolean;
    };
    output: ActionResult<{ moved: number; movedAlready: number; failed: number; reasonsNotKept: number; pendingApproval?: number }>;
  };
  /** One message to up to fifty applicants, by email; key made once per composer. */
  messageApplicants: {
    input: { applicationIds: string[]; message: string; key: string };
    output: ActionResult<{ sent: number; skipped: number }>;
  };
  /** Migration 376: a member's switches; admins only, never the owner. */
  saveCompanyRules: {
    input: { approveDecline: boolean; approvePayChange: boolean; spendCeilingMonthEgp: number | null; requireMfa: boolean; cvAdminsOnly: boolean };
    output: ActionResult;
  };
  decideApprovalRequest: {
    input: { id: string; approve: boolean; note?: string | null };
    output: ActionResult<{ outcome: 'approved' | 'refused' | 'expired' }>;
  };
  saveBranch: { input: { id?: number; nameAr: string; nameEn?: string | null; districtId: number | null }; output: ActionResult<{ id: number }> };
  deleteBranch: { input: { id: number }; output: ActionResult };
  transferCompanyOwnership: { input: { userId: string }; output: ActionResult };
  requestCompanyDeletion: { input: { confirmName: string }; output: ActionResult };
  cancelCompanyDeletion: { input: Record<string, never>; output: ActionResult };
  setApplicationPurge: { input: { days: 30 | 90 | 180 | 365 | null }; output: ActionResult };
  saveCompanyHiring: {
    input: {
      hiringStatus: 'open' | 'paused';
      pausedUntil: string | null;
      contactWhatsapp: string | null;
      replyHours: { days: number[]; from: string; to: string } | null;
    };
    output: ActionResult;
  };
  updateMemberPermissions: { input: { userId: string; canPost: boolean; canReveal: boolean; canSpend: boolean }; output: ActionResult };
  /** Migration 375: a note about the person, read on every application they send the company. */
  addCandidateNote: { input: { applicationId: string; body: string; idempotencyKey?: string }; output: ActionResult<{ id: number }> };
  deleteCandidateNote: { input: { id: number }; output: ActionResult };
  /** Migration 374: a reply of one's own, or the team's (admins); WhatsApp or email. */
  saveReply: {
    input: { id?: string; version?: number; title?: Nullable<string>; body: string; channel: 'whatsapp' | 'email'; teamWide: boolean };
    output: ActionResult<{ reply: SavedReplyRow }>;
  };
  deleteReply: { input: { id: string }; output: ActionResult };
  /** Migration 373. Times are ISO instants with an offset; shown in Cairo time. One invitation stands per application. */
  inviteToInterview: {
    input: {
      applicationId: string;
      startsAt: string;
      minutes: number;
      mode: InterviewMode;
      place?: Nullable<string>;
      note?: Nullable<string>;
    };
    output: ActionResult<{ id: string }>;
  };
  cancelInterview: { input: { id: string }; output: ActionResult };
  /** The company agrees to the candidate's proposed time. */
  acceptProposedTime: { input: { id: string }; output: ActionResult };
  /** The candidate's answer; counterStartsAt with 'counter'. */
  answerInterview: {
    input: { id: string; answer: 'accepted' | 'declined' | 'counter'; counterStartsAt?: Nullable<string> };
    output: ActionResult;
  };
  addApplicationNote: {
    /** idempotencyKey: made once per composer, so a retry finds the note rather than writing it twice. */
    input: { applicationId: string; body: string; idempotencyKey?: string };
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

  // The admin console's levers (ADMIN_ACTIONS). The website's own, each one
  // admin_* function call that checks, decides and records in one transaction.
  // Refused with `forbidden` for anybody else, and with `mfa_challenge` /
  // `mfa_required` for an admin whose session has not proved what the
  // website's console asks of it (admin-door.ts).
  moderateJob: {
    input: {
      jobId: string;
      action: 'approve' | 'reject' | 'request_changes' | 'unpublish' | 'close' | 'restore';
      /** Sent to the company when it says something. Blank is omitted. */
      reason?: string | null;
      /** The listing's version as the screen showed it, so a decision is never made on text that changed. */
      version?: number;
    };
    output: ActionResult;
  };
  reviewCompany: {
    input: {
      companyId: string;
      decision: 'verify' | 'reject' | 'request_changes' | 'revoke';
      note?: string;
      version?: number;
    };
    output: ActionResult;
  };
  setAccountApproval: {
    input: { userId: string; status: 'approved' | 'pending' | 'rejected'; note?: string };
    output: ActionResult;
  };
  moderateReports: {
    input: {
      targetType: 'job' | 'company' | 'agent';
      targetId: string;
      status: 'investigating' | 'resolved' | 'dismissed';
      note?: string;
      /** Resolve by taking the matching action too: listing down, company suspended, profile restricted. */
      takeAction?: boolean;
    };
    output: ActionResult<{ moved: number }>;
  };
  /** A five-minute link to one verification document; asking is recorded. */
  getDocumentUrl: { input: { documentId: string }; output: ActionResult<{ url: string }> };
  /** One account's email and phone, for a reason that is recorded with the request. */
  revealContact: { input: { userId: string; reason?: string | null }; output: ActionResult<{ email: string | null; phone: string }> };
  /** A note for other admins, on the record of what it is about. */
  addModerationNote: {
    input: { targetType: 'user' | 'company' | 'job' | 'agent' | 'application' | 'report'; targetId: string; body: string };
    output: ActionResult;
  };
  /** Stop, or allow again, one account's reports. */
  setReportingRestriction: { input: { userId: string; restrict: boolean; reason?: string | null }; output: ActionResult };
  /** Make an account an admin, or an admin a candidate or employer again (never yourself, never the last admin). */
  setUserRole: { input: { userId: string; role: 'candidate' | 'employer' | 'admin'; reason?: string | null }; output: ActionResult };
  /** Stop an account signing in at all (and end its sessions), or allow it again. */
  setSignInBlock: { input: { userId: string; block: boolean; reason?: string | null }; output: ActionResult<{ sessionsEnded: number }> };
  /** Sign one account out of every device. */
  endSessions: { input: { userId: string; reason?: string | null }; output: ActionResult<{ sessionsEnded: number }> };
  /** Pin a live listing at the top of the board, or unpin it; recorded, nobody is told. */
  setJobFeatured: { input: { jobId: string; featured: boolean }; output: ActionResult };
  /** Suspend a company (its live and pending listings come down; the members are told) or lift the suspension (nothing comes back). */
  setCompanySuspension: {
    input: { companyId: string; suspend: boolean; reason?: string | null };
    output: ActionResult<{ takenDown: number }>;
  };
  /** Restrict a consultant's profile (hidden, the consultant told) or lift the restriction (stays hidden). */
  setAgentRestriction: { input: { agentId: string; restrict: boolean; reason?: string | null }; output: ActionResult };
  /** Close reports by id: a deleted target's case, or one report dismissed as bad faith. */
  closeReports: {
    input: { ids: string[]; status: 'investigating' | 'resolved' | 'dismissed'; note?: string; abusive?: boolean };
    output: ActionResult<{ moved: number }>;
  };
  /** Answer an appeal. A note is optional either way; the person is told. */
  decideAppeal: { input: { appealId: string; overturn: boolean; note?: string }; output: ActionResult };
  /** Add or rename a district, governorate or developer; the slug is permanent once set. */
  saveTaxonomy: {
    input: {
      kind: 'district' | 'governorate' | 'developer';
      id: number | null;
      nameAr: string;
      nameEn: string;
      slug?: string;
      governorateId?: number | null;
    };
    output: ActionResult<{ id: number }>;
  };
  /** Delete a taxonomy row nothing uses. */
  deleteTaxonomy: { input: { kind: 'district' | 'governorate' | 'developer'; id: number }; output: ActionResult };
  /** Give a dead-lettered email one more try (only a template the sweeper can rebuild). */
  requeueEmail: { input: { emailId: string }; output: ActionResult };
  /** Record an owner's deletion request as dealt with; deletes nothing. */
  closeDeletionRequest: { input: { requestId: string }; output: ActionResult };
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

/** The admin console's levers: an admin's alone, behind the admin door (admin-door.ts). */
export const ADMIN_ACTIONS = [
  'moderateJob',
  'reviewCompany',
  'setAccountApproval',
  'moderateReports',
  'getDocumentUrl',
  'revealContact',
  'addModerationNote',
  'setReportingRestriction',
  'setUserRole',
  'setSignInBlock',
  'endSessions',
  'setJobFeatured',
  'setCompanySuspension',
  'setAgentRestriction',
  'closeReports',
  'decideAppeal',
  'saveTaxonomy',
  'deleteTaxonomy',
  'requeueEmail',
  'closeDeletionRequest',
] as const satisfies readonly MobileActionName[];

/** Sent as multipart/form-data rather than JSON. */
export const MULTIPART_ACTIONS = ['uploadImage'] as const satisfies readonly MobileActionName[];
