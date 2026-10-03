import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslations } from 'use-intl';
import { BellPlus, BellRing, Bookmark, BookmarkCheck, Check } from '~/components/ui/lucide';
import { canSaveJobs } from '@/lib/permissions';
import { Button } from '~/components/ui/button';
import { Text } from '~/components/ui/text';
import { TextField } from '~/components/ui/text-field';
import {
  SaveRefused,
  useFollowing,
  useSavedJobIds,
  useSaveSearch,
  useToggleFollow,
  useToggleSavedJob,
} from '~/features/saved/queries';
import { haptic } from '~/lib/haptics';
import { useSession } from '~/lib/session';
import { useTheme } from '~/theme/provider';
import { hitTarget, space } from '~/theme/tokens';

/**
 * The website's bookmarks, follows and "tell me when there's a new one": each
 * offered to a candidate, whose rows they are (canSaveJobs, which restates the
 * insert policies), and to somebody signed out, who is sent to sign in and
 * brought back — never to anybody they cannot work for.
 */

/** Signed out: the sign-in sheet, coming back to where the reader is. */
function signInThenReturn(next: string) {
  router.push({ pathname: '/sign-in', params: { next } });
}

/** The bookmark on a listing's card: whether it is saved, and the tap that changes it. */
export function useSaveJob(jobId: string) {
  const t = useTranslations('jobs');
  const { actor } = useSession();
  const { ids, known } = useSavedJobIds();
  const saved = ids.has(jobId);
  const toggle = useToggleSavedJob();
  return {
    savable: canSaveJobs(actor),
    saved,
    // Until the bookmarks are read, a press could take one off (the website toggles).
    pending: toggle.isPending || !known,
    label: saved ? t('removeSaved') : t('save'),
    toggle: () => {
      if (!known) return;
      haptic.selection();
      toggle.mutate({ jobId, saved });
    },
  };
}

