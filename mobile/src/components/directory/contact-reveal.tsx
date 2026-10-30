import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocale, useTranslations } from 'use-intl';
import { formatDateTime } from '@/lib/format';
import { localized } from '@/lib/locale';
import { ContactButtons } from '~/components/ui/contact-buttons';
import { Download, Eye } from '~/components/ui/lucide';
import { Button } from '~/components/ui/button';
import { useSheetFence } from '~/components/ui/sheet-fence';
import { Text } from '~/components/ui/text';
import { openAgentCv, RevealRefused, useRevealContact, type RevealedContact } from '~/features/directory/queries';
import { useCompanyRevealed } from '~/features/directory/reveals';
import { track } from '~/lib/analytics';
import { ApiError } from '~/lib/api';
import { appDirection } from '~/lib/direction';
import { useSession } from '~/lib/session';
import { useSheet } from '~/lib/use-sheet';
import { useTheme } from '~/theme/provider';
import { corner, gutter, space } from '~/theme/tokens';
import { useAnnounce } from '~/lib/use-announce';

/**
 * The button that asks for a number — the website's ContactReveal. Nothing of
 * the consultant's contact is on the page until it is asked for, and asking
 * is said first (the RevealConfirm board): whose contact, that it is recorded
 * under the person and their company, and that opening it again today is not
 * a second reveal. The press is one recorded reveal, and the answer is
 * WhatsApp with the company's opener already written and a call (rule 8), the
 * number itself, and the CV when there is one. A refusal says which kind it
 * was — not open to this company, or enough opened for now — without naming a
 * threshold.
 */
export function ContactReveal({ handle, hasCv, name, detail }: { handle: string; hasCv: boolean; name: string; detail?: string | null }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const reveal = useRevealContact();
  const sheet = useSheet();
  // Read when the confirmation opens, not for every card on a list.
  const before = useCompanyRevealed(handle, sheet.mounted).data ?? null;
  const [revealed, setRevealed] = useState<RevealedContact | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useAnnounce(message);

  const ask = () => {
    setMessage(null);
    reveal.mutate(
      { handle, locale: locale === 'en' ? 'en' : 'ar' },
      {
        onSuccess: (contact) => {
          // The start of reveal → WhatsApp tap.
          track('agent_contact_revealed', {});
          sheet.hide(() => setRevealed(contact));
        },
        onError: (failure) => {
          sheet.hide();
          if (failure instanceof ApiError && failure.status === 0) return setMessage(t('app.offline.body'));
          if (failure instanceof RevealRefused && failure.reason === 'rate_limit') {
            const minutes = Math.max(1, Math.ceil((failure.retryAfterSeconds ?? 3600) / 60));
            return setMessage(t('agents.revealRateLimited', { minutes }));
          }
          if (failure instanceof RevealRefused && failure.reason === 'locked') return setMessage(t('agents.revealLocked'));
          if (failure instanceof RevealRefused && failure.reason === 'not_permitted') return setMessage(t('app.team.notPermittedReveal'));
          setMessage(t('common.errorBody'));
        },
      },
    );
  };

  if (revealed) {
    return (
      <View style={{ gap: space[2] }}>
        <ContactButtons
          name={revealed.fullName || name}
          whatsappUrl={revealed.whatsappUrl}
          phone={revealed.phone}
          onPress={(method) => track('agent_contact_clicked', { method })}
        />
        {/* The number as written, left to right, and copyable. */}
        <Text selectable tone="mutedForeground" style={{ writingDirection: 'ltr', alignSelf: 'flex-start' }}>
          {revealed.phone}
        </Text>
        {hasCv && revealed.hasCv ? <CvButton handle={handle} /> : null}
      </View>
    );
  }

  return (
    <View style={{ gap: space[2] }}>
      <Button
        label={t('agents.revealContact')}
        size="lg"
        loading={reveal.isPending}
        icon={<Eye size={18} color={colors.primaryForeground} />}
        onPress={sheet.show}
      />
      {message ? (
        <Text variant="small" tone="mutedForeground" accessibilityLiveRegion="polite">
          {message}
        </Text>
      ) : null}
      {sheet.mounted ? (
        <RevealConfirm
          visible={sheet.open}
          onClose={() => sheet.hide()}
          onDismiss={sheet.onDismiss}
          name={name}
          detail={detail ?? null}
          busy={reveal.isPending}
          onConfirm={ask}
          revealedBefore={before}
        />
      ) : null}
    </View>
  );
}

