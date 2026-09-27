'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { ImageUp, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { saveAvatar } from '@/lib/actions/account';
import { uploadImage } from '@/lib/actions/uploads';
import { reach } from '@/lib/reach';
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
 * The bytes go to the server, which decodes the picture and writes a fresh
 * WebP with nothing else in it — no EXIF, no trailing payload — into a folder
 * named for the account. The checks below are a courtesy to the person, so a
 * wrong file is refused before it is sent; the server makes them again from
 * the bytes rather than from the browser's guess.
 */
const MAX_BYTES = 2 * 1024 * 1024;

/** No SVG, for the reason spelled out on the logo uploader: it is a document
 *  that can carry script, and anybody who signs up can send one. */
const TYPES = ['image/png', 'image/jpeg', 'image/webp'];

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
  const [pending, startTransition] = useTransition();
  const recoverSession = useSessionRecovery();

  function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_BYTES) {
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
      const form = new FormData();
      form.set('kind', 'avatar');
      form.set('file', file);

      const result = await reach(uploadImage(form));
      if (recoverSession(result)) return;
      if (!result.ok) {
        setError(
          result.error === 'file_type'
            ? tValidation('fileType')
            : result.error === 'too_large'
              ? tValidation('fileTooLarge')
              : tCommon('errorBody'),
        );
        return;
      }

      setError(null);
      event.target.value = '';
      router.refresh();
    });
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
