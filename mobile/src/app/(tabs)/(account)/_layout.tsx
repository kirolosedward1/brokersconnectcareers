import { Stack } from 'expo-router';
import { useStackOptions } from '~/components/navigation/stack-options';

/** The Account tab's own stack: the account screen, and deleting the account pushed over it. */
export const unstable_settings = {
  anchor: 'account/index',
};

export default function AccountStack() {
  return <Stack screenOptions={useStackOptions()} />;
}
