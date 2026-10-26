import { getTranslations } from 'next-intl/server';
import { StoreBadgeLink } from '@/components/get-app/store-marks';
import { resolvedStoreUrls } from '@/lib/app-links';

/**
 * The app card on the job results.
 *
 * Flat tint of the brand blue, no shadow. While neither listing is set
 * it says the app is coming soon and draws no badge. When a listing is
 * set, that store's black badge is drawn. A QR is not drawn: the library
 * that would make it is not a dependency of this site yet, and the card
 * stays free of it until a listing exists and that path is added back.
 * `/api/app/open` is already the address that QR would encode.
 *
 * Who sees it is decided in the browser. A signed-in reader with an
 * active push device, and a browser that arrived with `?app=1` (kept in
 * a session cookie), both get no card. The mobile app's own browser
 * sends no marker of its own.
 */
export async function AppPromo({ variant }: { variant: 'rail' | 'inline' }) {
  const t = await getTranslations('jobs.appPromo');
  const stores = await getTranslations('appPage.store');
  const { appStore, play } = resolvedStoreUrls();
  const listed = Boolean(appStore || play);

  return (
    <div
      data-app-promo={variant}
      className="rounded-[16px] bg-brand-tint p-6 text-center shadow-none"
    >
      <p className="text-[18px] font-bold leading-snug">{t('title')}</p>
      <p className="mt-2 text-sm leading-relaxed">{t('body')}</p>

      {listed ? (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {appStore ? (
            <StoreBadgeLink
              store="apple"
              href={appStore}
              top={stores('appStoreTop')}
              name="App Store"
              label={stores('appStoreLabel')}
            />
          ) : null}
          {play ? (
            <StoreBadgeLink
              store="google"
              href={play}
              top={stores('googlePlayTop')}
              name="Google Play"
              label={stores('googlePlayLabel')}
            />
          ) : null}
        </div>
      ) : (
        <p className="mt-4 text-sm font-medium">
          {t.rich('comingSoon', {
            bdi: (chunks) => <bdi>{chunks}</bdi>,
          })}
        </p>
      )}
    </div>
  );
}
