'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { ImageUp, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { createClient } from '@/lib/supabase/client';
import { AVATAR_BUCKET } from '@/lib/buckets';
import { saveAvatar } from '@/lib/actions/account';
import { uuid } from '@/lib/utils';
import { downscalePhoto } from '@/lib/downscale-image';
import { useSessionRecovery } from '@/lib/session-expired';

/**
 * The other half of a feature that shipped with only its rendering — the same
 * gap company logos had, on the other side of the product.
 *
 * `profiles.avatar_url` is drawn in the console header, on the applicant card
 * an employer reads, in the team list, on the directory card and on the public
 * consultant page. Exactly one thing has ever written it: the onboarding
 * action, copying whatever Google supplied. So an account created with an
 * email address had no photo and no way to acquire one, and every profile on
 * the platform showed the monogram — permanently.
 *
 * Everything about the upload is the logo's shape, because the rules are the
 * same: straight from the browser into a public bucket, into a folder named
 * for the account, where a storage policy checks the folder is theirs. The
 * server action only turns the path into a URL and writes it down.
 */
/**
 * What may be picked, and what may be stored.
 *
 * The bucket holds 2 MB (migration 35) and that is still the rule for what is
 * stored — but what is stored is now the photo shrunk to the size it is shown
 * at (see downscale-image.ts), a few tens of KB. So a phone photo of 4 MB,
 * which the old check turned away, is fine to pick; only a photo the browser
 * cannot shrink is held to the bucket's own limit.
 */
const MAX_PICK_BYTES = 10 * 1024 * 1024;
const MAX_STORED_BYTES = 2 * 1024 * 1024;

/** No SVG, for the reason spelled out on the logo uploader: it is a document
 *  that can carry script, and anybody who signs up can send one. */
const TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export function AvatarUpload({
  userId,
  name,
  avatarUrl,
}: {
  userId: string;
  name: string;
  avatarUrl: string | null;
}) {
  const t = useTranslations('account');
  const tCommon = useTranslations('common');
  const tValidation = useTranslations('validation');

  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const recoverSession = useSessionRecovery();

  function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_PICK_BYTES) {
      setError(tValidation('fileTooLarge'));
      event.target.value = '';
      return;
    }
    if (!TYPES.includes(file.type)) {
      setError(tValidation('fileType'));
      event.target.value = '';
      return;
    }

    startTransition(async () => {
      const small = await downscalePhoto(file);
      if (!small && file.size > MAX_STORED_BYTES) {
        setError(tValidation('fileTooLarge'));
        event.target.value = '';
        return;
      }
      const body = small ?? file;
      const extension = small ? 'jpg' : (file.name.split('.').pop()?.toLowerCase() ?? 'png');
      // A fresh name every time rather than a fixed one: the URL is public and
      // cached, and overwriting in place would leave the old photo showing.
      const path = `${userId}/${uuid()}.${extension}`;

      const { error: uploadError } = await createClient()
        .storage.from(AVATAR_BUCKET)
        .upload(path, body, {
          contentType: small ? 'image/jpeg' : file.type,
          // The name is never reused, so the file can be cached for good: a
          // returning reader's browser and Supabase's CDN keep it instead of
          // fetching it again every hour, the storage default.
          cacheControl: '31536000',
        });

      if (uploadError) {
        setError(tCommon('errorBody'));
        return;
      }

      const result = await saveAvatar({ storagePath: path });
      if (recoverSession(result)) return;
      if (!result.ok) {
        setError(tCommon('errorBody'));
        return;
      }

      setError(null);
      event.target.value = '';
      router.refresh();
    });
  }

  function remove() {
    startTransition(async () => {
      // The column is cleared; the file stays in the bucket. Deleting it would
      // break any page still holding the old URL, and a 2 MB image is not
      // worth that.
      const result = await saveAvatar({ storagePath: null });
      if (recoverSession(result)) return;
      if (!result.ok) setError(tCommon('errorBody'));
      else {
        setError(null);
        router.refresh();
      }
    });
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:p-6">
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <Avatar name={name} src={avatarUrl} size="lg" />

        <div className="min-w-0">
          <h2 className="font-semibold">{t('photo')}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{t('photoHint')}</p>

          {error ? (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Button asChild variant="outline" disabled={pending}>
          {/* A label, not a button that clicks a hidden input: the label is the
              control, so it works from the keyboard on its own. */}
          <label className="cursor-pointer">
            <ImageUp />
            {avatarUrl ? t('photoReplace') : t('photoUpload')}
            <input
              type="file"
              accept={TYPES.join(',')}
              onChange={onPick}
              disabled={pending}
              className="sr-only"
            />
          </label>
        </Button>

        {avatarUrl ? (
          <Button variant="ghost" size="icon" onClick={remove} disabled={pending}>
            <Trash2 />
            <span className="sr-only">{tCommon('delete')}</span>
          </Button>
        ) : null}
      </div>
    </section>
  );
}
