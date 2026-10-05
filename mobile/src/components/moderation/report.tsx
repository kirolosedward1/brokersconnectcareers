import { useState } from 'react';
import { Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';
import { EyeOff, Flag, ShieldCheck, X } from '~/components/ui/lucide';
import type { ReportInput } from '@/lib/mobile-api/contract';
import type { ReportReason } from '@/lib/supabase/database.types';
import { AGENT_REPORT_REASONS, COMPANY_REPORT_REASONS, REPORT_REASONS } from '@/lib/taxonomy';
import { Button } from '~/components/ui/button';
import { KeyboardRoom } from '~/components/ui/keyboard-room';
import { Notice } from '~/components/ui/notice';
import { Text } from '~/components/ui/text';
import { callAction } from '~/lib/api';
import { appDirection } from '~/lib/direction';
import { useSession } from '~/lib/session';
import { useTheme } from '~/theme/provider';
import { corner, font, gutter, hitTarget, space, type as scale } from '~/theme/tokens';

type Target = ReportInput['target'];

const REASONS_FOR: Record<Target, readonly ReportReason[]> = {
  job: REPORT_REASONS,
  company: COMPANY_REPORT_REASONS,
  agent: AGENT_REPORT_REASONS,
};

/** The refusals reportTarget names, each with the website's own sentence. */
const REFUSAL_COPY: Record<string, string> = {
  already_reported: 'alreadyReported',
  rate_limit: 'rateLimit',
  burst_limit: 'burstLimit',
  new_account_limit: 'newAccountLimit',
  company_limit: 'companyLimit',
  restricted: 'restricted',
  own_target: 'ownTarget',
};

/**
 * Report a listing, a company or a consultant's profile — the website's one
 * dialog (src/components/jobs/report-job-dialog.tsx) through its one action
 * (reportTarget), with its rules.
 *
 * An account is needed, so a signed-out reader is sent to sign in and brought
 * back here. Quick on purpose: one tap on what is wrong, each reason saying in
 * a few words what it covers, and a line more only if the reader wants to add
 * one. None is chosen for them — a pre-selected answer is the answer a hurried
 * reader sends. The database's limits (one per person per target, a few in a
 * few minutes, fewer on a new account) each come back as their own sentence,
 * because "you already told us", "wait a few minutes" and "try tomorrow" ask
 * for different things. What is sent lands in the moderation console,
 * read by a person, and the reporter is told when it has been looked at.
 */
export function ReportButton({
  target,
  targetId,
  returnPath,
  label,
}: {
  target: Target;
  targetId: string;
  /** Where signing in brings a signed-out reader back to. */
  returnPath: string;
  /** The button's words, which differ per target. */
  label: string;
}) {
  const t = useTranslations('report');
  const { colors } = useTheme();
  const { session } = useSession();
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <View accessibilityRole="text" accessibilityLiveRegion="polite" style={{ flexDirection: 'row', gap: space[2] }}>
        <ShieldCheck size={16} color={colors.success} style={{ marginTop: 4 }} />
        <Text variant="small" tone="success" style={{ flexShrink: 1 }}>
          {t('thanks')}
        </Text>
      </View>
    );
  }

  return (
    <>
      <Button
        label={label}
        variant="ghost"
        icon={<Flag size={16} color={colors.foreground} />}
        onPress={() =>
          session ? setOpen(true) : router.push({ pathname: '/sign-in', params: { next: returnPath } })
        }
      />
      {session ? (
        <ReportSheet
          visible={open}
          target={target}
          targetId={targetId}
          label={label}
          onClose={() => setOpen(false)}
          onSent={() => {
            setOpen(false);
            setSent(true);
          }}
        />
      ) : null}
    </>
  );
}

