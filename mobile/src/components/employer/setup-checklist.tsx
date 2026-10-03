import { View } from 'react-native';
import { router } from 'expo-router';
import { useTranslations } from 'use-intl';
import { Check, CircleDashed, Clock } from '~/components/ui/lucide';
import type { CompanyRow } from '@/lib/supabase/database.types';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { Text } from '~/components/ui/text';
import { useTheme } from '~/theme/provider';
import { corner, space } from '~/theme/tokens';

type Step = { key: string; label: string; hint: string; state: 'done' | 'waiting' | 'todo'; href: string };

/**
 * What is left before this company can receive an applicant — the website's
 * SetupChecklist, which stands in for the figures until there is a listing.
 * Every row reads real state: the company row says whether the profile is
 * filled in (what a candidate reads: the description and the mark), the
 * verification column where the paperwork stands, the summary the listings.
 * Pending is its own state, never a tick: a person has not looked yet.
 */
export function SetupChecklist({
  company,
  liveJobs,
  pendingJobs,
  draftJobs,
}: {
  company: CompanyRow | null;
  liveJobs: number;
  pendingJobs: number;
  draftJobs: number;
}) {
  const t = useTranslations('employer');
  const { colors } = useTheme();

  const verification = company?.verification_status ?? 'unverified';
  const steps: Step[] = [
    {
      key: 'company',
      label: t('setupCompany'),
      hint: t('setupCompanyHint'),
      state: company?.about_ar?.trim() && company.logo_url ? 'done' : 'todo',
      href: '/employer/company',
    },
    {
      key: 'verification',
      label: t('setupVerification'),
      hint: verification === 'rejected' ? t('setupVerificationRedo') : t('setupVerificationHint'),
      state: verification === 'verified' ? 'done' : verification === 'pending' ? 'waiting' : 'todo',
      href: '/employer/company',
    },
    {
      key: 'job',
      label: t('setupFirstJob'),
      hint: pendingJobs > 0 ? t('setupFirstJobPending') : draftJobs > 0 ? t('setupFirstJobDraft') : t('setupFirstJobHint'),
      state: liveJobs > 0 ? 'done' : pendingJobs > 0 ? 'waiting' : 'todo',
      href: draftJobs > 0 ? '/employer/jobs' : '/employer/jobs/new',
    },
  ];
  const done = steps.filter((step) => step.state === 'done').length;

  return (
    <Card style={{ gap: space[4] }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[3] }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text weight="semibold" accessibilityRole="header">
            {t('setupTitle')}
          </Text>
          <Text variant="small" tone="mutedForeground">
            {t('setupLede')}
          </Text>
        </View>
        <View style={{ paddingHorizontal: space[3], paddingVertical: 2, ...corner('full'), backgroundColor: colors.muted }}>
          <Text variant="small" weight="medium">
            {t('setupProgress', { done, total: steps.length })}
          </Text>
        </View>
      </View>

      {steps.map((step) => (
        <View key={step.key} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[3] }}>
          {/* The mark says where the step stands, so VoiceOver says it too —
              read before the step, where it sits; the icon alone left a done
              step and one not begun sounding the same. */}
          <View
            accessible
            accessibilityLabel={
              step.state === 'done'
                ? t('setupStateDone')
                : step.state === 'waiting'
                  ? t('setupStateWaiting')
                  : t('setupStateTodo')
            }
            style={{
              width: 24,
              height: 24,
              marginTop: 2,
              borderRadius: 12,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: step.state === 'done' ? colors.success : step.state === 'waiting' ? colors.warningMuted : 'transparent',
              borderWidth: step.state === 'todo' ? 1 : 0,
              borderColor: colors.border,
            }}
          >
            {step.state === 'done' ? (
              <Check size={14} color={colors.successForeground} />
            ) : step.state === 'waiting' ? (
              <Clock size={14} color={colors.warning} />
            ) : (
              <CircleDashed size={14} color={colors.mutedForeground} />
            )}
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text weight="medium" tone={step.state === 'done' ? 'mutedForeground' : 'foreground'}>
              {step.label}
            </Text>
            <Text variant="small" tone="mutedForeground">
              {step.hint}
            </Text>
          </View>
          {step.state === 'done' ? null : (
            <Button
              label={t('setupGo')}
              accessibilityLabel={`${t('setupGo')}: ${step.label}`}
              variant="outline"
              size="sm"
              onPress={() => router.navigate(step.href as never)}
            />
          )}
        </View>
      ))}

      {/* Verification is not a gate on posting: an unverified company may publish one listing. */}
      {liveJobs + pendingJobs > 0 ? null : (
        <Button label={t('setupPostFirstJob')} size="lg" onPress={() => router.navigate('/employer/jobs/new' as never)} />
      )}
    </Card>
  );
}
