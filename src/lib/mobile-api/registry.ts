import 'server-only';
import { z } from 'zod';
import type { ActionResult } from '@/lib/action-result';
import { adminMfaRequired, getViewer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { markApplicantsSeen } from '@/lib/applicants-seen';
import { resolveNotification } from '@/lib/notifications/open';
import {
  announcePasswordChange,
  deleteMyAccount,
  requestAccountDeletion,
  saveAvatar,
  updateNotificationPreferences,
  updatePushPreferences,
} from '@/lib/actions/account';
import {
  addModerationNote,
  closeDeletionRequest,
  deleteTaxonomy,
  endSessions,
  getDocumentUrl,
  moderateJob,
  moderateReports,
  requeueEmail,
  revealContact,
  reviewCompany,
  saveTaxonomy,
  setAccountApproval,
  setAgentRestriction,
  setCompanySuspension,
  setJobFeatured,
  setSignInBlock,
  setUserRole,
} from '@/lib/actions/admin';
import { closeReports, decideAppeal, setReportingRestriction } from '@/lib/actions/moderation';
import { recordAgentView } from '@/lib/agent-views';
import { revealAgentContact } from '@/lib/actions/agent-contact';
import { saveAgentProfile } from '@/lib/actions/agent-profile';
import { submitAppeal } from '@/lib/actions/appeals';
import {
  addApplicationNote,
  applyToJob,
  deleteApplicationNote,
  setApplicationStatus,
  withdrawApplication,
} from '@/lib/actions/applications';
import { requestPasswordReset, resendConfirmation } from '@/lib/actions/auth-email';
import {
  addCompanyMember,
  claimMonthlyFreePost,
  recordCompanyDocument,
  removeCompanyMember,
  saveCompany,
  saveCompanyLogo,
} from '@/lib/actions/company';
import {
  deleteCvEntry,
  saveCertification,
  saveEducation,
  saveExperience,
  saveProfileRecord,
} from '@/lib/actions/cv';
import { findSimilarListing, salaryReferenceFor, saveJob, transitionJob } from '@/lib/actions/employer-jobs';
import { recordJobView, toggleSavedJob } from '@/lib/actions/jobs';
import { completeOnboarding } from '@/lib/actions/onboarding';
import { acceptPolicies } from '@/lib/actions/policies';
import { reportTarget } from '@/lib/actions/reports';
import {
  deleteSavedSearch,
  followCompany,
  saveSearch,
  setSearchAlerts,
  unfollowCompany,
} from '@/lib/actions/saved-searches';
import { reportAuthOutcome } from '@/lib/actions/security';
import { toggleSavedAgent } from '@/lib/actions/talent-pool';
import { uploadImage } from '@/lib/actions/uploads';
import { adminDoor } from './admin-door';
import { mobileScope } from './context';
import {
  MULTIPART_ACTIONS,
  PUBLIC_ACTIONS,
  type MobileActionName,
  type MobileActionOutput,
} from './contract';

/**
 * Every action the mobile app may call, and nothing else.
 *
 * Each entry runs the website's own server action, so an application from the
 * app sends the same emails, passes the same file check and meets the same
 * rate limits as one from the website. Checkout is not here: the app sells
 * nothing. Of the admin console, every lever the website's console has
 * (ADMIN_ACTIONS) — listings, companies, accounts, consultants, reports and
 * appeals decided, taxonomy kept, a dead letter retried, a verification paper
 * opened — and each behind the admin door below, so the app's console asks of
 * a session exactly what the website's does.
 *
 * Most actions take one input object and validate it themselves. The adapters
 * below are for the ones that take positional arguments or none — several of
 * those were only ever called by the website's own forms with values the page
 * built, and did no validation of their own, so their arguments are checked
 * here before they are passed on.
 *
 * Typed against contract.ts: an action whose result stops matching what the
 * app was promised fails the web typecheck, not the app at runtime.
 */

type Entry<N extends MobileActionName> = {
  run: (input: unknown) => Promise<MobileActionOutput<N>>;
};

const invalid = { ok: false, error: 'invalid' } as const satisfies ActionResult;

const uuid = z.string().uuid();
const record = (input: unknown): Record<string, unknown> =>
  input && typeof input === 'object' ? (input as Record<string, unknown>) : {};

/** The adapter for an action that takes one validated positional argument. */
function positional<T, R>(schema: z.ZodType<T>, key: string, action: (value: T) => Promise<R>) {
  return async (input: unknown): Promise<R | typeof invalid> => {
    const parsed = schema.safeParse(record(input)[key]);
    return parsed.success ? action(parsed.data) : invalid;
  };
}

const deleteCvSchema = z.object({
  section: z.enum(['experience', 'education', 'certification']),
  id: uuid,
});

const seenSchema = z.object({ ids: z.array(uuid).min(1).max(200) });

/** A consultant's handle: the slug, or the id a locked card is opened by — getAgentCard()'s rule. */
const AGENT_HANDLE = z.string().regex(/^(?:[a-z0-9][a-z0-9-]{0,118}|[0-9a-f-]{36})$/);

/**
 * An admin lever, run only for a session the website's console would let in
 * (admin-door.ts): with an authenticator, its code given this session; where
 * the deployment requires one, an authenticator at all. Anybody who is not an
 * admin is told `forbidden` rather than how to become one; the action and
 * the database check the role again regardless.
 */
function forAdmins<R>(action: (input: unknown) => Promise<R>) {
  return async (input: unknown): Promise<R | ActionResult> => {
    const session = mobileScope()?.session;
    if (!session) return { ok: false, error: 'unauthenticated' };
    const door = adminDoor(session, adminMfaRequired());
    if (door === 'open') return action(input);
    const supabase = await createClient();
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).maybeSingle();
    return { ok: false, error: profile?.role === 'admin' ? door : 'forbidden' };
  };
}

