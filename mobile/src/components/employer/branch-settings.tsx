import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useLocale, useTranslations } from 'use-intl';
import { localized } from '@/lib/locale';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { Field } from '~/components/ui/field';
import { MapPin, Plus, X } from '~/components/ui/lucide';
import { Select } from '~/components/ui/select';
import { Text } from '~/components/ui/text';
import { TextField } from '~/components/ui/text-field';
import { BranchRefused, MAX_BRANCHES, useDeleteBranch, useSaveBranch, type Branch } from '~/features/employer/branches';
import { useDistricts } from '~/features/taxonomy';
import { dialog } from '~/lib/dialog';
import { useTheme } from '~/theme/provider';
import { corner, hitTarget, space } from '~/theme/tokens';

/**
 * The company's branches (Phase B 07b): each with its name and district. An
 * admin adds and removes them; a listing can then say which branch it is
 * for. The head office stays the company's own district.
 */
export function BranchSettings({ companyId, branches, canManage }: { companyId: string; branches: Branch[]; canManage: boolean }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const districts = useDistricts().data ?? [];
  const save = useSaveBranch(companyId);
  const remove = useDeleteBranch(companyId);
  const [nameAr, setNameAr] = useState('');
  const [districtId, setDistrictId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const full = branches.length >= MAX_BRANCHES;

  const add = () => {
    if (!nameAr.trim()) return;
    setError(null);
    save.mutate(
      { nameAr: nameAr.trim(), districtId },
      {
        onSuccess: () => {
          setNameAr('');
          setDistrictId(null);
        },
        onError: (failure) =>
          setError(failure instanceof BranchRefused && failure.reason === 'branch_cap' ? t('app.branches.full') : t('common.errorBody')),
      },
    );
  };

  const confirmRemove = (branch: Branch) =>
    dialog.alert(t('app.branches.remove'), branch.name_ar, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('app.branches.remove'),
        style: 'destructive',
        onPress: () => remove.mutate(branch.id, { onError: () => setError(t('common.errorBody')) }),
      },
    ]);

  if (!canManage && !branches.length) return null;

  return (
    <Card style={{ gap: space[4] }}>
      <View style={{ gap: space[1] }}>
        <Text weight="semibold" accessibilityRole="header">
          {t('app.branches.title')}
        </Text>
        <Text variant="small" tone="mutedForeground">
          {t('app.branches.body')}
        </Text>
      </View>
      {branches.map((branch) => {
        const name = localized(locale, branch.name_ar, branch.name_en);
        return (
          <View
            key={branch.id}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space[3],
              padding: space[3],
              ...corner('xl'),
              borderWidth: StyleSheet.hairlineWidth * 2,
              borderColor: colors.border,
            }}
          >
            <MapPin size={16} color={colors.mutedForeground} />
            <View style={{ flex: 1 }}>
              <Text variant="small" weight="medium">
                {name}
              </Text>
              {branch.district ? (
                <Text variant="caption" tone="mutedForeground">
                  {localized(locale, branch.district.name_ar, branch.district.name_en)}
                </Text>
              ) : null}
            </View>
            {canManage ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${t('app.branches.remove')}: ${name}`}
                onPress={() => confirmRemove(branch)}
                style={{ width: hitTarget, height: hitTarget, alignItems: 'center', justifyContent: 'center' }}
              >
                <X size={18} color={colors.mutedForeground} />
              </Pressable>
            ) : null}
          </View>
        );
      })}
      {canManage && full ? (
        <Text variant="small" tone="mutedForeground">
          {t('app.branches.full')}
        </Text>
      ) : canManage ? (
        <View style={{ gap: space[3], paddingTop: space[2] }}>
          <Field label={t('app.branches.name')}>
            <TextField value={nameAr} onChangeText={setNameAr} accessibilityLabel={t('app.branches.name')} />
          </Field>
          <Field label={t('app.branches.district')}>
            <Select
              label={t('app.branches.district')}
              value={districtId}
              placeholder={t('app.branches.districtNone')}
              options={districts.map((row) => ({ value: row.id, label: localized(locale, row.name_ar, row.name_en) }))}
              onChange={setDistrictId}
            />
          </Field>
          <View style={{ alignItems: 'flex-start' }}>
            <Button
              label={t('app.branches.add')}
              variant="outline"
              icon={<Plus size={16} color={colors.foreground} />}
              disabled={!nameAr.trim()}
              loading={save.isPending}
              onPress={add}
            />
          </View>
        </View>
      ) : null}
      {error ? (
        <Text variant="small" tone="destructive" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </Card>
  );
}
