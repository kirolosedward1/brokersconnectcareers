'use client';

import { useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { CheckCircle2, ImageUp, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { createClient } from '@/lib/supabase/client';
import { AVATAR_BUCKET } from '@/lib/buckets';
import { saveAvatar } from '@/lib/actions/account';
import { safeExtension } from '@/lib/storage-path';
import { uuid } from '@/lib/utils';
import { useSessionRecovery } from '@/lib/session-expired';

/**
 * The profile photo: upload, replace, remove.
 *
 * `profiles.avatar_url` is drawn in the console header, on the applicant card
 * an employer reads, in the team list, on the directory card and on the
 * consultant page. The rules are the company logo's: straight from the
 * browser into a public bucket, into a folder named for the account, where a
 * storage policy checks the folder is theirs; the server action turns the
 * path into a URL and writes it down, and the database refuses any URL that
 * is not a file in that folder.
 *
 * Every outcome is stated. The upload used to finish in silence — the photo
 * changed on the next render and nothing said so — and a failed save left the
 * file in the bucket and the picker holding a file it would not offer again.
 */
const MAX_BYTES = 2 * 1024 * 1024;

/** No SVG, for the reason spelled out on the logo uploader: it is a document
 *  that can carry script, and anybody who signs up can send one. */
const TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

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
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const recoverSession = useSessionRecovery();

  const reset = () => {
    if (inputRef.current) inputRef.current.value = '';
  };

  function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setSaved(false);

    if (file.size > MAX_BYTES) {
      setError(tValidation('fileTooLarge'));
      reset();
      return;
    }
    if (!TYPES.includes(file.type)) {
      setError(tValidation('fileType'));
      reset();
      return;
    }

    startTransition(async () => {
      // The extension from the type the browser reported, which the bucket
      // also checks, rather than from a file name anybody can spell.
      const extension = EXTENSIONS[file.type] ?? safeExtension(file.name, 'png');
      // A fresh name every time rather than a fixed one: the URL is public and
      // cached, and overwriting in place would leave the old photo showing.
      const path = `${userId}/${uuid()}.${extension}`;

      const storage = createClient().storage.from(AVATAR_BUCKET);
      const { error: uploadError } = await storage.upload(path, file, { contentType: file.type });

      if (uploadError) {
        setError(tCommon('errorBody'));
        reset();
        return;
      }

      const result = await saveAvatar({ storagePath: path });
      if (recoverSession(result)) return;
      if (!result.ok) {
        // Nothing points at the file now; the storage policy that allowed the
        // upload allows taking it back.
        await storage.remove([path]);
        setError(tCommon('errorBody'));
        reset();
        return;
      }

      setError(null);
      setSaved(true);
      reset();
      router.refresh();
    });
  }

  function remove() {
    setSaved(false);
    startTransition(async () => {
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
          ) : saved ? (
            <p role="status" className="mt-2 inline-flex items-center gap-1.5 text-sm text-success">
              <CheckCircle2 className="size-4" aria-hidden />
              {tCommon('saveSuccess')}
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
            {pending ? tCommon('loading') : avatarUrl ? t('photoReplace') : t('photoUpload')}
            <input
              ref={inputRef}
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
