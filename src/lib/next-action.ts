/**
 * The kinds of "one thing worth doing now" card the dashboards can show.
 *
 * The list is the contract between the logic that picks a card (the employer
 * chain in `employer-next-action.ts`, the candidate page) and the component
 * that draws one, which gives each kind its icon. It lived as the keys of
 * that component's icon map; it lives here so the pickers — and the mobile
 * app, which draws its own card — do not have to import a React component to
 * name a kind.
 */
export const NEXT_ACTION_KINDS = [
  'applicants',
  'expiring',
  'ended',
  'draft',
  'verification',
  'profile',
  'replies',
] as const;

export type NextActionKind = (typeof NEXT_ACTION_KINDS)[number];
