import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { useTranslations } from 'use-intl';
import { ImageUp, Trash2 } from '~/components/ui/lucide';
import { CompanyLogo } from '~/components/companies/company-logo';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { Text } from '~/components/ui/text';
import { pickImage, PhotoRefused } from '~/features/account/settings';
import { useRemoveLogo, useUploadLogo } from '~/features/employer/company';
import { ApiError } from '~/lib/api';
import { useTheme } from '~/theme/provider';
import { hitTarget, space } from '~/theme/tokens';

/**
 * The company's mark — the website's LogoUpload, first on the page because it
 * is the one thing here shown everywhere else: the board, every listing, the
 * directory. Picked from the library as drawn (a transparent ground stays
 * so), sent to the website, which keeps only the pixels. A company admin's.
 */
export function LogoControls({
  companyId,
  companyName,
  companySlug,
  logoUrl,
}: {
  companyId: string;
  companyName: string;
  companySlug: string;
  logoUrl: string | null;
}) {
  const t = useTranslations();
  const { colors } = useTheme();
  const upload = useUploadLogo(companyId);
  const remove = useRemoveLogo(companyId);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const busy = picking || upload.isPending || remove.isPending;

  const explain = (failure: unknown) => {
    if (failure instanceof ApiError && failure.status === 0) return t('app.offline.body');
    const reason = failure instanceof PhotoRefused ? failure.reason : 'failed';
    return reason === 'file_type'
      ? t('validation.fileType')
      : reason === 'too_large'
        ? t('validation.fileTooLarge')
        : t('common.errorBody');
  };

  // Promise chains, not try/finally, which the React Compiler does not compile.
  const choose = () => {
    setError(null);
    setPicking(true);
    pickImage('logo')
      .then((logo) => {
        if (logo) upload.mutate(logo, { onError: (failure) => setError(explain(failure)) });
      })
      .catch((failure: unknown) => setError(explain(failure)))
      .then(() => setPicking(false));
  };

  const confirmRemove = () =>
    Alert.alert(t('employer.logo'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => {
          setError(null);
          remove.mutate(undefined, { onError: (failure) => setError(explain(failure)) });
        },
      },
    ]);

  return (
    <Card style={{ gap: space[3] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
        <CompanyLogo name={companyName} logoUrl={logoUrl} seed={companySlug} size="lg" />
        <View style={{ flex: 1, gap: 2 }}>
          <Text weight="semibold" accessibilityRole="header">
            {t('employer.logo')}
          </Text>
          <Text variant="caption" tone="mutedForeground">
            {t('employer.logoHint')}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
        <Button
          label={logoUrl ? t('employer.logoReplace') : t('employer.logoUpload')}
          variant="outline"
          size="sm"
          icon={<ImageUp size={16} color={colors.foreground} />}
          loading={picking || upload.isPending}
          disabled={busy}
          onPress={choose}
        />
        {logoUrl ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t('common.delete')}: ${t('employer.logo')}`}
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={confirmRemove}
            style={{ width: hitTarget, height: hitTarget, alignItems: 'center', justifyContent: 'center' }}
          >
            <Trash2 size={18} color={colors.mutedForeground} />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text variant="small" tone="destructive" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </Card>
  );
}
