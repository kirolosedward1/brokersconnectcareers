import { useEffect, useRef, useState } from 'react';
import { Keyboard, Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocale, useTranslations } from 'use-intl';
import { localized } from '@/lib/locale';
import type { TaxonomyKind } from '@/lib/supabase/database.types';
import { openDecision, type Decision } from '~/components/admin/decision-sheet';
import { Button } from '~/components/ui/button';
import { Field } from '~/components/ui/field';
import { KeyboardRoom } from '~/components/ui/keyboard-room';
import { X } from '~/components/ui/lucide';
import { Notice } from '~/components/ui/notice';
import { Select } from '~/components/ui/select';
import { useSheetFence } from '~/components/ui/sheet-fence';
import { Text } from '~/components/ui/text';
import { TextField } from '~/components/ui/text-field';
import { NAME_MAX, SLUG_MAX, taxonomyProblem, type Governorate, type TaxonomyEntry } from '~/features/admin/taxonomy';
import { appDirection } from '~/lib/direction';
import { useSheet } from '~/lib/use-sheet';
import { useTheme } from '~/theme/provider';
import { gutter, hitTarget, space } from '~/theme/tokens';

/** What the form is for: a new entry of a kind, or one row renamed. */
export type TaxonomyFormTarget = {
  kind: TaxonomyKind;
  entry: TaxonomyEntry | null;
  /** The governorates a district may be filed under; empty for the other kinds. */
  governorates: Governorate[];
};

/**
 * The website's TaxonomyAdd and TaxonomyRow, as one sheet: both names, the
 * slug (typed once, when adding; shown and never editable after, as it is
 * part of public URLs) and, for a district, its governorate. The website's
 * own checks are applied as the form is submitted, said in its own
 * sentences; what passes goes to the decision sheet as the `taxonomy` lever,
 * which saves through saveTaxonomy and says "done" only once the website
 * answered ok. A slug the website refuses (taken) is said there, in the
 * website's sentence.
 */
