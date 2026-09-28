'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { ImageUp, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CompanyLogo } from '@/components/companies/company-logo';
import { saveCompanyLogo } from '@/lib/actions/company';
import { uploadImage } from '@/lib/actions/uploads';
import { reach } from '@/lib/reach';
import { fileType } from '@/lib/file-type';
import { useSessionRecovery } from '@/lib/session-expired';

/**
 * The other half of a feature that shipped with only its rendering.
 *
 * Company logos are drawn on the directory, the board, every listing and the
 * company page, and the bucket and its policies have been there since the
 * schema — but nothing ever let an employer put a file in it. Every company
 * showed the monogram fallback, permanently, and would have kept doing so.
 *
 * The bytes go to the server, which checks that they are a picture, decodes
 * it and writes a fresh WebP into the company's folder — and records the URL
 * through the caller's own session, so only a company admin's upload sticks.
 */
const MAX_BYTES = 2 * 1024 * 1024;
/**
 * No SVG, deliberately.
 *
 * The logo renders through next/image everywhere it appears, and next/image
 * refuses an SVG source unless `dangerouslyAllowSVG` is set — it answers 400.
 * So an SVG logo was accepted by this form, accepted by the bucket, stored,
 * and then broken on the board, the directory and every listing.
 *
 * The fix is to stop accepting it rather than to set that flag. The flag is
 * named the way it is because an SVG is a document that can carry script, and
 * these are uploaded by anybody who registers a company. PNG, JPEG and WebP
 * cover every real logo.
 */
const TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export function LogoUpload({
  companyId,
  companyName,
  companySlug,
  logoUrl,
}: {
  companyId: string;
  companyName: string;
  companySlug: string;
  logoUrl: string | null;
}) {
  const t = useTranslations('employer');
  const tCommon = useTranslations('common');
  const tValidation = useTranslations('validation');

  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const recoverSession = useSessionRecovery();

  function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Emptied at once, whatever happens next. A picker only reports a change,
    // so after a failed upload the same photo was still selected, and choosing
    // it again — the obvious retry — did nothing at all.
    event.target.value = '';
    if (!file) return;

    if (file.size > MAX_BYTES) {
      setError(tValidation('fileTooLarge'));
      return;
    }
    // The browser's guess, with the extension standing in when it has none;
    // the server checks the bytes either way.
    if (!TYPES.includes(fileType(file))) {
      setError(tValidation('fileType'));
      return;
    }

    startTransition(async () => {
      const form = new FormData();
      form.set('kind', 'logo');
      form.set('companyId', companyId);
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
      router.refresh();
    });
  }

  function remove() {
    startTransition(async () => {
      // The column is cleared and the file is left where it is for now:
      // deleting it here would break any page or email still holding the old
      // URL. The database queues it on the way out and the lifecycle sweep
      // removes it once its grace period has passed (migration 204).
      const result = await reach(saveCompanyLogo({ companyId, storagePath: null }));
      if (recoverSession(result)) return;
      if (!result.ok) setError(tCommon('errorBody'));
      else {
        setError(null);
        router.refresh();
      }
    });
  }

  // Three items on one flex line squeezed the hint into a ~90px column on a
  // phone, where it wrapped to five lines between the preview and the buttons.
  // The buttons drop below instead.
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <CompanyLogo name={companyName} logoUrl={logoUrl} seed={companySlug} size="lg" />

        <div className="min-w-0">
          <p className="text-sm font-medium">{t('logo')}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('logoHint')}</p>

          {error ? (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Button asChild variant="outline" disabled={pending}>
          {/* A label, not a button that clicks a hidden input: the label is
              the control, so it works from the keyboard on its own. */}
          <label className="cursor-pointer">
            <ImageUp />
            {logoUrl ? t('logoReplace') : t('logoUpload')}
            <input
              type="file"
              accept={TYPES.join(',')}
              onChange={onPick}
              disabled={pending}
              className="sr-only"
            />
          </label>
        </Button>

        {logoUrl ? (
          <Button variant="ghost" size="icon" onClick={remove} disabled={pending}>
            <Trash2 />
            <span className="sr-only">{tCommon('delete')}</span>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
