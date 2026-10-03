import { I18nManager, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import * as WebBrowser from 'expo-web-browser';
import { useTranslations } from 'use-intl';
import notices from '@/lib/licenses/app.json';
import { spdxUrl, type AssetNotice, type LicenseText, type Notices, type PackageNotice } from '@/lib/licenses/notices';
import { Text } from '~/components/ui/text';
import { markupTags } from '~/i18n/rich';
import { useTheme } from '~/theme/provider';
import { corner, gutter, space } from '~/theme/tokens';

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
 * Names, versions and licence texts are written left to right, so they sit at
 * the left edge whatever the app's direction ('right' is mirrored to the left
 * when right-to-left is forced, as in the text field's left-to-right mode).
 */
function ltr() {
  return { writingDirection: 'ltr', textAlign: I18nManager.isRTL ? 'right' : 'left' } as const;
}

export default function LicensesScreen() {
  const t = useTranslations();

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
          <Text variant="small" tone="mutedForeground">
            {t('app.licenses.intro')}
          </Text>
        }
      />
    </>
  );
}

function LicenseRow({ row }: { row: Row }) {
  switch (row.kind) {
    case 'heading':
      return (
        <Text variant="title" weight="bold" accessibilityRole="header" style={{ marginTop: space[6], marginBottom: space[2] }}>
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
  const { colors } = useTheme();
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
      <Text variant="small" tone="mutedForeground" style={ltr()}>
        {details.join(' · ')}
      </Text>
      {copyright ? (
        <Text variant="caption" tone="mutedForeground" style={ltr()}>
          {copyright}
        </Text>
      ) : null}
    </View>
  );
}

/** One licence's text, as the package it was read from ships it — or, when none does, the way to SPDX's. */
function FullText({ license }: { license: LicenseText }) {
  const t = useTranslations('licenses');
  const { colors } = useTheme();
  return (
    <View style={{ gap: space[2], paddingVertical: space[3] }}>
      <Text weight="semibold" accessibilityRole="header" style={ltr()}>
        {license.id}
      </Text>
      {license.text ? (
        <>
          <Text variant="caption" tone="mutedForeground">
            {t.markup('textFrom', { source: license.source, ...markupTags })}
          </Text>
          <View style={{ padding: space[3], ...corner('lg'), backgroundColor: colors.muted }}>
            <Text variant="caption" selectable style={ltr()}>
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
