'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { ImageUp, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CompanyLogo } from '@/components/companies/company-logo';
import { createClient } from '@/lib/supabase/client';
import { COMPANY_LOGOS_BUCKET } from '@/lib/buckets';
import { saveCompanyLogo } from '@/lib/actions/company';

/**
 * The other half of a feature that shipped with only its rendering.
 *
 * Company logos are drawn on the directory, the board, every listing and the
 * company page, and the bucket and its policies have been there since the
 * schema — but nothing ever let an employer put a file in it. Every company
 * showed the monogram fallback, permanently, and would have kept doing so.
 *
 * Uploads go straight from the browser to the public bucket, into a folder
 * named for the company, where a storage policy checks ownership. The server
 * action only records the resulting URL.
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
      const extension = file.name.split('.').pop()?.toLowerCase() ?? 'png';
      // A fresh name every time rather than a fixed one: the URL is public and
      // cached, and overwriting in place would leave the old logo showing.
      const path = `${companyId}/logo-${crypto.randomUUID()}.${extension}`;

      const { error: uploadError } = await createClient()
        .storage.from(COMPANY_LOGOS_BUCKET)
        .upload(path, file, { contentType: file.type });

      if (uploadError) {
        setError(tCommon('errorBody'));
        return;
      }

      const result = await saveCompanyLogo({ companyId, storagePath: path });
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
      // The column is cleared; the file is left in the bucket. Deleting it
      // would break any page still holding the old URL, and a 2 MB image is
      // not worth that.
      const result = await saveCompanyLogo({ companyId, storagePath: null });
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
