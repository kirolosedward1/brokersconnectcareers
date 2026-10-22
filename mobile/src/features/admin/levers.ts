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
  | ({ do: 'reports' } & MobileActionInput<'moderateReports'>);

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
