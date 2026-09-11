import type { EmployerSummary } from '@/lib/supabase/database.types';
import type { NextActionKind } from '@/components/dashboard/next-action';

/**
 * Which one thing the employer console puts above everything else.
 *
 * Ordered conditions, first true wins, no ranking model and no guess. The
 * ordering *is* the logic — ties are impossible because the order is total,
 * which is what makes the page behave the same way twice for the same state.
 * A dashboard that reorders itself between refreshes teaches people not to
 * trust it.
 *
 * Out here rather than inline in the page, and not for tidiness: the chain has
 * grown to five branches and the property worth holding is the order between
 * them, which a page nobody can call cannot assert. The page keeps the copy —
 * it has the translator — and this decides.
 *
 * Order is by the cost of ignoring the thing:
 *
 *   verification  Rejected paperwork blocks verification entirely, and with it
 *                 the consultant directory and the unverified post cap.
 *   applicants    People waiting on a reply. Not a number about the company —
 *                 a number about somebody else's week.
 *   expiring      A listing that disappears from search on a known date, and
 *                 can still be saved before it does.
 *   ended         One that already has. Nothing more is lost by waiting a day,
 *                 which is why it sits below expiring rather than above it —
 *                 but it was missing entirely, so when a listing ended the
 *                 console simply went quiet about it.
 *   draft         Work not yet done, which nobody else is waiting on.
 *
 * Returns null when nothing needs doing, and the page renders nothing. An
 * empty state here would be a card whose content is "no content".
 */
export type EmployerAction = {
  kind: NextActionKind;
  tone: 'urgent' | 'attention' | 'good';
  /** The key suffix the page's copy uses, and the count it interpolates. */
  key: 'Verification' | 'Applicants' | 'Expiring' | 'Ended' | 'Draft';
  count: number;
  href: string;
};

export function employerNextAction(summary: EmployerSummary): EmployerAction | null {
  if (!summary.has_company) return null;

  if (summary.verification === 'rejected') {
    return { kind: 'verification', tone: 'urgent', key: 'Verification', count: 0, href: '/employer/company' };
  }

  /*
    `applicants_new`, not `applicants_unseen`, and the card's own words are
    why: it says "لسه ما اتحرّكتش حالتهم" — their status has not moved — which
    is `status = 'new'` exactly. It used to count `employer_viewed_at is null`,
    which meant the same thing only because a pipeline move was the one thing
    that wrote that column. The inbox writes it now, so the two have come
    apart: one is "you have not looked", the other is "you have not decided",
    and this card has always been about the second.
  */
  if (summary.applicants_new > 0) {
    return {
      kind: 'applicants',
      tone: 'good',
      key: 'Applicants',
      count: summary.applicants_new,
      href: '/employer/applicants?stage=new',
    };
  }

  if (summary.expiring_soon > 0) {
    return { kind: 'expiring', tone: 'attention', key: 'Expiring', count: summary.expiring_soon, href: '/employer/jobs' };
  }

  if (summary.ended_jobs > 0) {
    return { kind: 'ended', tone: 'attention', key: 'Ended', count: summary.ended_jobs, href: '/employer/jobs' };
  }

  if (summary.draft_jobs > 0) {
    return { kind: 'draft', tone: 'attention', key: 'Draft', count: summary.draft_jobs, href: '/employer/jobs' };
  }

  return null;
}
