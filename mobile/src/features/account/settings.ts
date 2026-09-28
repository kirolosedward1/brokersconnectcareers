import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { ProfileRow } from '@/lib/supabase/database.types';
import { callAction, getJson } from '~/lib/api';
import { useSession } from '~/lib/session';
import { supabase } from '~/lib/supabase';

/**
 * The account's own settings — the website's /dashboard/account, on the
 * phone: the photo, what we email, a copy of the data, the second factor.
 * Writes are the website's actions; the password, the email address and the
 * second factor are Supabase Auth's own calls against this session, exactly
 * as the website's browser code makes them.
 */

// ---------------------------------------------------------------------------
// The photo
// ---------------------------------------------------------------------------

/** The server's limit, which is also the bucket's. */
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

/** Wider than any place the photo is drawn, and small enough to send over a slow line. */
const PHOTO_EDGE = 1024;

export type PickedPhoto = { uri: string; name: string; type: 'image/jpeg' | 'image/png' };

/** Why a photo was not taken, in the website's words for each. */
export class PhotoRefused extends Error {
  constructor(readonly reason: 'file_type' | 'too_large' | 'failed') {
    super(reason);
    this.name = 'PhotoRefused';
  }
}

/**
 * A picture from the library, written again no wider than 1024 px — which is
 * also how a HEIC from the camera becomes something the server can read. The
 * server decodes it once more and keeps only the pixels, as a WebP. A photo
 * is cropped square in the system's own editor and sent as a JPEG; a logo is
 * left as drawn and sent as a PNG, so a transparent ground stays transparent.
 * Null when cancelled.
 */
export async function pickImage(kind: 'photo' | 'logo'): Promise<PickedPhoto | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: kind === 'photo',
    ...(kind === 'photo' ? { aspect: [1, 1] as [number, number] } : {}),
    quality: 1,
  });
  const asset = result.canceled ? null : result.assets[0];
  if (!asset) return null;

  const context = ImageManipulator.manipulate(asset.uri);
  const image = await (asset.width > PHOTO_EDGE ? context.resize({ width: PHOTO_EDGE }) : context).renderAsync();
  const saved =
    kind === 'photo'
      ? await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 })
      : await image.saveAsync({ format: SaveFormat.PNG });

  if (new File(saved.uri).size > MAX_PHOTO_BYTES) throw new PhotoRefused('too_large');
  return kind === 'photo'
    ? { uri: saved.uri, name: 'photo.jpg', type: 'image/jpeg' }
    : { uri: saved.uri, name: 'logo.png', type: 'image/png' };
}

/** The account's photo: square, as a JPEG. */
export const pickPhoto = () => pickImage('photo');

/** Send the photo to the website's uploadImage, which writes it and records it on the profile. */
export function useUploadPhoto() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (photo: PickedPhoto) => {
      const form = new FormData();
      form.append('kind', 'avatar');
      // React Native's form part for a file: read from the uri as it is sent.
      form.append('file', { uri: photo.uri, name: photo.name, type: photo.type } as unknown as Blob);
      const result = await callAction('uploadImage', form);
      if (!result.ok) {
        throw new PhotoRefused(result.error === 'file_type' || result.error === 'too_large' ? result.error : 'failed');
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['viewer'] }),
  });
}

/**
 * Take the photo off. Only the column is cleared: a page or an email may
 * still hold the old address, and the database removes the file once its
 * grace period has passed (migration 204).
 */
export function useRemovePhoto() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const result = await callAction('saveAvatar', { storagePath: null });
      if (!result.ok) throw new PhotoRefused('failed');
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['viewer'] }),
  });
}

// ---------------------------------------------------------------------------
// What we email
// ---------------------------------------------------------------------------

export type EmailPreferences = Pick<
  ProfileRow,
  'notify_applications' | 'notify_status' | 'notify_digest' | 'notify_applicant_digest'
>;

/** All four switches at once, as the website sends them. */
export function useSaveEmailPreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (next: EmailPreferences) => {
      const result = await callAction('updateNotificationPreferences', next);
      if (!result.ok) throw new Error(result.error);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['viewer'] }),
  });
}

// ---------------------------------------------------------------------------
// A copy of the data
// ---------------------------------------------------------------------------

/**
 * The website's /api/account/export — the portability right, as JSON — handed
 * to the share sheet, from where it can be saved to Files or sent anywhere.
 * The file is written to the cache and named as the website names it.
 * Refusals are the API's: `rate_limited` after five a day.
 */
export async function shareMyData(userId: string, dialogTitle: string): Promise<void> {
  const data = await getJson<unknown>('/api/account/export', { signedIn: true });
  const file = new File(Paths.cache, `brokers-connect-data-${userId.slice(0, 8)}.json`);
  if (file.exists) file.delete();
  file.create();
  file.write(JSON.stringify(data, null, 2));
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle });
}

// ---------------------------------------------------------------------------
// The second factor
// ---------------------------------------------------------------------------

export type SecondFactor = {
  /** A verified authenticator is on the account. */
  enrolled: boolean;
  /** What this session has proved. */
  level: 'aal1' | 'aal2';
};

/**
 * Whether the account has an authenticator and what this session has proved.
 * The factors are read fresh from Supabase (the copy inside the session is
 * the one from sign-in); the level is the session's own token. An answer that
 * cannot be had reads as "not set up", which offers enrolment — the safe
 * direction, as on the website.
 */
export function useSecondFactor() {
  const userId = useSession().session?.user.id ?? null;
  return useQuery({
    queryKey: ['mfa', userId],
    enabled: Boolean(userId),
    queryFn: async (): Promise<SecondFactor> => {
      const [factors, assurance] = await Promise.all([
        supabase.auth.mfa.listFactors(),
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      ]);
      return {
        enrolled: (factors.data?.totp.length ?? 0) > 0,
        level: assurance.data?.currentLevel === 'aal2' ? 'aal2' : 'aal1',
      };
    },
  });
}

export type Enrolment = { factorId: string; qr: string; secret: string; uri: string };

/**
 * Start setting up an authenticator. An abandoned attempt leaves an unverified
 * factor behind, and Supabase refuses a second under the same name, so those
 * go first — found among all the factors: the `totp` list holds only verified
 * ones.
 */
export async function beginEnrolment(): Promise<Enrolment | null> {
  const { data: existing } = await supabase.auth.mfa.listFactors();
  for (const factor of existing?.all ?? []) {
    if (factor.factor_type === 'totp' && factor.status !== 'verified') {
      await supabase.auth.mfa.unenroll({ factorId: factor.id });
    }
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Brokers Connect' });
  if (error || !data || data.type !== 'totp') return null;
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret, uri: data.totp.uri };
}

/** The first code from a new authenticator, or a code for a session still at aal1. True when accepted. */
export async function verifyCode(factorId: string | null, code: string): Promise<boolean> {
  let id = factorId;
  if (!id) {
    const { data } = await supabase.auth.mfa.listFactors();
    id = data?.totp[0]?.id ?? null;
  }
  if (!id) return false;
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: id, code });
  return !error;
}

/**
 * Turn the second factor off: every authenticator on the account. Supabase
 * allows it only from a session that has proved one (aal2), so a stolen
 * password alone cannot remove the thing that keeps it out. True when all went.
 */
export async function removeSecondFactor(): Promise<boolean> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) return false;
  let removed = true;
  for (const factor of (data?.all ?? []).filter((candidate) => candidate.factor_type === 'totp')) {
    const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
    if (unenrollError) removed = false;
  }
  return removed;
}
