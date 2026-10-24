'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { ImageUp, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { saveAvatar } from '@/lib/actions/account';
import { uploadImage } from '@/lib/actions/uploads';
import { imageFailureCopy } from '@/lib/image-upload';
import { IMAGE_ACCEPT, prepareUploadImage } from '@/lib/prepare-upload-image';
import { reach } from '@/lib/reach';
import { useSessionRecovery } from '@/lib/session-expired';

function described(
  tValidation: (key: 'imageType' | 'imageTooLarge' | 'uploadRateLimited' | 'storageError') => string,
  tCommon: (key: 'errorBody') => string,
  error: string,
  detail?: string,
) {
  return imageFailureCopy(error, detail, {
    imageType: tValidation('imageType'),
    imageTooLarge: tValidation('imageTooLarge'),
    uploadRateLimited: tValidation('uploadRateLimited'),
    storageError: tValidation('storageError'),
    generic: tCommon('errorBody'),
  });
}

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
 * The bytes go to the server, which decodes the picture and writes a fresh
 * WebP with nothing else in it — no EXIF, no trailing payload — into a folder
 * named for the account. A HEIC from an iPhone, and a picture larger than the
 * bucket's 2 MB, are converted in the browser first. The server checks the
 * bytes again. An SVG is still refused: it is a document that can carry
 * script, and anybody who signs up can send one.
 */

export function AvatarUpload({
  name,
  avatarUrl,
}: {
  name: string;
  avatarUrl: string | null;
}) {
  const t = useTranslations('account');
  const tCommon = useTranslations('common');
  const tValidation = useTranslations('validation');

  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  const [pending, startTransition] = useTransition();
  const recoverSession = useSessionRecovery();
  const busy = converting || pending;

  function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    // Emptied at once, whatever happens next. A picker only reports a change,
    // so after a failed upload the same photo was still selected, and choosing
    // it again — the obvious retry — did nothing at all.
    input.value = '';
    if (!file) return;

    setError(null);
    setConverting(true);
    // Outside the transition so the spinner paints while a HEIC is decoded.
    // The upload itself stays in one: a dropped request must not unmount the form.
    void (async () => {
      let prepared: Awaited<ReturnType<typeof prepareUploadImage>>;
      try {
        prepared = await prepareUploadImage(file, 'avatar');
      } catch {
        prepared = { ok: false, error: 'file_type' };
      }
      setConverting(false);
      if (!prepared.ok) {
        input.value = '';
        setError(described(tValidation, tCommon, prepared.error));
        return;
      }

      const form = new FormData();
      form.set('kind', 'avatar');
      form.set('file', prepared.file);
      startTransition(async () => {
        const result = await reach(uploadImage(form));
        if (recoverSession(result)) return;
        if (!result.ok) {
          setError(described(tValidation, tCommon, result.error, 'detail' in result ? result.detail : undefined));
          return;
        }
        setError(null);
        router.refresh();
      });
    })();
  }

  function remove() {
    startTransition(async () => {
      // The column is cleared and the file is left where it is for now:
      // deleting it here would break any page or email still holding the old
      // URL. The database queues it on the way out and the lifecycle sweep
      // removes it once its grace period has passed (migration 204).
      const result = await reach(saveAvatar({ storagePath: null }));
      if (recoverSession(result)) return;
      if (!result.ok) setError(tCommon('errorBody'));
      else {
        setError(null);
        router.refresh();
      }
    });
  }

  return (
    <section aria-busy={busy} className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:p-6">
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <Avatar name={name} src={avatarUrl} size="lg" />

        <div className="min-w-0">
          <h2 className="font-semibold">{t('photo')}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{t('photoHint')}</p>

          {converting ? (
            <p role="status" className="mt-2 text-sm text-muted-foreground">
              {tCommon('loading')}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Button asChild variant="outline" disabled={busy}>
          {/* A label, not a button that clicks a hidden input: the label is the
              control, so it works from the keyboard on its own. */}
          <label className="cursor-pointer">
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : <ImageUp aria-hidden />}
            {avatarUrl ? t('photoReplace') : t('photoUpload')}
            <input
              type="file"
              accept={IMAGE_ACCEPT}
              onChange={onPick}
              disabled={busy}
              className="sr-only"
            />
          </label>
        </Button>

        {avatarUrl ? (
          <Button variant="ghost" size="icon" onClick={remove} disabled={busy}>
            <Trash2 aria-hidden />
            <span className="sr-only">{tCommon('delete')}</span>
          </Button>
        ) : null}
      </div>
    </section>
  );
}
