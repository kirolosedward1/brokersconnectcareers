import { StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import * as WebBrowser from 'expo-web-browser';
import { useTranslations } from 'use-intl';
import notices from '@/lib/licenses/app.json';
import { spdxUrl, type AssetNotice, type LicenseText, type Notices, type PackageNotice } from '@/lib/licenses/notices';
import { SettingsGroup, SettingsRow } from '~/components/ui/settings-list';
import { FileText, Lock } from '~/components/ui/lucide';
import { Text, textAlignStart } from '~/components/ui/text';
import { withAppMarker } from '~/lib/app-marker';
import { env } from '~/lib/env';
import { markupTags } from '~/i18n/rich';
import { useTheme } from '~/theme/provider';
import { corner, gutter, space, type Scheme } from '~/theme/tokens';

/**
 * The open-source notices the app owes: every package it is built from, in
 * name order, with its version, licence and copyright line; the font and the
 * icons; then each licence's text once. The website's /licenses page has the
 * same for both, grouped by licence.
 *
 * The list is src/lib/licenses/app.json, generated from what is installed by
 * scripts/licenses.mjs and held to the lockfile by `pnpm check` — so nothing
 * here is fetched, and the screen works signed out and offline.
 */

const app: Notices = notices;

type Row =
  | { kind: 'heading'; key: string; title: string }
  | { kind: 'asset'; key: string; asset: AssetNotice }
  | { kind: 'package'; key: string; notice: PackageNotice }
  | { kind: 'text'; key: string; license: LicenseText };

/**
 * The lightest grey licence copy may be. A lighter one is brought down to
 * this; a darker one stays. Dark mode keeps its own light ink, which a dark
 * page can read.
 */
const LICENCE_INK = '#5B6475';

/** Grey for licence copy: never lighter than LICENCE_INK while the page is light. */
export function licenceInk(scheme: Scheme, color: string) {
  if (scheme !== 'light') return color;
  return luminance(color) > luminance(LICENCE_INK) ? LICENCE_INK : color;
}

function luminance(hex: string) {
  const n = Number.parseInt(hex.slice(1), 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((channel) => {
    const s = channel / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/**
 * Names, versions and licence texts are written left to right, and sit on the
 * right while the app is Arabic — including when the phone has not mirrored
 * the layout. textAlignStart returns `left` only when the phone will swap it
 * once; `right` then would put the name back on the left.
 */
function ltr() {
  return { writingDirection: 'ltr' as const, textAlign: textAlignStart() };
}

export default function LicensesScreen() {
  const t = useTranslations();
  const { colors, scheme } = useTheme();

  const rows: Row[] = [
    { kind: 'heading', key: 'assets', title: t('licenses.assets') },
    ...app.assets.map((asset): Row => ({ kind: 'asset', key: `asset ${asset.name}`, asset })),
    { kind: 'heading', key: 'packages', title: t('licenses.packages', { count: app.packages.length }) },
    ...app.packages.map((notice): Row => ({ kind: 'package', key: `${notice.name}@${notice.version}`, notice })),
    { kind: 'heading', key: 'texts', title: t('licenses.texts') },
    ...app.licenses.map((license): Row => ({ kind: 'text', key: `text ${license.id}`, license })),
  ];

  return (
    <>
      <Stack.Screen options={{ title: t('licenses.title') }} />
      <FlashList
        data={rows}
        keyExtractor={(row) => row.key}
        getItemType={(row) => row.kind}
        renderItem={({ item }) => <LicenseRow row={item} />}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: gutter, paddingBottom: space[10] }}
        ListHeaderComponent={
          <View style={{ gap: space[4] }}>
            {/* The policies first: Account has one row for this page and them (owner's call, 31 Oct). */}
            <SettingsGroup>
              <SettingsRow
                icon={<Lock size={18} color={colors.primary} />}
                label={t('footer.privacy')}
                onPress={() => openSitePage('/privacy')}
              />
              <SettingsRow
                icon={<FileText size={18} color={colors.primary} />}
                label={t('footer.terms')}
                onPress={() => openSitePage('/terms')}
              />
            </SettingsGroup>
            <Text variant="small" tone="mutedForeground" style={{ color: licenceInk(scheme, colors.mutedForeground) }}>
              {t('app.licenses.intro')}
            </Text>
          </View>
        }
      />
    </>
  );
}

function LicenseRow({ row }: { row: Row }) {
  switch (row.kind) {
    case 'heading':
      return (
        <Text variant="title" weight="semibold" accessibilityRole="header" style={{ marginTop: space[6], marginBottom: space[2] }}>
          {row.title}
        </Text>
      );
    case 'asset':
      return (
        <Entry
          name={row.asset.name}
          details={[row.asset.license, row.asset.source]}
          copyright={row.asset.copyright}
        />
      );
    case 'package':
      return (
        <Entry
          name={row.notice.name}
          details={[row.notice.version, row.notice.license]}
          copyright={row.notice.copyright}
        />
      );
    case 'text':
      return <FullText license={row.license} />;
  }
}

/**
 * A package or a notice: its name, then its version or source and its
 * licence, then whose it is. Read to VoiceOver as one line, so the list is a
 * swipe per package rather than three.
 */
function Entry({ name, details, copyright }: { name: string; details: string[]; copyright: string }) {
  const { colors, scheme } = useTheme();
  const grey = licenceInk(scheme, colors.mutedForeground);
  return (
    <View
      accessible
      accessibilityLabel={[name, ...details, copyright].filter(Boolean).join(', ')}
      style={{
        paddingVertical: space[3],
        gap: 2,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.border,
      }}
    >
      <Text weight="medium" style={ltr()}>
        {name}
      </Text>
      <Text variant="small" tone="mutedForeground" style={[ltr(), { color: grey }]}>
        {details.join(' · ')}
      </Text>
      {copyright ? (
        <Text variant="caption" tone="mutedForeground" style={[ltr(), { color: grey }]}>
          {copyright}
        </Text>
      ) : null}
    </View>
  );
}

/** One licence's text, as the package it was read from ships it — or, when none does, the way to SPDX's. */
function FullText({ license }: { license: LicenseText }) {
  const t = useTranslations('licenses');
  const { colors, scheme } = useTheme();
  const grey = licenceInk(scheme, colors.mutedForeground);
  return (
    <View style={{ gap: space[2], paddingVertical: space[3] }}>
      <Text weight="semibold" accessibilityRole="header" style={ltr()}>
        {license.id}
      </Text>
      {license.text ? (
        <>
          <Text variant="caption" tone="mutedForeground" style={{ color: grey }}>
            {t.markup('textFrom', { source: license.source, ...markupTags })}
          </Text>
          <View style={{ padding: space[3], ...corner('lg'), backgroundColor: colors.muted }}>
            <Text variant="caption" selectable style={[ltr(), { color: licenceInk(scheme, colors.foreground) }]}>
              {license.text}
            </Text>
          </View>
        </>
      ) : (
        <Text
          variant="small"
          tone="primary"
          accessibilityRole="link"
          onPress={() => WebBrowser.openBrowserAsync(spdxUrl(license.id)).catch(() => {})}
        >
          {t.markup('noText', { link: (chunks) => chunks })}
        </Text>
      )}
    </View>
  );
}

/** A page of the website, in the in-app browser: the policies live there, in one copy. */
function openSitePage(path: '/privacy' | '/terms') {
  WebBrowser.openBrowserAsync(withAppMarker(`${env.siteUrl}${path}`)).catch(() => {});
}
