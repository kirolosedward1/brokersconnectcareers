import { useState } from 'react';
import { Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';
import { Check, Flag, X } from 'lucide-react-native';
import type { ReportInput } from '@/lib/mobile-api/contract';
import { AGENT_REPORT_REASONS, COMPANY_REPORT_REASONS, REPORT_REASONS } from '@/lib/taxonomy';
import { Button } from '~/components/ui/button';
import { Notice } from '~/components/ui/notice';
import { Text } from '~/components/ui/text';
import { callAction } from '~/lib/api';
import { useSession } from '~/lib/session';
import { useTheme } from '~/theme/provider';
import { font, hitTarget, radius, space, type as scale } from '~/theme/tokens';

type Target = ReportInput['target'];

const REASONS_FOR: Record<Target, readonly string[]> = {
  job: REPORT_REASONS,
  company: COMPANY_REPORT_REASONS,
  agent: AGENT_REPORT_REASONS,
};

/**
 * Report a listing, a company or a consultant's profile — the website's one
 * dialog (src/components/jobs/report-job-dialog.tsx) through its one action
 * (reportTarget), with its rules: an account is needed, so a signed-out reader
 * is sent to sign in and brought back here; each target has its own reasons;
 * one report per person per target and ten a day, each refusal in its own
 * words. What is sent lands in the admin console's reports queue, read by a
 * person.
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
  const t = useTranslations('app.moderation');
  const { colors } = useTheme();
  const { session } = useSession();
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
        <Check size={16} color={colors.success} />
        <Text variant="small" tone="success" style={{ flexShrink: 1 }}>
          {t('reportSent')}
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
  const reasons = REASONS_FOR[target];
  const [reason, setReason] = useState(reasons[0]);
  const [detail, setDetail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    setError(null);
    setPending(true);
    const result = await callAction('reportTarget', {
      target,
      targetId,
      reason,
      detail: detail.trim(),
    } as ReportInput).catch(() => null);
    setPending(false);
    if (result?.ok) {
      onSent();
      return;
    }
    const code = result && !result.ok ? result.error : null;
    setError(
      code === 'already_reported'
        ? t('jobs.alreadyReported')
        : code === 'rate_limit'
          ? t('jobs.reportRateLimit')
          : t('common.errorBody'),
    );
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space[2],
            paddingHorizontal: space[4],
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
            style={{ minWidth: hitTarget, minHeight: hitTarget, alignItems: 'center', justifyContent: 'center' }}
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
          contentContainerStyle={{ padding: space[4], gap: space[5], paddingBottom: insets.bottom + space[6] }}
        >
          <View style={{ gap: space[2] }} accessibilityRole="radiogroup" accessibilityLabel={t('jobs.reportReasonLabel')}>
            <Text variant="small" weight="semibold">
              {t('jobs.reportReasonLabel')}
            </Text>
            {reasons.map((value) => {
              const selected = value === reason;
              return (
                <Pressable
                  key={value}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  onPress={() => setReason(value)}
                  style={({ pressed }) => ({
                    minHeight: hitTarget,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space[3],
                    paddingHorizontal: space[3],
                    borderRadius: radius.lg,
                    borderWidth: selected ? 2 : 1,
                    borderColor: selected ? colors.primary : colors.border,
                    backgroundColor: pressed ? colors.muted : colors.card,
                  })}
                >
                  <Text style={{ flex: 1 }}>{t(`reportReason.${value}` as never)}</Text>
                  {selected ? <Check size={18} color={colors.primary} /> : null}
                </Pressable>
              );
            })}
          </View>

          <View style={{ gap: space[1] }}>
            <Text variant="small" weight="medium">
              {t('app.moderation.reportDetail')}
            </Text>
            <TextInput
              value={detail}
              onChangeText={setDetail}
              accessibilityLabel={t('app.moderation.reportDetail')}
              multiline
              maxLength={1000}
              textAlignVertical="top"
              keyboardAppearance={scheme}
              placeholderTextColor={colors.mutedForeground}
              selectionColor={colors.primary}
              style={{
                minHeight: 120,
                padding: space[3],
                borderRadius: radius.lg,
                borderWidth: 1,
                borderColor: colors.input,
                backgroundColor: colors.card,
                color: colors.foreground,
                fontFamily: font.regular,
                fontSize: scale.body.fontSize,
                textAlign: 'left',
              }}
            />
          </View>

          {error ? <Notice tone="destructive">{error}</Notice> : null}

          <Button label={t('common.submit')} size="lg" loading={pending} onPress={submit} />
          <Button label={t('common.cancel')} variant="ghost" disabled={pending} onPress={onClose} />
        </ScrollView>
      </View>
    </Modal>
  );
}
