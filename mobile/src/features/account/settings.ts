import { useState } from 'react';
import { Platform } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Application from 'expo-application';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { ProfileRow } from '@/lib/supabase/database.types';
import { uuid } from '@/lib/uuid';
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

/** A picture ready to send: a JPEG (a photo) or a PNG (a logo) in the app's cache. */
export type PickedPhoto = { uri: string };

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
  return { uri: saved.uri };
}

/** The account's photo: square, as a JPEG. */
export const pickPhoto = () => pickImage('photo');

/**
 * A picked picture as a form's file part: the file itself, whose bytes and name
 * Expo's fetch reads when it builds the request.
 *
 * Not React Native's `{ uri, name, type }` part, which this was. Expo replaces
 * the global fetch with its own (expo/src/winter), and that one refuses such a
 * part ("Unsupported FormDataPart implementation"); the app reported the throw
 * as being offline, and no photo or logo ever reached the website from a
 * phone. The tests missed it for sending through a stand-in fetch; they now put
 * the form through Expo's own conversion (tests/multipart.ts).
 */
export function formFile(picked: PickedPhoto): Blob {
  return new File(picked.uri);
}

/** Send the photo to the website's uploadImage, which writes it and records it on the profile. */
export function useUploadPhoto() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (photo: PickedPhoto) => {
      const form = new FormData();
      form.append('kind', 'avatar');
      form.append('file', formFile(photo));
      const result = await callAction('uploadImage', form);
      if (!result.ok) {
        throw new PhotoRefused(result.error === 'file_type' || result.error === 'too_large' ? result.error : 'failed');
      }
    },
    // The account, and the directory card it is drawn on (the profile's
    // preview). Returned, so the button is busy until the new photo shows.
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['viewer'] }),
        queryClient.invalidateQueries({ queryKey: ['directory', 'card'] }),
      ]),
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
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['viewer'] }),
        queryClient.invalidateQueries({ queryKey: ['directory', 'card'] }),
      ]),
  });
}

// ---------------------------------------------------------------------------
// What we email
// ---------------------------------------------------------------------------

export type EmailPreferences = Pick<
  ProfileRow,
  'notify_applications' | 'notify_status' | 'notify_digest' | 'notify_applicant_digest' | 'notify_profile_nudge'
>;

/** Every switch at once, as the website sends them (the profile reminder only where the profile has it). */
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
 * The file is written to the cache, named as the website names it, and
 * deleted once the share sheet closes: it is the person's whole account, and
 * a copy left behind outlived even the account's deletion. Refusals are the
 * API's: `rate_limited` after five a day.
 */
export async function shareMyData(userId: string, dialogTitle: string): Promise<void> {
  const data = await getJson<unknown>('/api/account/export', { signedIn: true });
  const file = new File(Paths.cache, `brokers-connect-data-${userId.slice(0, 8)}.json`);
  if (file.exists) file.delete();
  file.create();
  file.write(JSON.stringify(data, null, 2));
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle }).finally(() => {
    try {
      file.delete();
    } catch {
      // Gone already.
    }
  });
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

// ---------------------------------------------------------------------------
// An owner asking for the account to be deleted
// ---------------------------------------------------------------------------

/**
 * The open request this person made to have their account deleted, if any —
 * their own support request, which they may read (migration 201's policy).
 * Allowed to fail quietly: offering the button again is the safe answer, and
 * the website converges a repeat on the day's limit.
 */
export function useDeletionRequest() {
  const userId = useSession().session?.user.id ?? null;
  return useQuery({
    queryKey: ['account', 'deletion-request', userId],
    enabled: Boolean(userId),
    queryFn: async (): Promise<string | null> => {
      const { data } = await supabase
        .from('support_requests')
        .select('reference')
        .eq('user_id', userId as string)
        .eq('topic', 'account_deletion')
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(1);
      return data?.[0]?.reference ?? null;
    },
  });
}

/** Why a deletion request was not filed: too many today, not an owner after all, or anything else. */
export class DeletionRequestRefused extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'DeletionRequestRefused';
  }
}

/**
 * Ask for the account to be deleted — the website's requestAccountDeletion,
 * for an owner, whose account cannot be deleted at a tap without taking the
 * company and other people's applications with it. One key for the life of
 * the screen, so a retry after a timeout is the same request.
 */
export function useRequestDeletion() {
  const queryClient = useQueryClient();
  const [key] = useState(uuid);
  return useMutation({
    mutationFn: async (): Promise<string> => {
      const version = Application.nativeApplicationVersion ?? '';
      const result = await callAction('requestAccountDeletion', {
        key,
        client: `Brokers Connect app · ${Platform.OS} ${version}`.trim(),
      });
      if (!result.ok) throw new DeletionRequestRefused(result.error);
      return result.data?.reference ?? '';
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['account', 'deletion-request'] }),
  });
}