export const REGISTRY: { [N in MobileActionName]: Entry<N> } = {
  // Account
  deleteMyAccount: { run: (input) => deleteMyAccount(input) },
  requestAccountDeletion: { run: (input) => requestAccountDeletion(input) },
  announcePasswordChange: { run: () => announcePasswordChange() },
  updateNotificationPreferences: { run: (input) => updateNotificationPreferences(input) },
  updatePushPreferences: { run: (input) => updatePushPreferences(input) },
  saveAvatar: { run: (input) => saveAvatar(input) },
  uploadImage: { run: async (input) => (input instanceof FormData ? uploadImage(input) : invalid) },

  // Signed-out
  reportAuthOutcome: { run: (input) => reportAuthOutcome(input) },
  requestPasswordReset: {
    run: (input) => requestPasswordReset(record(input).email, record(input).captchaToken),
  },
  resendConfirmation: {
    run: async (input) => {
      const { email, redirectTo, captchaToken } = record(input);
      // The action only ever sends people back to this site's own callback,
      // whatever it is given; a missing value is simply not a request.
      return typeof redirectTo === 'string' ? resendConfirmation(email, redirectTo, captchaToken) : invalid;
    },
  },

  // Onboarding, and agreeing again when the Terms or the Privacy policy change
  completeOnboarding: { run: (input) => completeOnboarding(input) },
  acceptPolicies: { run: () => acceptPolicies() },

  // Candidate
  applyToJob: { run: (input) => applyToJob(input) },
  withdrawApplication: { run: positional(uuid, 'applicationId', withdrawApplication) },
  saveAgentProfile: { run: (input) => saveAgentProfile(input) },
  saveExperience: { run: (input) => saveExperience(input) },
  saveEducation: { run: (input) => saveEducation(input) },
  saveCertification: { run: (input) => saveCertification(input) },
  deleteCvEntry: {
    run: async (input) => {
      const parsed = deleteCvSchema.safeParse(input);
      return parsed.success ? deleteCvEntry(parsed.data.section, parsed.data.id) : invalid;
    },
  },
  saveProfileRecord: { run: (input) => saveProfileRecord(input) },

  // Jobs, searches, follows
  toggleSavedJob: { run: positional(z.string(), 'jobId', toggleSavedJob) },
  recordJobView: {
    run: async (input) => {
      const slug = record(input).slug;
      if (typeof slug !== 'string') return invalid;
      await recordJobView(slug);
      return { ok: true };
    },
  },
  reportTarget: { run: (input) => reportTarget(input) },
  saveSearch: { run: (input) => saveSearch(input) },
  deleteSavedSearch: { run: positional(uuid, 'id', deleteSavedSearch) },
  setSearchAlerts: { run: (input) => setSearchAlerts(input) },
  followCompany: { run: (input) => followCompany(input) },
  unfollowCompany: { run: positional(z.string(), 'slug', unfollowCompany) },

  // Employer: listings
  saveJob: { run: (input) => saveJob(input) },
  transitionJob: { run: (input) => transitionJob(input) },
  findSimilarListing: { run: (input) => findSimilarListing(input) },
  salaryReferenceFor: { run: (input) => salaryReferenceFor(input) },

  // Employer: applicants
  setApplicationStatus: { run: (input) => setApplicationStatus(input) },
  addApplicationNote: { run: (input) => addApplicationNote(input) },
  deleteApplicationNote: {
    run: positional(z.number().int().positive(), 'id', deleteApplicationNote),
  },
  markApplicantsSeen: {
    run: async (input) => {
      const parsed = seenSchema.safeParse(input);
      if (!parsed.success) return invalid;
      // Through the caller's session: RLS decides which rows they may stamp.
      await markApplicantsSeen(parsed.data.ids);
      return { ok: true };
    },
  },

  // Employer: company and team
  saveCompany: { run: (input) => saveCompany(input) },
  saveCompanyLogo: { run: (input) => saveCompanyLogo(input) },
  recordCompanyDocument: { run: (input) => recordCompanyDocument(input) },
  claimMonthlyFreePost: { run: () => claimMonthlyFreePost() },
  addCompanyMember: { run: (input) => addCompanyMember(input) },
  removeCompanyMember: { run: positional(uuid, 'userId', removeCompanyMember) },

  // Employer: consultant directory
  revealAgentContact: { run: (input) => revealAgentContact(input) },
  toggleSavedAgent: { run: positional(z.string(), 'agentId', toggleSavedAgent) },
  recordAgentView: {
    run: async (input) => {
      // A slug or an id, as the profile page passes either; anything else is
      // not a profile. Everything else is record_agent_view()'s to decide —
      // which company, whether it is the owner's own look — and it refuses
      // silently, so this answers ok either way, as the page does.
      const parsed = AGENT_HANDLE.safeParse(record(input).slug);
      if (!parsed.success) return invalid;
      await recordAgentView(parsed.data);
      return { ok: true };
    },
  },

  // Notifications
  openNotification: {
    run: async (input) => {
      const parsed = uuid.safeParse(record(input).id);
      if (!parsed.success) return invalid;
      const viewer = await getViewer();
      if (!viewer?.profile) return { ok: false, error: 'unauthenticated' };
      const destination = await resolveNotification(await createClient(), parsed.data, viewer.profile.role);
      return { ok: true, data: destination };
    },
  },

  submitAppeal: { run: (input) => submitAppeal(input) },

  // The admin console's levers
  moderateJob: { run: forAdmins(moderateJob) },
  reviewCompany: { run: forAdmins(reviewCompany) },
  setAccountApproval: { run: forAdmins(setAccountApproval) },
  moderateReports: { run: forAdmins(moderateReports) },
  getDocumentUrl: { run: forAdmins(positional(uuid, 'documentId', getDocumentUrl)) },
  revealContact: { run: forAdmins(revealContact) },
  addModerationNote: { run: forAdmins(addModerationNote) },
  setReportingRestriction: { run: forAdmins(setReportingRestriction) },
  setUserRole: { run: forAdmins(setUserRole) },
  setSignInBlock: { run: forAdmins(setSignInBlock) },
  endSessions: { run: forAdmins(endSessions) },
  setJobFeatured: { run: forAdmins(setJobFeatured) },
  setCompanySuspension: { run: forAdmins(setCompanySuspension) },
  setAgentRestriction: { run: forAdmins(setAgentRestriction) },
  closeReports: { run: forAdmins(closeReports) },
  decideAppeal: { run: forAdmins(decideAppeal) },
  saveTaxonomy: { run: forAdmins(saveTaxonomy) },
  deleteTaxonomy: { run: forAdmins(deleteTaxonomy) },
  requeueEmail: { run: forAdmins(requeueEmail) },
  closeDeletionRequest: { run: forAdmins(closeDeletionRequest) },
};

export function isActionName(name: string): name is MobileActionName {
  return Object.prototype.hasOwnProperty.call(REGISTRY, name);
}

export function isPublicAction(name: MobileActionName): boolean {
  return (PUBLIC_ACTIONS as readonly string[]).includes(name);
}

export function isMultipartAction(name: MobileActionName): boolean {
  return (MULTIPART_ACTIONS as readonly string[]).includes(name);
}
