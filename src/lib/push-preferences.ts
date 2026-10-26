import type { ProfileRow } from '@/lib/supabase/database.types';

/**
 * What reaches the person's phones (migration 335): the day's new listings,
 * application events, everything else, and whether the night is kept quiet.
 * The person's, not one phone's — they live on the profile beside the email
 * switches. The app and the account page read the same shape.
 */
export type PushPreferences = {
  push_job_alerts: boolean;
  push_applications: boolean;
  push_account: boolean;
  push_quiet_hours: boolean;
};

/**
 * The profile's switches, or null while the database does not have them yet
 * (migration 335 not applied): then there is nothing to edit, and a save
 * could only be refused.
 */
export function pushPreferencesOf(profile: ProfileRow): PushPreferences | null {
  const { push_job_alerts, push_applications, push_account, push_quiet_hours } = profile;
  if (
    typeof push_job_alerts !== 'boolean' ||
    typeof push_applications !== 'boolean' ||
    typeof push_account !== 'boolean' ||
    typeof push_quiet_hours !== 'boolean'
  ) {
    return null;
  }
  return { push_job_alerts, push_applications, push_account, push_quiet_hours };
}
