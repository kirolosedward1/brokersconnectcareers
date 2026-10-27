import { useQueryClient } from '@tanstack/react-query';
import type { ActionResult } from '@/lib/action-result';
import type { MobileActionInput } from '@/lib/mobile-api/contract';
import { callAction } from '~/lib/api';

/**
 * The console's decisions, pulled from the phone: each one of the website's
 * admin actions (through /api/mobile/v1, behind the admin door), which is one
 * admin_* function that checks the role, refuses a transition the product
 * does not have or a missing reason, makes the change and writes the audit
 * record in one transaction. So an `ok` here means the change and its record
 * are both committed — nothing is shown as done before that.
 */
export type Lever =
  | ({ do: 'job' } & MobileActionInput<'moderateJob'>)
  | ({ do: 'company' } & MobileActionInput<'reviewCompany'>)
  | ({ do: 'approval' } & MobileActionInput<'setAccountApproval'>)
  | ({ do: 'reports' } & MobileActionInput<'moderateReports'>)
  // The accounts' own levers (the website's /admin/users/<id>).
  | ({ do: 'reporting' } & Omit<MobileActionInput<'setReportingRestriction'>, 'reason'>)
  | ({ do: 'role' } & Omit<MobileActionInput<'setUserRole'>, 'reason'>)
  | ({ do: 'signInBlock' } & Omit<MobileActionInput<'setSignInBlock'>, 'reason'>)
  | ({ do: 'sessions' } & Omit<MobileActionInput<'endSessions'>, 'reason'>)
  /** The reason is why the details are being looked at; the answer carries them. */
  | ({ do: 'reveal' } & Omit<MobileActionInput<'revealContact'>, 'reason'>)
  /** The "reason" is the note itself. */
  | ({ do: 'note' } & Omit<MobileActionInput<'addModerationNote'>, 'body'>)
  // The rest of the website's console (docs/prompts/mobile-admin-parity.md).
  /** No reason: recorded, nobody is told. */
  | ({ do: 'featured' } & MobileActionInput<'setJobFeatured'>)
  | ({ do: 'suspension' } & Omit<MobileActionInput<'setCompanySuspension'>, 'reason'>)
  | ({ do: 'restriction' } & Omit<MobileActionInput<'setAgentRestriction'>, 'reason'>)
  /** The "reason" is the note; `abusive` marks a dismissal as bad faith (the note is then required). */
  | ({ do: 'closeReports' } & Omit<MobileActionInput<'closeReports'>, 'note'>)
  /** The "reason" is the note to the appellant: optional on a reversal, required on upholding. */
  | ({ do: 'appeal' } & Omit<MobileActionInput<'decideAppeal'>, 'note'>)
  /** The whole form travels in the lever: the sheet confirms, it does not ask for a reason. */
  | ({ do: 'taxonomy' } & MobileActionInput<'saveTaxonomy'>)
  | ({ do: 'deleteTaxonomy' } & MobileActionInput<'deleteTaxonomy'>)
  | ({ do: 'requeue' } & MobileActionInput<'requeueEmail'>)
  | ({ do: 'closeDeletion' } & MobileActionInput<'closeDeletionRequest'>);

/** A reason given only when it says something: an empty box is no reason. */
function given(reason: string): string | undefined {
  const text = reason.trim();
  return text ? text : undefined;
}

export function pullLever(lever: Lever, reason: string): Promise<ActionResult<unknown>> {
  switch (lever.do) {
    case 'job':
      return callAction('moderateJob', { jobId: lever.jobId, action: lever.action, version: lever.version, reason: given(reason) });
    case 'company':
      return callAction('reviewCompany', {
        companyId: lever.companyId,
        decision: lever.decision,
        version: lever.version,
        note: given(reason),
      });
    case 'approval':
      return callAction('setAccountApproval', { userId: lever.userId, status: lever.status, note: given(reason) });
    case 'reports':
      return callAction('moderateReports', {
        targetType: lever.targetType,
        targetId: lever.targetId,
        status: lever.status,
        takeAction: lever.takeAction ?? false,
        note: given(reason),
      });
    case 'reporting':
      return callAction('setReportingRestriction', { userId: lever.userId, restrict: lever.restrict, reason: given(reason) });
    case 'role':
      return callAction('setUserRole', { userId: lever.userId, role: lever.role, reason: given(reason) });
    case 'signInBlock':
      return callAction('setSignInBlock', { userId: lever.userId, block: lever.block, reason: given(reason) });
    case 'sessions':
      return callAction('endSessions', { userId: lever.userId, reason: given(reason) });
    case 'reveal':
      return callAction('revealContact', { userId: lever.userId, reason: given(reason) });
    case 'note':
      return callAction('addModerationNote', { targetType: lever.targetType, targetId: lever.targetId, body: reason.trim() });
    case 'featured':
      return callAction('setJobFeatured', { jobId: lever.jobId, featured: lever.featured });
    case 'suspension':
      return callAction('setCompanySuspension', { companyId: lever.companyId, suspend: lever.suspend, reason: given(reason) });
    case 'restriction':
      return callAction('setAgentRestriction', { agentId: lever.agentId, restrict: lever.restrict, reason: given(reason) });
    case 'closeReports':
      return callAction('closeReports', { ids: lever.ids, status: lever.status, abusive: lever.abusive ?? false, note: given(reason) });
    case 'appeal':
      return callAction('decideAppeal', { appealId: lever.appealId, overturn: lever.overturn, note: given(reason) });
    case 'taxonomy':
      return callAction('saveTaxonomy', {
        kind: lever.kind,
        id: lever.id,
        nameAr: lever.nameAr,
        nameEn: lever.nameEn,
        slug: lever.slug,
        governorateId: lever.governorateId,
      });
    case 'deleteTaxonomy':
      return callAction('deleteTaxonomy', { kind: lever.kind, id: lever.id });
    case 'requeue':
      return callAction('requeueEmail', { emailId: lever.emailId });
    case 'closeDeletion':
      return callAction('closeDeletionRequest', { requestId: lever.requestId });
  }
}

/**
 * Everything the console shows is read again after a decision — whether it
 * went through or was refused because somebody else got there first, which is
 * answered by showing the state as it is now. The public board and pages a
 * decision changes are read again too.
 */
export function useAfterLever() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin'] }),
      queryClient.invalidateQueries({ queryKey: ['jobs'] }),
      queryClient.invalidateQueries({ queryKey: ['companies'] }),
      // A restriction changes the directory; a taxonomy change, every filter
      // (the app keeps taxonomies across launches).
      queryClient.invalidateQueries({ queryKey: ['agents'] }),
      queryClient.invalidateQueries({ queryKey: ['taxonomy'] }),
    ]).then(() => undefined);
}
