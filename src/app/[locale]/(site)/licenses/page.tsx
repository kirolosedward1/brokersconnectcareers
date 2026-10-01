import { Fragment } from 'react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale, alternatesFor } from '@/i18n/routing';
import appNotices from '@/lib/licenses/app.json';
import webNotices from '@/lib/licenses/web.json';
import {
  byLicense,
  expressionParts,
  licenseAnchor,
  spdxUrl,
  uniqueTexts,
  type Notices,
} from '@/lib/licenses/notices';

/**
 * The open-source notices, for the website and for the app: every package
 * the website is built from, grouped by licence with its version and
 * copyright line; the font and the icons; the app's packages; then each
 * licence's text once.
 *
 * The lists are generated from what is installed (scripts/licenses.mjs) and
 * held to the lockfiles by `pnpm check`, so this page only lays them out — on
 * the server, with no script of its own. Names and licence texts are shown as
 * they are written, left to right.
 *
 * The app's several hundred packages are names and versions only, a line per
 * licence behind a <details>: the app carries their copyright lines on its
 * own licences screen, and written out here in full they more than doubled
 * the page's markup — which the router then embeds a second copy of.
 */

const website: Notices = webNotices;
const app: Notices = appNotices;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'licenses' });
  return {
    title: t('title'),
    robots: { index: true, follow: true },
    alternates: alternatesFor('/licenses', locale),
  };
}

export default async function LicensesPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  const t = await getTranslations('licenses');
  const texts = uniqueTexts(website.licenses, app.licenses);
  const anchored = new Set(texts.map((entry) => entry.id));

  return (
    <div className="mx-auto max-w-3xl px-4 py-14">
      <header className="mb-10 border-b border-border pb-6">
        <h1 className="text-3xl font-bold text-balance sm:text-4xl">{t('title')}</h1>
        <p className="mt-3 leading-relaxed text-muted-foreground">{t('intro')}</p>
      </header>

      <section aria-labelledby="website" className="space-y-8">
        <h2 id="website" className="text-2xl font-bold">
          {t('website')}{' '}
          <span className="text-base font-normal text-muted-foreground">
            {t('packages', { count: website.packages.length })}
          </span>
        </h2>
        {byLicense(website.packages).map((group) => (
          <div key={group.license} className="space-y-3">
            <h3 className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-lg font-semibold">
              <Expression expression={group.license} anchored={anchored} />
              <span className="text-sm font-normal text-muted-foreground">
                {t('packages', { count: group.packages.length })}
              </span>
            </h3>
            <ul dir="ltr" className="divide-y divide-border rounded-xl border border-border">
              {group.packages.map((notice) => (
                <li key={`${notice.name}@${notice.version}`} className="px-4 py-3">
                  <p className="text-sm">
                    <span className="font-medium">{notice.name}</span>{' '}
                    <span className="text-muted-foreground">{notice.version}</span>
                  </p>
                  {notice.copyright ? (
                    <p className="mt-1 whitespace-pre-line break-words text-xs leading-relaxed text-muted-foreground">
                      {notice.copyright}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section aria-labelledby="assets" className="mt-14 space-y-4">
        <h2 id="assets" className="text-2xl font-bold">
          {t('assets')}
        </h2>
        <p className="leading-relaxed text-muted-foreground">{t('assetsBody')}</p>
        <ul dir="ltr" className="divide-y divide-border rounded-xl border border-border">
          {[...website.assets, ...app.assets].map((asset) => (
            <li key={`${asset.name} ${asset.source}`} className="px-4 py-3">
              <p className="text-sm">
                <span className="font-medium">{asset.name}</span>{' '}
                <span className="text-muted-foreground">{asset.source}</span>
              </p>
              <p className="mt-1 text-xs">
                <Expression expression={asset.license} anchored={anchored} />
              </p>
              {asset.copyright ? (
                <p className="mt-1 whitespace-pre-line break-words text-xs leading-relaxed text-muted-foreground">
                  {asset.copyright}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="app" className="mt-14 space-y-4">
        <h2 id="app" className="text-2xl font-bold">
          {t('app')}{' '}
          <span className="text-base font-normal text-muted-foreground">
            {t('packages', { count: app.packages.length })}
          </span>
        </h2>
        <p className="leading-relaxed text-muted-foreground">{t('appBody')}</p>
        <details>
          <summary className="cursor-pointer font-medium text-primary">{t('showApp')}</summary>
          <div className="mt-6 space-y-6">
            {byLicense(app.packages).map((group) => (
              <div key={group.license} className="space-y-2">
                <h3 className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-semibold">
                  <Expression expression={group.license} anchored={anchored} />
                  <span className="text-sm font-normal text-muted-foreground">
                    {t('packages', { count: group.packages.length })}
                  </span>
                </h3>
                <p dir="ltr" className="break-words text-sm leading-relaxed text-muted-foreground">
                  {group.packages.map((notice) => `${notice.name} ${notice.version}`).join(', ')}
                </p>
              </div>
            ))}
          </div>
        </details>
      </section>

      <section aria-labelledby="texts" className="mt-14 space-y-8">
        <div className="space-y-3">
          <h2 id="texts" className="text-2xl font-bold">
            {t('texts')}
          </h2>
          <p className="leading-relaxed text-muted-foreground">{t('textsBody')}</p>
        </div>
        {texts.map((entry) => (
          <div key={entry.id} id={licenseAnchor(entry.id)} className="scroll-mt-20 space-y-2">
            <h3 className="text-lg font-semibold">
              <bdi dir="ltr">{entry.id}</bdi>
            </h3>
            {entry.text ? (
              <>
                <p className="text-sm text-muted-foreground">
                  {t.rich('textFrom', {
                    source: entry.source,
                    v: (chunks) => <bdi dir="ltr">{chunks}</bdi>,
                  })}
                </p>
                <pre
                  dir="ltr"
                  className="whitespace-pre-wrap break-words rounded-xl border border-border bg-muted p-4 font-mono text-xs leading-relaxed"
                >
                  {entry.text}
                </pre>
              </>
            ) : (
              <p className="text-sm">
                {t.rich('noText', {
                  link: (chunks) => (
                    <a
                      href={spdxUrl(entry.id)}
                      rel="noopener noreferrer"
                      className="font-medium text-primary underline underline-offset-4"
                    >
                      {chunks}
                    </a>
                  ),
                })}
              </p>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}

/** A licence expression, each licence in it linked to its text further down. */
function Expression({ expression, anchored }: { expression: string; anchored: Set<string> }) {
  return (
    <bdi dir="ltr">
      {expressionParts(expression).map((part, index) =>
        part.license && anchored.has(part.text) ? (
          <a key={index} href={`#${licenseAnchor(part.text)}`} className="underline-offset-4 hover:underline">
            {part.text}
          </a>
        ) : (
          <Fragment key={index}>{part.text}</Fragment>
        ),
      )}
    </bdi>
  );
}
