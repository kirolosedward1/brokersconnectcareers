import { getTranslations } from 'next-intl/server';
import { StoreBadgeLink } from '@/components/get-app/store-marks';
import { APP_SMART_LINK_PATH, resolvedStoreUrls } from '@/lib/app-links';
import { qrSvg } from '@/lib/app-qr';
import { env } from '@/lib/env';

/**
 * The app card on the job results.
 *
 * Flat tint of the brand blue, no shadow. While neither listing is set
 * it says the app is coming soon and draws no badge. When a listing is
 * set, that store's black badge is drawn. The desktop card (`rail`)
 * adds one QR of the smart link once at least one listing is set; the
 * inline card, below 1024px, never does.
 *
 * A signed-in reader who has registered the app does not see this. The
 * app's in-app browser sets no user-agent of its own, so a page opened
 * there cannot be told apart from the system browser.
 */
export async function AppPromo({ variant }: { variant: 'rail' | 'inline' }) {
  const t = await getTranslations('jobs.appPromo');
  const stores = await getTranslations('appPage.store');
  const { appStore, play } = resolvedStoreUrls();
  const listed = Boolean(appStore || play);
  const qr = variant === 'rail' && listed ? await qrSvg(`${env.siteUrl}${APP_SMART_LINK_PATH}`) : null;

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
        <p className="mt-4 text-sm font-medium">{t('comingSoon')}</p>
      )}

      {qr ? (
        <figure className="mt-4 flex flex-col items-center gap-2">
          <div className="rounded-[12px] border border-[#e4e4e7] bg-white p-2" aria-hidden>
            <div
              className="size-[120px] [&_svg]:block [&_svg]:size-[120px]"
              dangerouslySetInnerHTML={{ __html: qr }}
            />
          </div>
          <figcaption className="text-xs leading-snug">{t('qrCaption')}</figcaption>
        </figure>
      ) : null}
    </div>
  );
}
