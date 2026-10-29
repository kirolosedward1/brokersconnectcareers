import type { ComponentProps } from 'react';
import { useMoney } from '~/features/money';
import { NUM_STYLE } from './num';
import { Text } from './text';

type Props = Omit<ComponentProps<typeof Text>, 'children'> & {
  value: number;
  /** The currency's size, when it is set smaller than the figure. */
  unitVariant?: ComponentProps<typeof Text>['variant'];
};

/**
 * An amount of money on its own line — a balance, a price, a sales volume —
 * the figure as Num draws it, its currency beside it (useMoney), and both
 * read by VoiceOver as one.
 */
export function Money({ value, unitVariant, variant, weight, tone, ...props }: Props) {
  const money = useMoney();
  return (
    <Text variant={variant} weight={weight} tone={tone} accessibilityLabel={money.amount(value)} {...props}>
      <Text variant={variant} weight={weight} tone={tone} style={NUM_STYLE}>
        {money.figure(value)}
      </Text>
      <Text variant={unitVariant ?? variant} tone="mutedForeground">{` ${money.unit}`}</Text>
    </Text>
  );
}
