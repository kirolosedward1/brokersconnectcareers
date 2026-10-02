import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { useTranslations } from 'use-intl';
import { ShieldCheck, UserPlus, UserRound, X } from '~/components/ui/lucide';
import type { CompanyMemberRole } from '@/lib/supabase/database.types';
import { Avatar } from '~/components/ui/avatar';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { Field } from '~/components/ui/field';
import { Select } from '~/components/ui/select';
import { Text } from '~/components/ui/text';
import { TextField } from '~/components/ui/text-field';
import { MemberRefused, useAddMember, useRemoveMember, type TeamMember } from '~/features/employer/company';
import { EMAIL_SHAPE } from '~/lib/email-shape';
import { useTheme } from '~/theme/provider';
import { hitTarget, radius, space } from '~/theme/tokens';

const REFUSAL_COPY = {
  no_account: 'teamNoAccount',
  already_member: 'teamAlreadyMember',
  rate_limited: 'teamRateLimited',
} as const;

/**
 * Who is on the company's team — the website's TeamSettings: the roster with
 * each person's role (the owner marked, and never removable), and for a
 * company admin, adding a colleague who already has an account (the hint says
 * what "admin" grants at the moment it is chosen) and taking one off, after
 * asking. A recruiter sees the roster and who can change it.
 */
export function TeamSettings({ members, canManage }: { members: TeamMember[]; canManage: boolean }) {
  const t = useTranslations();
  const { colors } = useTheme();
  const add = useAddMember();
  const remove = useRemoveMember();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<CompanyMemberRole>('recruiter');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const address = email.trim();
    if (!address) return;
    setError(null);
    // Not an address: said here, in those words. Sent, the website refused it
    // as "invalid", which read as "try again" — with the same address.
    if (!EMAIL_SHAPE.test(address)) {
      setError(t('validation.invalidEmail'));
      return;
    }
    add.mutate(
      { email: address, role },
      {
        onSuccess: () => {
          setEmail('');
          setRole('recruiter');
        },
        onError: (failure) => {
          const reason = failure instanceof MemberRefused ? failure.reason : 'failed';
          setError(
            reason === 'failed'
              ? t('common.errorBody')
              : reason === 'invalid_email'
                ? t('validation.invalidEmail')
                : t(`employer.${REFUSAL_COPY[reason]}`),
          );
        },
      },
    );
  };

  const confirmRemove = (member: TeamMember) =>
    Alert.alert(t('employer.teamRemove'), member.name ?? undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('employer.teamRemove'),
        style: 'destructive',
        onPress: () => {
          setError(null);
          remove.mutate(member.userId, {
            onError: (failure) =>
              setError(failure instanceof Error && failure.message === 'owner' ? t('employer.teamCannotRemoveOwner') : t('common.errorBody')),
          });
        },
      },
    ]);

  return (
    <Card style={{ gap: space[4] }}>
      <View style={{ gap: space[1] }}>
        <Text weight="semibold" accessibilityRole="header">
          {t('employer.teamTitle')}
        </Text>
        <Text variant="small" tone="mutedForeground">
          {t('employer.teamBody')}
        </Text>
      </View>

      {members.map((member) => {
        const name = member.name ?? '—';
        return (
          <View
            key={member.userId}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space[3],
              padding: space[3],
              borderRadius: radius.xl,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Avatar name={name} seed={member.userId} />
            <View style={{ flex: 1 }}>
              <Text variant="small" weight="medium" numberOfLines={1}>
                {name}
              </Text>
              <Text variant="caption" tone="mutedForeground">
                {member.role === 'admin' ? t('employer.teamRoleAdmin') : t('employer.teamRoleRecruiter')}
              </Text>
            </View>
            {member.isOwner ? (
              <Badge variant="primary" label={t('employer.teamOwner')} icon={<ShieldCheck size={12} color={colors.primary} />} />
            ) : canManage ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${t('employer.teamRemove')}: ${name}`}
                disabled={remove.isPending}
                onPress={() => confirmRemove(member)}
                style={{ width: hitTarget, height: hitTarget, alignItems: 'center', justifyContent: 'center' }}
              >
                <X size={18} color={colors.mutedForeground} />
              </Pressable>
            ) : null}
          </View>
        );
      })}

      {canManage ? (
        <View style={{ gap: space[3], paddingTop: space[4], borderTopWidth: 1, borderTopColor: colors.border }}>
          <Field label={t('employer.teamEmail')}>
            <TextField
              value={email}
              onChangeText={setEmail}
              accessibilityLabel={t('employer.teamEmail')}
              ltr
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
            />
          </Field>
          <Field
            label={t('employer.teamRole')}
            hint={role === 'admin' ? t('employer.teamRoleAdminHint') : t('employer.teamRoleRecruiterHint')}
          >
            <Select
              label={t('employer.teamRole')}
              value={role}
              placeholder={t('employer.teamRole')}
              required
              options={[
                { value: 'recruiter' as const, label: t('employer.teamRoleRecruiter') },
                { value: 'admin' as const, label: t('employer.teamRoleAdmin') },
              ]}
              onChange={(value) => value && setRole(value)}
            />
          </Field>
          {error ? (
            <Text variant="small" tone="destructive" accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
          <View style={{ alignItems: 'flex-start' }}>
            <Button
              label={t('employer.teamAdd')}
              icon={<UserPlus size={16} color={colors.primaryForeground} />}
              loading={add.isPending}
              disabled={!email.trim()}
              onPress={submit}
            />
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2], paddingTop: space[4], borderTopWidth: 1, borderTopColor: colors.border }}>
          <UserRound size={16} color={colors.mutedForeground} />
          <Text variant="small" tone="mutedForeground" style={{ flex: 1 }}>
            {t('employer.teamOnlyAdmins')}
          </Text>
        </View>
      )}
      {!canManage && error ? (
        <Text variant="small" tone="destructive" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </Card>
  );
}
