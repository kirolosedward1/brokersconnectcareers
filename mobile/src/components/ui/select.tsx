import { useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Check, ChevronDown, X } from '~/components/ui/lucide';
import { useTranslations } from 'use-intl';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '~/theme/provider';
import { corner, hitTarget, space } from '~/theme/tokens';
import { Text } from './text';

export type SelectOption<T extends string | number> = { value: T; label: string };

/**
 * The website's <select>, as a phone does it: a field that says what is
 * chosen, and a sheet listing the choices with a tick on the current one.
 * `placeholder` doubles as the empty choice ("optional") when the field may
 * be left unset, exactly as the website's first <option value="">; a
 * `required` one offers no empty choice, as a <select> without it.
 */
export function Select<T extends string | number>({
  label,
  value,
  options,
  placeholder,
  onChange,
  required = false,
}: {
  label: string;
  value: T | null;
  options: SelectOption<T>[];
  /** Shown when nothing is chosen; also offered as a choice, to unset it — unless `required`. */
  placeholder: string;
  onChange: (value: T | null) => void;
  required?: boolean;
}) {
  const t = useTranslations('common');
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value) ?? null;

  const choose = (next: T | null) => {
    onChange(next);
    setOpen(false);
  };

  const rows: { value: T | null; label: string }[] = required ? options : [{ value: null, label: placeholder }, ...options];

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current?.label ?? placeholder}`}
        onPress={() => setOpen(true)}
        style={({ pressed }) => ({
          minHeight: hitTarget + 6,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: space[2],
          paddingHorizontal: space[4] - 2,
          ...corner('lg'),
          borderWidth: 1,
          borderColor: colors.input,
          backgroundColor: pressed ? colors.muted : colors.card,
        })}
      >
        <Text tone={current ? 'foreground' : 'mutedForeground'} numberOfLines={1} style={{ flexShrink: 1 }}>
          {current?.label ?? placeholder}
        </Text>
        <ChevronDown size={18} color={colors.mutedForeground} />
      </Pressable>

      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: space[4],
              paddingVertical: space[3],
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderBottomColor: colors.border,
            }}
          >
            <Text variant="headline" weight="semibold" accessibilityRole="header">
              {label}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('close')}
              onPress={() => setOpen(false)}
              hitSlop={10}
              style={{ minWidth: hitTarget, minHeight: hitTarget, alignItems: 'center', justifyContent: 'center' }}
            >
              <X size={20} color={colors.foreground} />
            </Pressable>
          </View>
          <FlatList
            data={rows}
            keyExtractor={(row) => String(row.value ?? '')}
            contentContainerStyle={{ paddingBottom: insets.bottom + space[4] }}
            renderItem={({ item }) => {
              const selected = item.value === (current?.value ?? null);
              return (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  onPress={() => choose(item.value)}
                  style={({ pressed }) => ({
                    minHeight: hitTarget + 8,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: space[2],
                    paddingHorizontal: space[4],
                    backgroundColor: pressed ? colors.muted : 'transparent',
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: colors.border,
                  })}
                >
                  <Text tone={item.value === null ? 'mutedForeground' : 'foreground'} style={{ flexShrink: 1 }}>
                    {item.label}
                  </Text>
                  {selected ? <Check size={20} color={colors.primary} strokeWidth={2.5} /> : null}
                </Pressable>
              );
            }}
          />
        </View>
      </Modal>
    </>
  );
}
