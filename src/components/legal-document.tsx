import { getTranslations } from 'next-intl/server';
import { formatDate, isoDate } from '@/lib/utils';
import type { Locale } from '@/i18n/routing';
import type { LegalDoc } from '@/lib/legal';

/**
 * A legal document, rendered from markdown through the same prose styles the
 * blog uses.
 *
 * A missing file renders the "not written yet" state rather than throwing.
 * These pages are linked from the footer of every page on the site, and a
 * document that fails to load should not take the footer's destination down
 * with it.
 */
export async function LegalDocument({
  doc,
  locale,
}: {
  doc: LegalDoc | null;
  locale: Locale;
}) {
  const t = await getTranslations('legal');

  if (!doc) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-24 text-center">
        <h1 className="text-2xl font-bold">{t('missing')}</h1>
        <p className="mt-3 text-muted-foreground">{t('missingBody')}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-14">
      <header className="mb-10 border-b border-border pb-6">
        <h1 className="text-3xl font-bold text-balance sm:text-4xl">{doc.title}</h1>
        {doc.updated ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {t('lastUpdated')}{' '}
            <time dateTime={isoDate(doc.updated)} className="numeral">
              {formatDate(doc.updated, locale)}
            </time>
          </p>
        ) : null}
      </header>

      {/* The markdown comes from files in this repository, not from users. */}
      <div className="prose" dangerouslySetInnerHTML={{ __html: doc.html }} />
    </div>
  );
}
