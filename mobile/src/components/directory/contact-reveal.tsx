import { useState } from 'react';
import { Linking, View } from 'react-native';
import { useLocale, useTranslations } from 'use-intl';
import { Download, Eye, MessageCircle } from '~/components/ui/lucide';
import { Button } from '~/components/ui/button';
import { Text } from '~/components/ui/text';
import { openAgentCv, RevealRefused, useRevealContact, type RevealedContact } from '~/features/directory/queries';
import { ApiError } from '~/lib/api';
import { useTheme } from '~/theme/provider';
import { space } from '~/theme/tokens';

/**
 * The button that asks for a number — the website's ContactReveal. Nothing of
 * the consultant's contact is on the page until it is pressed; the press is
 * one recorded reveal, and the answer is WhatsApp with the company's opener
 * already written, the number itself, and the CV when there is one. A refusal
 * says which kind it was — not open to this company, or enough opened for now
 * — without naming a threshold.
 */
export function ContactReveal({ handle, hasCv }: { handle: string; hasCv: boolean }) {
  const t = useTranslations();
  const locale = useLocale();
  const { colors } = useTheme();
  const reveal = useRevealContact();
  const [revealed, setRevealed] = useState<RevealedContact | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const ask = () => {
    setMessage(null);
    reveal.mutate(
      { handle, locale: locale === 'en' ? 'en' : 'ar' },
      {
        onSuccess: setRevealed,
        onError: (failure) => {
          if (failure instanceof ApiError && failure.status === 0) return setMessage(t('app.offline.body'));
          if (failure instanceof RevealRefused && failure.reason === 'rate_limit') {
            const minutes = Math.max(1, Math.ceil((failure.retryAfterSeconds ?? 3600) / 60));
            return setMessage(t('agents.revealRateLimited', { minutes }));
          }
          if (failure instanceof RevealRefused && failure.reason === 'locked') return setMessage(t('agents.revealLocked'));
          setMessage(t('common.errorBody'));
        },
      },
    );
  };

  if (revealed) {
    return (
      <View style={{ gap: space[2] }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[2] }}>
          <Button
            label={t('agents.contact')}
            size="lg"
            icon={<MessageCircle size={18} color={colors.primaryForeground} />}
            onPress={() => Linking.openURL(revealed.whatsappUrl).catch(() => {})}
          />
          {/* The number as written, left to right, and copyable. */}
          <Text selectable tone="mutedForeground" style={{ writingDirection: 'ltr' }}>
            {revealed.phone}
          </Text>
        </View>
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
        onPress={ask}
      />
      {message ? (
        <Text variant="small" tone="mutedForeground" accessibilityLiveRegion="polite">
          {message}
        </Text>
      ) : null}
    </View>
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