function ReportSheet({
  visible,
  target,
  targetId,
  label,
  onClose,
  onSent,
}: {
  visible: boolean;
  target: Target;
  targetId: string;
  label: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const t = useTranslations();
  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [detail, setDetail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Each opening starts empty — no reason chosen for the reader, no refusal
  // left over from the last time — as the filter sheet starts from the board.
  const [shown, setShown] = useState(visible);
  if (visible !== shown) {
    setShown(visible);
    if (visible) {
      setReason(null);
      setDetail('');
      setError(null);
    }
  }

  async function submit() {
    if (pending) return;
    if (!reason) {
      setError(t('report.chooseReason'));
      return;
    }
    setError(null);
    setPending(true);
    const result = await callAction('reportTarget', {
      target,
      targetId,
      reason,
      detail: detail.trim(),
    } as ReportInput).catch(() => null);
    setPending(false);

    if (!result) {
      // The request never came back. Nothing is claimed; the sheet stays
      // filled in so sending again is one tap.
      setError(t('report.network'));
      return;
    }
    if (result.ok) {
      onSent();
      return;
    }
    const copy = REFUSAL_COPY[result.error];
    setError(copy ? t(`report.${copy}` as never) : t('common.errorBody'));
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardRoom>
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space[2],
              paddingHorizontal: gutter,
              paddingVertical: space[2],
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              onPress={onClose}
              hitSlop={8}
              // The glyph, not its 44-point box, on the page's margin.
              style={{ minWidth: hitTarget, minHeight: hitTarget, marginStart: -(hitTarget - 22) / 2, alignItems: 'center', justifyContent: 'center' }}
            >
              <X size={22} color={colors.foreground} />
            </Pressable>
            <Text weight="semibold" accessibilityRole="header" style={{ flex: 1 }}>
              {label}
            </Text>
          </View>

          <ScrollView
            automaticallyAdjustKeyboardInsets
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: gutter, gap: space[5], paddingBottom: insets.bottom + space[6] }}
          >
            <View style={{ gap: space[2] }} accessibilityRole="radiogroup" accessibilityLabel={t('report.question')}>
              <Text variant="small" weight="semibold">
                {t('report.question')}
              </Text>
              {REASONS_FOR[target].map((value) => {
                const selected = value === reason;
                const name = t(`reportReason.${value}` as never);
                const hint = t(`reportHint.${value}` as never);
                return (
                  <Pressable
                    key={value}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    accessibilityLabel={`${name}. ${hint}`}
                    onPress={() => {
                      setReason(value);
                      setError(null);
                    }}
                    style={({ pressed }) => ({
                      minHeight: hitTarget,
                      gap: 2,
                      paddingHorizontal: space[3],
                      paddingVertical: space[2],
                      ...corner('lg'),
                      borderWidth: selected ? 2 : 1,
                      borderColor: selected ? colors.primary : colors.border,
                      backgroundColor: pressed ? colors.muted : selected ? colors.secondary : colors.card,
                    })}
                  >
                    <Text variant="small" weight="medium">
                      {name}
                    </Text>
                    <Text variant="caption" tone="mutedForeground">
                      {hint}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={{ gap: space[1] }}>
              <Text variant="small" weight="medium">
                {t('report.detailLabel')}
              </Text>
              <TextInput
                value={detail}
                onChangeText={setDetail}
                accessibilityLabel={t('report.detailLabel')}
                accessibilityHint={t('report.detailHint')}
                placeholder={t('report.detailPlaceholder')}
                multiline
                maxLength={500}
                textAlignVertical="top"
                keyboardAppearance={scheme}
                placeholderTextColor={colors.mutedForeground}
                selectionColor={colors.primary}
                style={{
                  minHeight: 72,
                  padding: space[3],
                  ...corner('lg'),
                  borderWidth: 1,
                  borderColor: colors.input,
                  backgroundColor: colors.card,
                  color: colors.foreground,
                  fontFamily: font.regular,
                  fontSize: scale.body.fontSize,
                  // The physical edge, as in TextField: a field's text is not mirrored for right to left.
                  textAlign: appDirection === 'rtl' ? 'right' : 'left',
                }}
              />
              <Text variant="caption" tone="mutedForeground">
                {t('report.detailHint')}
              </Text>
            </View>

            <View style={{ flexDirection: 'row', gap: space[2] }}>
              <EyeOff size={14} color={colors.mutedForeground} style={{ marginTop: 4 }} />
              <Text variant="caption" tone="mutedForeground" style={{ flex: 1 }}>
                {t('report.privacy')}
              </Text>
            </View>

            {error ? <Notice tone="destructive">{error}</Notice> : null}

            <Button label={t('report.send')} size="lg" loading={pending} onPress={submit} />
            <Button label={t('common.cancel')} variant="ghost" disabled={pending} onPress={onClose} />
          </ScrollView>
        </View>
      </KeyboardRoom>
    </Modal>
  );
}
