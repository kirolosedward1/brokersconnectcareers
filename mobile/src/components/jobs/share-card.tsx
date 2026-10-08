import { useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { useLocale, useTranslations } from 'use-intl';
import { localized } from '@/lib/locale';
import type { JobDetailResponse } from '@/lib/mobile-api/reads';
import { LOGO_MARK, Wordmark } from '~/components/brand/brand-logo';
import { Button } from '~/components/ui/button';
import { BadgeCheck, MapPin, Share2, Target, X } from '~/components/ui/lucide';
import { Text } from '~/components/ui/text';
import { useCompensationText } from '~/features/jobs/compensation';
import { env } from '~/lib/env';
import { haptic } from '~/lib/haptics';
import { useTheme } from '~/theme/provider';
import { corner, gutter, hitTarget, space } from '~/theme/tokens';

/** The card's own size, in points, a story's shape; captured at a story's own 1080 × 1920. */
export const CARD = { width: 324, height: 576 } as const;
const CAPTURE = { width: 1080, height: 1920 } as const;

type ShareableJob = JobDetailResponse['job'];

/**
 * A listing as a picture for a WhatsApp status or an Instagram story: the
 * brand's sapphire, its logo, the role and who is hiring, what it pays in the
 * website's own words, and where to find it — the site's address, not a link
 * a picture cannot carry. Drawn at a story's shape; shared from the sheet that
 * shows it first, so what is sent is what was seen.
 */
export function JobShareCard({ job }: { job: ShareableJob }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const pay = useCompensationText();
  const salary = pay.salary(job, locale);
  const commission = job.commission_type === 'percentage' && job.commission_value != null ? pay.commission(job, locale) : null;
  const host = env.siteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');

  return (
    <View
      style={{
        width: CARD.width,
        height: CARD.height,
        padding: space[6],
        justifyContent: 'space-between',
        backgroundColor: colors.heroDeep,
        experimental_backgroundImage: `linear-gradient(160deg, ${colors.hero} 0%, ${colors.heroDeep} 100%)`,
        overflow: 'hidden',
      }}
    >
      {/* The Home panel's sightlines, in champagne, behind the words. */}
      <Svg width={CARD.width} height={CARD.height} style={StyleSheet.absoluteFill} pointerEvents="none">
        {[150, 210, 270].map((r, index) => (
          <Circle key={r} cx={CARD.width} cy={0} r={r} stroke={colors.champagne} strokeOpacity={[0.35, 0.22, 0.12][index]} fill="none" />
        ))}
      </Svg>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
        <View style={{ width: 40, height: 40, ...corner('md'), backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }}>
          <Image source={LOGO_MARK} contentFit="contain" style={{ width: 28, height: 28 }} accessible={false} />
        </View>
        {locale === 'ar' ? (
          <Wordmark height={20} tint={colors.onHero} />
        ) : (
          <Text weight="bold" style={{ color: colors.onHero }}>
            {t('meta.siteName')}
          </Text>
        )}
      </View>

      <View style={{ gap: space[4] }}>
        <Text variant="small" weight="semibold" style={{ color: colors.champagne }}>
          {t('app.share.hiring')}
        </Text>
        <Text variant="display" weight="bold" numberOfLines={3} style={{ color: colors.onHero }}>
          {localized(locale, job.title_ar, job.title_en)}
        </Text>
        <View style={{ gap: space[2] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[1] }}>
            <Text weight="semibold" numberOfLines={1} style={{ color: colors.onHero, flexShrink: 1 }}>
              {localized(locale, job.company.name_ar, job.company.name_en)}
            </Text>
            {job.company.verification_status === 'verified' ? <BadgeCheck size={16} color={colors.champagne} /> : null}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[1] }}>
            <MapPin size={14} color={colors.onHeroMuted} />
            <Text variant="small" style={{ color: colors.onHeroMuted }}>
              {`${localized(locale, job.district.name_ar, job.district.name_en)} · ${t(`track.${job.track}` as never)}`}
            </Text>
          </View>
        </View>

        <View
          style={{
            gap: space[1],
            padding: space[4],
            ...corner('xl'),
            borderWidth: StyleSheet.hairlineWidth * 2,
            borderColor: 'rgba(255, 255, 255, 0.3)',
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
          }}
        >
          <Text variant="title" weight="bold" style={{ color: colors.onHero }}>
            {salary.amount}
            {salary.perMonth ? <Text variant="small" style={{ color: colors.onHeroMuted }}>{` ${salary.perMonth}`}</Text> : null}
          </Text>
          {commission ? (
            <Text variant="small" weight="medium" style={{ color: colors.onHero }}>
              {commission}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Target size={13} color={colors.champagne} />
            <Text variant="small" style={{ color: colors.onHeroMuted }}>
              {t(`leadsSource.${job.leads_source}_short` as never)}
            </Text>
          </View>
        </View>
      </View>

      <View style={{ gap: space[1] }}>
        <Text weight="semibold" style={{ color: colors.onHero }}>
          {t('app.share.applyOn')}
        </Text>
        <Text variant="small" style={{ color: colors.champagne, writingDirection: 'ltr' }}>
          {host}
        </Text>
      </View>
    </View>
  );
}

/**
 * The card on a sheet, as it will be sent, with one button that hands the
 * picture to the share sheet (WhatsApp, Instagram, the photo library…).
 */
export function ShareCardSheet({ job, visible, onClose }: { job: ShareableJob; visible: boolean; onClose: () => void }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const card = useRef<View>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const send = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const uri = await captureRef(card, { format: 'png', quality: 1, width: CAPTURE.width, height: CAPTURE.height, result: 'tmpfile' });
      haptic.tap();
      await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: t('app.share.asImage') });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={styles.header}>
          <Text weight="semibold" accessibilityRole="header" style={{ flexShrink: 1 }}>
            {t('app.share.asImage')}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
            onPress={onClose}
            hitSlop={8}
            style={{ minWidth: hitTarget, minHeight: hitTarget, alignItems: 'center', justifyContent: 'center' }}
          >
            <X size={22} color={colors.foreground} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ alignItems: 'center', padding: gutter, gap: space[4] }}>
          {/* What is sent, at the size it is drawn; the phone narrower than it scales it down. */}
          <View
            ref={card}
            collapsable={false}
            accessible
            accessibilityRole="image"
            accessibilityLabel={localized(locale, job.title_ar, job.title_en)}
            style={{ ...corner('xl'), overflow: 'hidden' }}
          >
            <JobShareCard job={job} />
          </View>
          {failed ? (
            <Text variant="small" tone="destructive" accessibilityRole="alert">
              {t('common.errorBody')}
            </Text>
          ) : null}
        </ScrollView>
        <View style={{ paddingHorizontal: gutter, paddingTop: space[3], paddingBottom: Math.max(insets.bottom, space[4]) }}>
          <Button
            label={t('app.share.send')}
            size="lg"
            loading={busy}
            icon={<Share2 size={18} color={colors.primaryForeground} />}
            onPress={send}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: gutter,
    paddingVertical: space[2],
  },
});