export function TaxonomyForm({
  visible,
  onClose,
  onDismiss,
  target,
  onSubmit,
}: {
  visible: boolean;
  onClose: () => void;
  onDismiss?: () => void;
  target: TaxonomyFormTarget;
  /** The decision to confirm, once the form has gone. */
  onSubmit: (decision: Decision) => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  // The sheet keeps its touches from the row it was opened from (sheet-fence.ts).
  const fence = useSheetFence();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { kind, entry, governorates } = target;
  const [nameAr, setNameAr] = useState(entry?.name_ar ?? '');
  const [nameEn, setNameEn] = useState(entry?.name_en ?? '');
  const [slug, setSlug] = useState('');
  // A new district goes under the first governorate until another is chosen, as the website's form starts.
  const [governorateId, setGovernorateId] = useState<number | null>(entry?.governorate_id ?? governorates[0]?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const adding = entry === null;
  const title = adding ? t('app.admin.taxonomy.newEntry') : t('app.admin.taxonomy.renameTitle', { name: entry.name_ar });
  const dirty = adding || nameAr !== entry.name_ar || nameEn !== entry.name_en || governorateId !== entry.governorate_id;

  const submit = () => {
    const draft = {
      kind,
      nameAr: nameAr.trim(),
      nameEn: nameEn.trim(),
      slug: adding ? slug.trim() : undefined,
      governorateId: kind === 'district' ? governorateId : null,
    };
    const problem = taxonomyProblem(draft);
    if (problem) {
      setError(t(`admin.errors.${problem}`));
      return;
    }
    setError(null);
    Keyboard.dismiss();
    onSubmit(
      adding
        ? {
            lever: { do: 'taxonomy', kind, id: null, nameAr: draft.nameAr, nameEn: draft.nameEn, slug: draft.slug, governorateId: draft.governorateId },
            title: t('app.admin.taxonomy.addTitle', { name: draft.nameAr }),
            body: t('app.admin.taxonomy.addBody', { name: draft.nameAr }),
            confirmLabel: t('admin.addEntry'),
            reason: 'none',
          }
        : {
            // No slug: the website's rename never sends one, and the database would refuse a change.
            lever: { do: 'taxonomy', kind, id: entry.id, nameAr: draft.nameAr, nameEn: draft.nameEn, governorateId: draft.governorateId },
            title: t('app.admin.taxonomy.renameTitle', { name: entry.name_ar }),
            body: t('app.admin.taxonomy.renameBody'),
            confirmLabel: t('admin.rename'),
            reason: 'none',
          },
    );
  };

  return (
    <Modal visible={visible} onDismiss={onDismiss} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardRoom>
        <View style={{ flex: 1, direction: appDirection, backgroundColor: colors.background }} {...fence}>
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
              style={{ minWidth: hitTarget, minHeight: hitTarget, marginStart: -(hitTarget - 22) / 2, alignItems: 'center', justifyContent: 'center' }}
            >
              <X size={22} color={colors.foreground} />
            </Pressable>
            <Text weight="semibold" accessibilityRole="header" style={{ flex: 1 }}>
              {title}
            </Text>
          </View>

          <ScrollView
            automaticallyAdjustKeyboardInsets
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: gutter, gap: space[4], paddingBottom: insets.bottom + space[6] }}
          >
            <Field label={t('admin.nameAr')}>
              <TextField
                value={nameAr}
                onChangeText={(next) => {
                  setNameAr(next);
                  if (error) setError(null);
                }}
                accessibilityLabel={t('admin.nameAr')}
                maxLength={NAME_MAX}
              />
            </Field>
            <Field label={t('admin.nameEn')}>
              <TextField
                value={nameEn}
                onChangeText={(next) => {
                  setNameEn(next);
                  if (error) setError(null);
                }}
                accessibilityLabel={t('admin.nameEn')}
                maxLength={NAME_MAX}
                ltr
                autoCapitalize="words"
              />
            </Field>
            {adding ? (
              <Field label={t('admin.colSlug')} hint={t('admin.slugPermanent')}>
                <TextField
                  value={slug}
                  // Lowercase as typed, as the website's field keeps it.
                  onChangeText={(next) => {
                    setSlug(next.toLowerCase());
                    if (error) setError(null);
                  }}
                  accessibilityLabel={t('admin.colSlug')}
                  placeholder={t('admin.slugPlaceholder')}
                  maxLength={SLUG_MAX}
                  ltr
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </Field>
            ) : (
              <View style={{ gap: 2 }}>
                <Text variant="small" weight="medium">
                  {t('admin.colSlug')}
                </Text>
                <Text variant="small" selectable style={{ writingDirection: 'ltr' }}>
                  {entry.slug}
                </Text>
                <Text variant="caption" tone="mutedForeground">
                  {t('admin.slugPermanent')}
                </Text>
              </View>
            )}
            {kind === 'district' ? (
              <Field label={t('admin.governorate')}>
                <Select
                  label={t('admin.governorate')}
                  value={governorateId}
                  options={governorates.map((g) => ({ value: g.id, label: localized(locale, g.name_ar, g.name_en) }))}
                  placeholder={t('admin.governorate')}
                  required
                  onChange={(next) => {
                    setGovernorateId(next);
                    if (error) setError(null);
                  }}
                />
              </Field>
            ) : null}

            {error ? <Notice tone="destructive">{error}</Notice> : null}

            <Button label={adding ? t('admin.addEntry') : t('admin.rename')} size="lg" disabled={!dirty} onPress={submit} />
            <Button label={t('common.cancel')} variant="ghost" onPress={onClose} />
          </ScrollView>
        </View>
      </KeyboardRoom>
    </Modal>
  );
}

/** The host's way of opening the form (TaxonomyFormHost), while one is drawn. */
const hosts = new Set<(target: TaxonomyFormTarget) => void>();

/** Ask for an entry to be added or renamed, in the form drawn once on the taxonomy screen. */
export function openTaxonomyForm(target: TaxonomyFormTarget) {
  for (const show of hosts) show(target);
}

/**
 * Where the form is drawn: once, beside the taxonomy screen's list, never in
 * a row — a row drawn again when the list is read again would take the sheet,
 * and the names half typed in it, with it. Submitted, the form goes first and
 * the decision sheet opens once it has gone (iOS presents nothing over a
 * sheet still closing).
 */
export function TaxonomyFormHost() {
  const sheet = useSheet();
  const [target, setTarget] = useState<{ id: number; target: TaxonomyFormTarget } | null>(null);
  const show = useRef(sheet.show);
  const next = useRef(0);
  useEffect(() => {
    show.current = sheet.show;
  });
  useEffect(() => {
    const open = (asked: TaxonomyFormTarget) => {
      next.current += 1;
      setTarget({ id: next.current, target: asked });
      show.current();
    };
    hosts.add(open);
    return () => {
      hosts.delete(open);
    };
  }, []);
  if (!sheet.mounted || !target) return null;
  return (
    <TaxonomyForm
      // A new target starts with its own names and no error.
      key={target.id}
      visible={sheet.open}
      onClose={() => {
        Keyboard.dismiss();
        sheet.hide();
      }}
      onDismiss={sheet.onDismiss}
      target={target.target}
      onSubmit={(decision) => sheet.hide(() => openDecision(decision))}
    />
  );
}
