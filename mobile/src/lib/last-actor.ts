import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Actor } from '@/lib/permissions';
import type { ApprovalStatus, UserRole, VerificationStatus } from '@/lib/supabase/database.types';

/**
 * Who was signed in on this phone when the app last knew.
 *
 * The tab bar depends on who is signed in, and so does where a link may go.
 * At launch the profile has not been read yet — it takes a request, and
 * offline it never arrives — so the first frame, and a link that opened the
 * app, go by the last answer instead. When the profile is read again it
 * replaces this; signing out forgets it.
 *
 * Only the slice src/lib/permissions.ts reads: the role, the approval, and the
 * company as an id and its verification. Never an authority: the database
 * decides what every request may see, whatever this says.
 */
const KEY = 'bc.last-actor.v1';

const ROLES: readonly UserRole[] = ['candidate', 'employer', 'admin'];
const APPROVALS: readonly ApprovalStatus[] = ['pending', 'approved', 'rejected'];
const VERIFICATIONS: readonly VerificationStatus[] = ['unverified', 'pending', 'verified', 'rejected'];

/** Never throws: an unreadable or garbled entry is nobody. */
export async function readLastActor(): Promise<Actor> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? parseActor(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** Kept for the next launch; `null` forgets. Never throws. */
export async function rememberActor(actor: Actor): Promise<void> {
  try {
    if (actor) await AsyncStorage.setItem(KEY, JSON.stringify(actor));
    else await AsyncStorage.removeItem(KEY);
  } catch {
    // The next launch goes by the session alone, which is only slower.
  }
}

export function parseActor(value: unknown): Actor {
  if (!value || typeof value !== 'object') return null;
  const { userId, profile, company } = value as Record<string, unknown>;
  if (typeof userId !== 'string' || !userId) return null;

  let parsedProfile: NonNullable<Actor>['profile'] = null;
  if (profile) {
    const { role, approval_status } = profile as Record<string, unknown>;
    if (!ROLES.includes(role as UserRole) || !APPROVALS.includes(approval_status as ApprovalStatus)) return null;
    parsedProfile = { role: role as UserRole, approval_status: approval_status as ApprovalStatus };
  }

  let parsedCompany: NonNullable<Actor>['company'] = null;
  if (company) {
    const { id, verification_status } = company as Record<string, unknown>;
    if (typeof id !== 'string' || !VERIFICATIONS.includes(verification_status as VerificationStatus)) return null;
    parsedCompany = { id, verification_status: verification_status as VerificationStatus };
  }

  return { userId, profile: parsedProfile, company: parsedCompany };
}
