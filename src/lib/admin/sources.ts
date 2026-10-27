/** Where an account came from. The query string stores the id, not the label. */
export const ACCOUNT_SOURCES = [
  'google',
  'google_ads',
  'facebook',
  'instagram',
  'tiktok',
  'linkedin',
  'x',
  'whatsapp',
  'email',
  'referral',
  'app',
  'direct',
  'unknown',
  'other',
] as const;

export type AccountSource = (typeof ACCOUNT_SOURCES)[number];

/** Groups inside the source menu. The ids are message keys, not query values. */
export const SOURCE_GROUPS = [
  { id: 'search', sources: ['google', 'google_ads'] },
  { id: 'social', sources: ['facebook', 'instagram', 'tiktok', 'linkedin', 'x', 'whatsapp'] },
  { id: 'other', sources: ['email', 'referral', 'app', 'direct', 'unknown', 'other'] },
] as const satisfies readonly { id: string; sources: readonly AccountSource[] }[];
