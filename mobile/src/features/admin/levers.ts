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
  | ({ do: 'note' } & Omit<MobileActionInput<'addModerationNote'>, 'body'>);

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
      return callAction('setReportingRestriction', { userId: lever.userId, restrict: lever.restrict, reason: reason.trim() });
    case 'role':
      return callAction('setUserRole', { userId: lever.userId, role: lever.role, reason: reason.trim() });
    case 'signInBlock':
      return callAction('setSignInBlock', { userId: lever.userId, block: lever.block, reason: reason.trim() });
    case 'sessions':
      return callAction('endSessions', { userId: lever.userId, reason: reason.trim() });
    case 'reveal':
      return callAction('revealContact', { userId: lever.userId, reason: reason.trim() });
    case 'note':
      return callAction('addModerationNote', { targetType: lever.targetType, targetId: lever.targetId, body: reason.trim() });
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
    ]).then(() => undefined);
}
