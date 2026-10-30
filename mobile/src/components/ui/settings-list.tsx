import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, View } from 'react-native';
import { ForwardChevron } from '~/components/ui/icons';
import { Text } from '~/components/ui/text';
import { useLargeText } from '~/theme/large-text';
import { useTheme } from '~/theme/provider';
import { corner, hitTarget, space } from '~/theme/tokens';

/**
 * The account's settings as iOS draws a grouped list (the Account, Appearance,
 * Privacy and Support boards): rows on one card under a small title, each
 * with its sign, its name, what it is set to at the end, and a way onward.
 * The rule above each row starts after its icon; the first one's sits just
 * outside the card's top edge, where the card clips it.
 */
export function SettingsGroup({ title, footer, children }: { title?: string; footer?: string; children: ReactNode }) {
  const { colors, shadow } = useTheme();
  return (
    <View style={{ gap: space[2] }}>
      {title ? <SettingsTitle header>{title}</SettingsTitle> : null}
      <View style={{ ...corner('xl'), boxShadow: shadow.card }}>
        <View
          style={{
            ...corner('xl'),
            borderWidth: StyleSheet.hairlineWidth * 2,
            borderColor: colors.border,
            backgroundColor: colors.card,
            overflow: 'hidden',
          }}
        >
          <View style={{ marginTop: -StyleSheet.hairlineWidth * 2 }}>{children}</View>
        </View>
      </View>
      {footer ? (
        <Text variant="caption" tone="mutedForeground" style={{ paddingHorizontal: space[1] }}>
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

export function SettingsTitle({ children, header = false }: { children: string; header?: boolean }) {
  return (
    <Text
      variant="label"
      weight="semibold"
      tone="mutedForeground"
      accessibilityRole={header ? 'header' : undefined}
      style={{ paddingHorizontal: space[1] }}
    >
      {children}
    </Text>
  );
}

/** The row's frame: its sign, then the rest beside it under the rule. */
function RowFrame({ icon, destructive = false, children }: { icon?: ReactNode; destructive?: boolean; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <>
      {icon ? (
        <View
          style={{
            width: 32,
            height: 32,
            ...corner('md'),
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: destructive ? colors.destructiveMuted : colors.secondary,
          }}
        >
          {icon}
        </View>
      ) : null}
      <View
        style={{
          flex: 1,
          alignSelf: 'stretch',
          flexDirection: 'row',
          alignItems: 'center',
          gap: space[3],
          paddingVertical: space[2],
          paddingEnd: space[4],
          borderTopWidth: StyleSheet.hairlineWidth * 2,
          borderTopColor: colors.border,
        }}
      >
        {children}
      </View>
    </>
  );
}

function Words({ label, hint, destructive }: { label: string; hint?: string | null; destructive?: boolean }) {
  return (
    <View style={{ flex: 1, gap: space[0.5] }}>
      <Text tone={destructive ? 'destructive' : 'foreground'}>{label}</Text>
      {hint ? (
        <Text variant="caption" tone="mutedForeground">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * A row that opens something: its value (what it is set to) before the
 * chevron, read with the name by VoiceOver. At the largest text the value
 * goes under the name, where it has the width.
 */
export function SettingsRow({
  icon,
  label,
  hint,
  value,
  onPress,
  destructive = false,
  busy = false,
  testID,
}: {
  icon?: ReactNode;
  label: string;
  hint?: string | null;
  /** What it is set to, as words or a drawn value (a count in `Num`). */
  value?: ReactNode;
  onPress: () => void;
  destructive?: boolean;
  /** Its action is under way: said, and not started twice. */
  busy?: boolean;
  testID?: string;
}) {
  const { colors } = useTheme();
  const large = useLargeText();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ busy, disabled: busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: hitTarget + 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        paddingStart: space[4],
        backgroundColor: pressed ? colors.muted : 'transparent',
      })}
    >
      <RowFrame icon={icon} destructive={destructive}>
        {large && value ? (
          <View style={{ flex: 1, gap: space[0.5] }}>
            <Words label={label} hint={hint} destructive={destructive} />
            {typeof value === 'string' ? (
              <Text variant="small" tone="mutedForeground">
                {value}
              </Text>
            ) : (
              value
            )}
          </View>
        ) : (
          <>
            <Words label={label} hint={hint} destructive={destructive} />
            {typeof value === 'string' ? (
              <Text variant="small" tone="mutedForeground" numberOfLines={large ? undefined : 1} style={{ maxWidth: '45%' }}>
                {value}
              </Text>
            ) : (
              value
            )}
          </>
        )}
        {busy ? <ActivityIndicator color={colors.mutedForeground} /> : <ForwardChevron size={18} color={colors.mutedForeground} />}
      </RowFrame>
    </Pressable>
  );
}

/** A row that is a switch: the whole row is the switch to VoiceOver, named by its words. */
export function SwitchRow({
  icon,
  label,
  hint,
  value,
  onChange,
  disabled = false,
  testID,
}: {
  icon?: ReactNode;
  label: string;
  hint?: string | null;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        minHeight: hitTarget + 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        paddingStart: space[4],
      }}
    >
      <RowFrame icon={icon}>
        <Words label={label} hint={hint} />
        <Switch
          testID={testID}
          value={value}
          onValueChange={onChange}
          disabled={disabled}
          accessibilityLabel={label}
          accessibilityHint={hint ?? undefined}
          trackColor={{ true: colors.primary, false: colors.input }}
        />
      </RowFrame>
    </View>
  );
}

/** One answer of several, as a row with a tick at the end when it is chosen: a radio button to VoiceOver. */
export function ChoiceRow({
  label,
  hint,
  trailing,
  selected,
  onPress,
  disabled = false,
}: {
  label: string;
  hint?: string | null;
  /** Drawn before the tick: a sample of the choice ("12,000 ج.م"). */
  trailing?: ReactNode;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      accessibilityLabel={hint ? `${label}. ${hint}` : label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: hitTarget + 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        paddingStart: space[4],
        backgroundColor: pressed ? colors.muted : 'transparent',
      })}
    >
      <RowFrame>
        <Words label={label} hint={hint} />
        {trailing}
        <View
          style={{
            width: 22,
            height: 22,
            ...corner('full'),
            borderWidth: selected ? 7 : 1.5,
            borderColor: selected ? colors.primary : colors.input,
            backgroundColor: colors.card,
          }}
        />
      </RowFrame>
    </Pressable>
  );
}
