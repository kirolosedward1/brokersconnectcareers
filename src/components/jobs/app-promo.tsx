import { getTranslations } from 'next-intl/server';
import { PhoneFrame } from '@/components/get-app/phone-frame';
import { StoreBadgeLink } from '@/components/get-app/store-marks';
import { resolvedStoreUrls } from '@/lib/app-links';
import { cn } from '@/lib/utils';

/**
 * The app card on the job results.
 *
 * Flat tint of the brand blue, no shadow on the card itself. While neither
 * listing is set it says the app is coming soon and draws no badge. When a
 * listing is set, that store's black badge is drawn. A QR is not drawn: the
 * library that would make it is not a dependency of this site yet, and the
 * card stays free of it until a listing exists and that path is added back.
 * `/api/app/open` is already the address that QR would encode.
 *
 * Beside the words (under them, below `lg`) sits the jobs list as it actually
 * is on the iPhone: `public/app-screenshots/jobs.webp`, the simulator capture
 * the app page already frames. The rim, the Dynamic Island and the glass are
 * the shared phone drawing, tilted a little so the foot of the device is cut
 * by the card rather than lengthening it.
 *
 * Who sees it is decided in the browser. A signed-in reader with an
 * active push device, and a browser that arrived with `?app=1` (kept in
 * a session cookie), both get no card. The mobile app's own browser
 * sends no marker of its own.
 */

/** Jobs board, 1179×2562, from the iPhone simulator. Same file the app page uses. */
const JOBS_SHOT = '/app-screenshots/jobs.webp';

export async function AppPromo({ variant }: { variant: 'rail' | 'inline' }) {
  const t = await getTranslations('jobs.appPromo');
  const stores = await getTranslations('appPage.store');
  const { appStore, play } = resolvedStoreUrls();
  const listed = Boolean(appStore || play);
  const rail = variant === 'rail';

  return (
    <div
      data-app-promo={variant}
      className="relative overflow-hidden rounded-[16px] bg-brand-tint p-6 shadow-none"
    >
      <div className={cn('relative z-10', rail ? 'text-start' : 'text-center')}>
        <p className="text-[18px] font-bold leading-snug">{t('title')}</p>
        <div className={cn(rail && 'pe-[7.25rem]')}>
          <p className="mt-2 text-sm leading-relaxed">{t('body')}</p>

          {listed ? (
            <div
              className={cn(
                'mt-4 flex flex-wrap items-center gap-2',
                rail ? 'justify-start' : 'justify-center',
              )}
            >
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
      </div>

      <PromoPhone rail={rail} alt={t('screenshotAlt')} />
    </div>
  );
}

/**
 * The phone sits on the inline-end side of the rail and is cropped by the
 * card's bottom edge. Below `lg` the same drawing is centred under the words,
 * with only its top on screen, so the inline card does not grow by a full device.
 */
function PromoPhone({ rail, alt }: { rail: boolean; alt: string }) {
  const tilt = '-rotate-[4deg] rtl:rotate-[4deg]';

  if (rail) {
    return (
      <div className={cn('pointer-events-none absolute -bottom-[5.5rem] end-3 w-[6.75rem]', tilt)}>
        <PhoneFrame src={JOBS_SHOT} alt={alt} sizes="108px" />
      </div>
    );
  }

  return (
    <div className="pointer-events-none relative mx-auto mt-2 h-[7.25rem] w-[7.5rem]">
      <div className={cn('absolute inset-x-0 top-0', tilt)}>
        <PhoneFrame src={JOBS_SHOT} alt={alt} sizes="120px" />
      </div>
    </div>
  );
}
