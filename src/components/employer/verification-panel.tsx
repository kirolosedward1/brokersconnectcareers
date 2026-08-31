'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, FileCheck2, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import { recordCompanyDocument } from '@/lib/actions/company';
import type { CompanyDocumentRow, VerificationStatus } from '@/lib/supabase/database.types';

const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = ['application/pdf', 'image/png', 'image/jpeg'];

export function VerificationPanel({
  companyId,
  status,
  documents,
}: {
  companyId: string;
  status: VerificationStatus;
  documents: CompanyDocumentRow[];
}) {
  const t = useTranslations('employer');
  const tCompanies = useTranslations('companies');
  const tCommon = useTranslations('common');
  const tValidation = useTranslations('validation');

  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function upload(docType: 'commercial_register' | 'tax_card') {
    return (event: React.ChangeEvent<HTMLInputElement>) => {
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
        const extension = file.name.split('.').pop()?.toLowerCase() ?? 'pdf';
        // Private bucket, keyed by company id. Nothing here is ever served
        // publicly — reviewers read it through a signed URL.
        const path = `${companyId}/${docType}-${crypto.randomUUID()}.${extension}`;

        const { error: uploadError } = await createClient()
          .storage.from('company-documents')
          .upload(path, file, { contentType: file.type });

        if (uploadError) {
          setError(tCommon('errorBody'));
          return;
        }

        const result = await recordCompanyDocument({ companyId, docType, storagePath: path });
        if (!result.ok) {
          setError(tCommon('errorBody'));
          return;
        }

        setError(null);
        router.refresh();
      });
    };
  }

  if (status === 'verified') {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-success/30 bg-success-muted p-5">
        <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden />
        <p className="font-medium">{tCompanies('verified')}</p>
      </div>
    );
  }

  const byType = (docType: string) => documents.filter((doc) => doc.doc_type === docType);

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="font-semibold">{t('verification')}</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t('verificationBody')}</p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {(['commercial_register', 'tax_card'] as const).map((docType) => {
          const uploaded = byType(docType);
          return (
            <div key={docType} className="rounded-lg border border-border p-4">
              <p className="text-sm font-medium">
                {docType === 'commercial_register' ? t('commercialRegister') : t('taxCard')}
              </p>

              {uploaded.length ? (
                <ul className="mt-2 space-y-1">
                  {uploaded.map((doc) => (
                    <li key={doc.id} className="flex items-center gap-2 text-xs">
                      <FileCheck2 className="size-3.5 text-muted-foreground" aria-hidden />
                      <Badge variant={doc.status === 'rejected' ? 'destructive' : 'warning'}>
                        {doc.status === 'rejected' ? tCommon('error') : tCommon('loading')}
                      </Badge>
                      {doc.review_note ? (
                        <span className="text-muted-foreground">{doc.review_note}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}

              <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-primary hover:underline">
                <Upload className="size-4" aria-hidden />
                {t('uploadDoc')}
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg"
                  className="sr-only"
                  disabled={pending}
                  onChange={upload(docType)}
                />
              </label>
            </div>
          );
        })}
      </div>

      {error ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <p className="mt-4 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
        {t('unverifiedCap')}
      </p>
    </section>
  );
}
