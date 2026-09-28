'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getDocumentUrl } from '@/lib/actions/admin';
import { isAdminErrorCode } from '@/lib/admin/errors';

/**
 * Opens one private verification document in a new tab, through a URL that
 * lives five minutes and is minted only when asked for — never rendered into
 * the page, where it would outlive the session. Asking is recorded.
 */
export function DocumentLink({ documentId, label }: { documentId: string; label: string }) {
  const t = useTranslations('admin');
  const [error, setError] = useState<string | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function open() {
    // Opened synchronously, inside the click, so a popup blocker sees a user
    // gesture; the address arrives when the server answers.
    const tab = window.open('about:blank', '_blank');
    startTransition(async () => {
      setError(null);
      try {
        const result = await getDocumentUrl(documentId);
        if (!result.ok || !result.data) {
          tab?.close();
          const code = result.ok ? 'not_found' : result.error;
          setError(isAdminErrorCode(code) ? t(`errors.${code}`) : t('errors.unknown'));
          return;
        }
        if (tab) {
          tab.opener = null;
          tab.location.href = result.data.url;
        } else {
          // A popup blocker ate the tab. The URL is Supabase's own signed
          // link, but this page does not navigate itself away to it — it
          // offers it, and the admin opens it with a click the blocker allows.
          setFallback(result.data.url);
        }
      } catch {
        tab?.close();
        setError(t('errors.network'));
      }
    });
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button type="button" variant="outline" size="sm" onClick={open} disabled={pending}>
        <FileText />
        {label}
      </Button>
      {fallback ? (
        <a href={fallback} target="_blank" rel="noreferrer noopener" className="text-xs text-primary underline">
          {t('openDocument')}
        </a>
      ) : null}
      {error ? (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </span>
  );
}