/**
 * Before a number is asked for (the RevealConfirm board): whose, what it
 * brings, and under whom it is recorded. The board's monthly balance and
 * "previous reveal" are not drawn: reveals are limited by the hour and the
 * day, not counted against a balance, and a company cannot read the ledger.
 */
export function RevealConfirm({
  visible,
  onClose,
  onDismiss,
  name,
  detail,
  busy,
  onConfirm,
  revealedBefore = null,
}: {
  visible: boolean;
  onClose: () => void;
  onDismiss?: () => void;
  name: string;
  detail: string | null;
  busy: boolean;
  onConfirm: () => void;
  /** When the viewer's company last revealed this number (migration 381): «كشف سابق». */
  revealedBefore?: string | null;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const fence = useSheetFence();
  const { colors, shadow } = useTheme();
  const insets = useSafeAreaInsets();
  const { viewer } = useSession();
  const recordedAs = [
    viewer?.profile?.full_name,
    viewer?.company ? localized(locale, viewer.company.name_ar, viewer.company.name_en) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} onDismiss={onDismiss}>
      <View style={{ flex: 1, direction: appDirection, justifyContent: 'flex-end', backgroundColor: colors.scrim }} {...fence}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onClose} style={StyleSheet.absoluteFill} />
        <View
          testID="reveal-confirm"
          style={{
            margin: space[3],
            marginBottom: Math.max(insets.bottom, space[3]),
            padding: gutter,
            gap: space[4],
            ...corner('xxl'),
            backgroundColor: colors.card,
            boxShadow: shadow.raised,
          }}
        >
          <View style={{ gap: space[1] }}>
            <Text variant="headline" weight="bold" accessibilityRole="header">
              {t('app.reveal.title', { name })}
            </Text>
            {detail ? (
              <Text variant="small" tone="mutedForeground">
                {detail}
              </Text>
            ) : null}
          </View>
          <Text variant="small">{t('app.reveal.body')}</Text>
          {revealedBefore ? (
            <Text variant="small" weight="medium" testID="revealed-before">
              {t('app.reveal.before', { date: formatDateTime(revealedBefore, locale) })}
            </Text>
          ) : null}
          {recordedAs ? (
            <View
              accessible
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                gap: space[2],
                paddingVertical: space[3],
                borderTopWidth: StyleSheet.hairlineWidth * 2,
                borderBottomWidth: StyleSheet.hairlineWidth * 2,
                borderColor: colors.border,
              }}
            >
              <Text variant="small" tone="mutedForeground">
                {t('app.reveal.recordedAs')}
              </Text>
              <Text variant="small" weight="semibold">
                {recordedAs}
              </Text>
            </View>
          ) : null}
          <Text variant="caption" tone="mutedForeground">
            {`${t('app.reveal.ledger')} ${t('app.reveal.again')}`}
          </Text>
          <View style={{ gap: space[2] }}>
            <Button
              label={t('app.reveal.confirm')}
              size="lg"
              loading={busy}
              icon={<Eye size={18} color={colors.primaryForeground} />}
              onPress={onConfirm}
            />
            <Button label={t('common.cancel')} variant="ghost" onPress={onClose} disabled={busy} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

/**
 * The CV, through the website's /api/agent-cv: for a company once the contact
 * is revealed (opening it again the same day is not a second reveal), and for
 * the consultant's own copy.
 */
export function CvButton({ handle }: { handle: string }) {
  const t = useTranslations();
  const { colors } = useTheme();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A promise chain, not try/finally, which the React Compiler does not compile.
  const open = () => {
    setError(null);
    setOpening(true);
    openAgentCv(handle)
      .catch((failure: unknown) => {
        const status = failure instanceof ApiError ? failure.status : -1;
        setError(status === 429 ? t('app.applicants.cvLimit') : status === 0 ? t('app.offline.body') : t('common.errorBody'));
      })
      .then(() => setOpening(false));
  };

  return (
    <View style={{ gap: space[1], alignItems: 'flex-start' }}>
      <Button
        label={t('agents.downloadCv')}
        variant="outline"
        size="lg"
        loading={opening}
        icon={<Download size={18} color={colors.foreground} />}
        onPress={open}
      />
      {error ? (
        <Text variant="small" tone="destructive" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
