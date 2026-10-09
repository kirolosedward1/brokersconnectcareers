import type { ReactElement } from 'react';
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import { Link, type Href } from 'expo-router';

/**
 * Whether iOS can open a page out of what was tapped (its zoom transition,
 * iOS 18 and later): the phone runs the new architecture with expo-router's
 * own native part in it. Asked once. Anywhere else — an older iPhone, a
 * build without that part, the tests — the page slides in as every page does.
 */
const zoomable =
  Platform.OS === 'ios' &&
  Number.parseInt(String(Platform.Version), 10) >= 18 &&
  (globalThis as { RN$Bridgeless?: boolean }).RN$Bridgeless === true &&
  requireOptionalNativeModule('ExpoRouterNativeLinkPreview') != null;

/**
 * A card that opens its page by growing into it — the listing comes out of
 * the card that was tapped, and goes back into it — where iOS can. The card
 * is given the press itself (it must not navigate on its own as well); where
 * the zoom is not available, `fallback` (the card with its own press) is drawn.
 */
export function ZoomLink({ href, card, fallback }: { href: Href; card: ReactElement; fallback: ReactElement }) {
  if (!zoomable) return fallback;
  return (
    <Link href={href} push asChild>
      <Link.AppleZoom>{card}</Link.AppleZoom>
    </Link>
  );
}
