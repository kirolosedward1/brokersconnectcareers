'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { AVATAR_BUCKET, COMPANY_LOGOS_BUCKET } from '@/lib/buckets';
import { IMAGE_KINDS, MAX_BYTES, reencodeImage, sniffKind } from '@/lib/security/files';
import { recordSecurityEvent } from '@/lib/security/events';
import { uuid } from '@/lib/utils';
import type { ActionResult } from '@/lib/actions/jobs';

/**
 * Photos and logos go through the server now.
 *
 * They used to go from the browser straight into a public bucket, checked by
 * the bucket's MIME list — which reads the type the browser declared, which is
 * the extension. A file that was not an image, or an image carrying more than
 * pixels (a phone's GPS position in the EXIF block, a payload past the end of
 * the picture data), was accepted and served from the platform's own origin.
 *
 * The server reads the bytes, recognises them, decodes the picture and writes
 * a fresh WebP with nothing else in it. Two megabytes is the most it will
 * read, which is also the bucket's own limit.
 *
 * Ownership is decided the way it was before: the photo is written into the
 * caller's own folder and recorded through the caller's own session, and the
 * logo is recorded through companies_update_own, which only a company admin
 * satisfies. The service role writes the object because the re-encoded bytes
 * are the server's — but only after the row-level check has said whose
 * folder this is, and the object is removed again if the record is refused.
 */

const MAX_UPLOAD_FIELD = MAX_BYTES.image;

type UploadOutcome = ActionResult<{ url: string }>;

export async function uploadImage(form: FormData): Promise<UploadOutcome> {
  const kind = form.get('kind');
  const file = form.get('file');
  const companyId = form.get('companyId');

  if ((kind !== 'avatar' && kind !== 'logo') || !(file instanceof File)) {
    return { ok: false, error: 'invalid' };
  }
  if (file.size === 0 || file.size > MAX_UPLOAD_FIELD) {
    return { ok: false, error: 'too_large' };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  // Whose folder. For a logo the company must be one the caller administers;
  // asked of the database rather than of the form.
  let folder = user.id;
  if (kind === 'logo') {
    if (typeof companyId !== 'string' || !/^[0-9a-f-]{36}$/.test(companyId)) {
      return { ok: false, error: 'invalid' };
    }
    const { data: membership } = await supabase
      .from('company_members')
      .select('role')
      .eq('company_id', companyId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (membership?.role !== 'admin') return { ok: false, error: 'forbidden' };
    folder = companyId;
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const sniffed = sniffKind(bytes.slice(0, 64));
  if (!sniffed || !IMAGE_KINDS.includes(sniffed)) {
    void recordSecurityEvent('upload.rejected', {
      actorId: user.id,
      metadata: { kind, reason: 'not_an_image', declared: file.type.slice(0, 40) },
    });
    return { ok: false, error: 'file_type' };
  }

  const image = await reencodeImage(bytes, { maxSide: kind === 'avatar' ? 512 : 1024 });
  if (!image) {
    void recordSecurityEvent('upload.rejected', {
      actorId: user.id,
      metadata: { kind, reason: 'undecodable' },
    });
    return { ok: false, error: 'file_type' };
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, error: 'unavailable' };
  }

  const bucket = kind === 'avatar' ? AVATAR_BUCKET : COMPANY_LOGOS_BUCKET;
  // A fresh name every time: the URL is public and cached, and overwriting in
  // place would leave the old picture showing.
  const path = `${folder}/${kind === 'logo' ? 'logo-' : ''}${uuid()}.webp`;

  const { error: uploadError } = await admin.storage
    .from(bucket)
    .upload(path, image.bytes, { contentType: 'image/webp', upsert: false, cacheControl: '31536000' });
  if (uploadError) return { ok: false, error: 'unavailable' };

  const url = admin.storage.from(bucket).getPublicUrl(path).data.publicUrl;

  const recorded =
    kind === 'avatar'
      ? await supabase.from('profiles').update({ avatar_url: url }).eq('id', user.id).select('id')
      : await supabase.from('companies').update({ logo_url: url }).eq('id', folder).select('id');

  if (recorded.error || !recorded.data?.length) {
    await admin.storage.from(bucket).remove([path]);
    return { ok: false, error: recorded.error ? 'failed' : 'forbidden' };
  }

  if (kind === 'avatar') {
    revalidatePath('/dashboard/account');
    revalidatePath('/dashboard/profile');
    revalidatePath('/agents');
  } else {
    revalidatePath('/employer/company');
    revalidatePath('/companies');
  }

  return { ok: true, data: { url } };
}