/** The card's icon: a second action on something whose first is "open this". */
export function SaveJobIcon({ save }: { save: ReturnType<typeof useSaveJob> }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={save.label}
      accessibilityState={{ selected: save.saved, busy: save.pending }}
      disabled={save.pending}
      onPress={save.toggle}
      hitSlop={4}
      style={{
        width: hitTarget,
        height: hitTarget,
        marginTop: -space[3],
        marginEnd: -space[3],
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {save.saved ? (
        <BookmarkCheck size={20} color={colors.primary} />
      ) : (
        <Bookmark size={20} color={colors.mutedForeground} />
      )}
    </Pressable>
  );
}

/** The listing page's labelled button, beside the way to apply. */
export function SaveJobButton({ jobId, slug }: { jobId: string; slug: string }) {
  const t = useTranslations('jobs');
  const { colors } = useTheme();
  const { session, viewer } = useSession();
  const save = useSaveJob(jobId);

  if (session && viewer?.profile && !save.savable) return null;
  const signedIn = Boolean(session && viewer?.profile);

  return (
    <Button
      label={save.saved ? t('saved') : t('save')}
      variant="outline"
      size="lg"
      accessibilityState={{ selected: save.saved, busy: save.pending, disabled: save.pending }}
      disabled={save.pending}
      icon={
        save.saved ? <BookmarkCheck size={18} color={colors.primary} /> : <Bookmark size={18} color={colors.foreground} />
      }
      onPress={() => (signedIn ? save.toggle() : signInThenReturn(`/jobs/${slug}`))}
    />
  );
}

/**
 * "Tell me when there's a new one of these" — only once the board is
 * narrowed, since an unfiltered one would be the whole board by email every
 * week. The name is the reader's to change before it is saved.
 */
export function SaveSearchButton({ query, defaultLabel }: { query: string; defaultLabel: string }) {
  const t = useTranslations('savedSearch');
  const tCommon = useTranslations('common');
  const { colors } = useTheme();
  const { session, viewer, actor } = useSession();
  const save = useSaveSearch();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(defaultLabel);
  const [error, setError] = useState<string | null>(null);

  const signedIn = Boolean(session && viewer?.profile);
  if (signedIn && !canSaveJobs(actor)) return null;

  if (save.isSuccess) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[1] }} accessibilityLiveRegion="polite">
        <Check size={16} color={colors.success} />
        <Text variant="small" weight="medium" tone="success">
          {t('saved')}
        </Text>
      </View>
    );
  }

  const cta = (
    <Button
      label={t('cta')}
      variant="outline"
      size="sm"
      icon={<BellPlus size={16} color={colors.foreground} />}
      onPress={() => {
        if (!signedIn) {
          signInThenReturn(`/jobs${query ? `?${query}` : ''}`);
          return;
        }
        setLabel(defaultLabel);
        setError(null);
        setOpen(true);
      }}
    />
  );
  if (!open) return <View style={{ alignItems: 'flex-start' }}>{cta}</View>;

  const submit = () => {
    const name = label.trim();
    // The keyboard's Done is not the button: a second press while saving would be told "already saved".
    if (!name || save.isPending) return;
    setError(null);
    save.mutate(
      { label: name, query },
      {
        onError: (failure) => {
          const reason = failure instanceof SaveRefused ? failure.reason : 'failed';
          setError(
            reason === 'already_saved'
              ? t('alreadySaved')
              : reason === 'cap'
                ? t('cap')
                : reason === 'no_filters'
                  ? t('noFilters')
                  : tCommon('errorBody'),
          );
        },
      },
    );
  };

  return (
    <View style={{ gap: space[2] }}>
      <TextField
        value={label}
        onChangeText={setLabel}
        maxLength={80}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={submit}
        accessibilityLabel={t('labelField')}
      />
      <View style={{ flexDirection: 'row', gap: space[2] }}>
        <Button label={tCommon('save')} size="sm" loading={save.isPending} disabled={!label.trim()} onPress={submit} />
        <Button label={tCommon('cancel')} size="sm" variant="ghost" onPress={() => setOpen(false)} />
      </View>
      {error ? (
        <Text variant="small" tone="destructive" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * "Tell me when this brokerage posts." Underneath, a saved search with one
 * filter, so the reader gets the weekly email they already know, with the
 * same switch in Saved; the button says the outcome, not the mechanism.
 */
export function FollowCompanyButton({ slug, label }: { slug: string; label: string }) {
  const t = useTranslations('companies');
  const tCommon = useTranslations('common');
  const { colors } = useTheme();
  const { session, viewer, actor } = useSession();
  const { following } = useFollowing(slug);
  const toggle = useToggleFollow(slug, label);
  const [error, setError] = useState<string | null>(null);

  const signedIn = Boolean(session && viewer?.profile);
  if (signedIn && !canSaveJobs(actor)) return null;

  const onPress = () => {
    if (!signedIn) {
      signInThenReturn(`/companies/${slug}`);
      return;
    }
    setError(null);
    haptic.selection();
    toggle.mutate(
      { follow: !following },
      {
        // The ten-row limit is shared with saved searches, so the message names both.
        onError: (failure) => setError(failure instanceof SaveRefused && failure.reason === 'cap' ? t('followCap') : tCommon('errorBody')),
      },
    );
  };

  return (
    <View style={{ gap: space[1], alignItems: 'flex-start' }}>
      <Button
        label={following ? t('following') : t('follow')}
        variant={following ? 'secondary' : 'outline'}
        accessibilityState={{ selected: following, busy: toggle.isPending, disabled: toggle.isPending }}
        disabled={toggle.isPending}
        icon={following ? <BellRing size={16} color={colors.primary} /> : <BellPlus size={16} color={colors.foreground} />}
        onPress={onPress}
      />
      <Text variant="caption" tone="mutedForeground">
        {following ? t('followingHint') : t('followHint')}
      </Text>
      {error ? (
        <Text variant="caption" tone="destructive" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
