import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
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
 *
 * The document carries its own language and direction: the English text is
 * served inside the Arabic site while English is off (`?lang=en`), and a
 * screen reader reading it with Arabic rules, or a paragraph set right to
 * left, would make it unreadable to the people it is there for. Its heading
 * and date follow it, and so does the link to the other language, which is
 * written in the language it leads to.
 */
export async function LegalDocument({
  doc,
  locale,
  other,
}: {
  doc: LegalDoc | null;
  locale: Locale;
  /** The same document in the other language, when there is one. */
  other?: { href: { pathname: string; query?: Record<string, string> }; lang: Locale; label: string } | null;
}) {
  const t = await getTranslations({ locale: doc?.lang ?? locale, namespace: 'legal' });

  if (!doc) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-24 text-center">
        <h1 className="text-2xl font-bold">{t('missing')}</h1>
        <p className="mt-3 text-muted-foreground">{t('missingBody')}</p>
      </div>
    );
  }

  return (
    <article lang={doc.lang} dir={doc.lang === 'ar' ? 'rtl' : 'ltr'} className="mx-auto max-w-3xl px-4 py-14">
      <header className="mb-10 border-b border-border pb-6">
        <h1 className="text-3xl font-bold text-balance sm:text-4xl">{doc.title}</h1>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-sm text-muted-foreground">
          {doc.updated ? (
            <p>
              {t('lastUpdated')}{' '}
              <time dateTime={isoDate(doc.updated)}>{formatDate(doc.updated, doc.lang)}</time>
            </p>
          ) : null}
          {other ? (
            <Link
              href={other.href}
              lang={other.lang}
              hrefLang={other.lang}
              className="inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline"
            >
              {other.label}
            </Link>
          ) : null}
        </div>
      </header>

      {/* The markdown comes from files in this repository, not from users. */}
      <div className="prose" dangerouslySetInnerHTML={{ __html: doc.html }} />
    </article>
  );
}
