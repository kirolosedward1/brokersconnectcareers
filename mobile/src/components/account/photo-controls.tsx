import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { useTranslations } from 'use-intl';
import { ImageUp, Trash2 } from 'lucide-react-native';
import { Button } from '~/components/ui/button';
import { Text } from '~/components/ui/text';
import { PhotoRefused, pickPhoto, useRemovePhoto, useUploadPhoto } from '~/features/account/settings';
import { ApiError } from '~/lib/api';
import { useTheme } from '~/theme/provider';
import { hitTarget, space } from '~/theme/tokens';

/**
 * The photo's two buttons — the website's AvatarUpload. The one thing on the
 * account other people see: employers with an application, the directory
 * card. Picked from the library, cropped square, sent to the website, which
 * keeps only the pixels.
 */
export function PhotoControls({ hasPhoto }: { hasPhoto: boolean }) {
  const t = useTranslations();
  const { colors } = useTheme();
  const upload = useUploadPhoto();
  const remove = useRemovePhoto();
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

  const choose = async () => {
    setError(null);
    setPicking(true);
    try {
      const photo = await pickPhoto();
      if (photo) upload.mutate(photo, { onError: (failure) => setError(explain(failure)) });
    } catch (failure) {
      setError(explain(failure));
    } finally {
      setPicking(false);
    }
  };

  const confirmRemove = () =>
    Alert.alert(t('account.photo'), undefined, [
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
    <View style={{ gap: space[2] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
        <Button
          label={hasPhoto ? t('account.photoReplace') : t('account.photoUpload')}
          variant="outline"
          size="sm"
          icon={<ImageUp size={16} color={colors.foreground} />}
          loading={picking || upload.isPending}
          disabled={busy}
          onPress={choose}
        />
        {hasPhoto ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t('common.delete')}: ${t('account.photo')}`}
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={confirmRemove}
            style={{ width: hitTarget, height: hitTarget, alignItems: 'center', justifyContent: 'center' }}
          >
            <Trash2 size={18} color={colors.mutedForeground} />
          </Pressable>
        ) : null}
      </View>
      <Text variant="caption" tone="mutedForeground">
        {t('account.photoHint')}
      </Text>
      {error ? (
        <Text variant="small" tone="destructive" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
