import { useState } from 'react';
import { View } from 'react-native';
import { useTranslations } from 'use-intl';
import { Text } from '~/components/ui/text';
import { TextLink } from '~/components/ui/text-link';
import { useLargeText } from '~/theme/large-text';
import { space } from '~/theme/tokens';

/** How many lines show before «اقرأ المزيد». */
export const FOLD_LINES = 4;

/**
 * Long text, folded: the first four lines and «اقرأ المزيد», which opens the
 * rest (and «عرض أقل» folds it again). Text that fits shows whole, with no
 * link (owner's call, 31 Oct: save space on the listing). Selectable either
 * way, so a phone number in it can still be copied.
 */
export function FoldedText({ children }: { children: string }) {
  const t = useTranslations('app.listing');
  const [open, setOpen] = useState(false);
  // Measured once, unfolded: whether there is more than the fold to show.
  const [long, setLong] = useState<boolean | null>(null);
  // At the accessibility sizes the text is never cut: it shows whole, as every line in the app does there.
  const large = useLargeText();
  const folds = Boolean(long) && !large;

  return (
    <View style={{ gap: space[1], alignItems: 'flex-start' }}>
      <Text
        selectable
        numberOfLines={long && !large && !open ? FOLD_LINES : undefined}
        onTextLayout={long === null ? ({ nativeEvent }) => setLong(nativeEvent.lines.length > FOLD_LINES) : undefined}
        style={{ alignSelf: 'stretch' }}
      >
        {children}
      </Text>
      {folds ? <TextLink label={open ? t('readLess') : t('readMore')} onPress={() => setOpen(!open)} /> : null}
    </View>
  );
}
