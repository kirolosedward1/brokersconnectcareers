'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { ExternalLink } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { getDocumentUrl, verifyCompany } from '@/lib/actions/admin';

export function VerifyCompanyActions({
  companyId,
  documentIds,
}: {
  companyId: string;
  documentIds: string[];
}) {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');
  const router = useRouter();

  const [note, setNote] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  /** Both buttons run the same decision; only the verdict differs. */
  function decide(approve: boolean) {
    startTransition(async () => {
      setFailed(false);
      const result = await verifyCompany({ companyId, approve, note: approve ? undefined : note });
      if (!result.ok) {
        setFailed(true);
        return;
      }
      router.refresh();
    });
  }

  /**
   * Documents are never linked directly. The URL is minted on click and lives
   * for five minutes, so nothing durable ends up in the page or in history.
   */
  function openDocument(documentId: string) {
    startTransition(async () => {
      const result = await getDocumentUrl(documentId);
      if (result.ok) window.open(result.data!.url, '_blank', 'noopener,noreferrer');
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {documentIds.map((documentId, index) => (
        <Button
          key={documentId}
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => openDocument(documentId)}
        >
          <ExternalLink />
          <span >
            {t('viewDocument')} {index + 1}
          </span>
        </Button>
      ))}

      <Button
        variant="success"
        size="sm"
        disabled={pending}
        onClick={() => decide(true)}
      >
        {t('verify')}
      </Button>

      {rejecting ? (
        <>
          <Input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t('rejectReason')}
            size="sm"
            className="w-56"
            maxLength={500}
          />
          <Button
            variant="destructive"
            size="sm"
            disabled={pending}
            onClick={() => decide(false)}
          >
            {t('reject')}
          </Button>
        </>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => setRejecting(true)}>
          {t('reject')}
        </Button>
      )}

      {/* A verification that silently failed leaves a reviewer believing the
          queue is shorter than it is. */}
      {failed ? (
        <span role="alert" className="w-full text-sm text-destructive">
          {tCommon('errorBody')}
        </span>
      ) : null}
    </div>
  );
}
