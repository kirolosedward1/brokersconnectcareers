import { Alert, type AlertButton, type AlertOptions } from 'react-native';

/** One question or notice, as `Alert.alert` takes it. */
export type DialogRequest = {
  title: string;
  message?: string;
  buttons?: AlertButton[];
  options?: AlertOptions;
};

type Host = (request: DialogRequest) => void;
let host: Host | null = null;

/**
 * The app's own alerts and confirmations, asked exactly as `Alert.alert` is.
 * iOS lays its alert out in the phone's language — on an iPhone set to
 * English, or in Expo Go, the buttons of an Arabic question stood left to
 * right, "Cancel" on the left — so the app draws its own
 * (src/components/ui/dialog-host.tsx), in the app's direction. Before that
 * host is on screen (the first instants of a launch), the phone's own alert.
 */
export const dialog = {
  alert(...asked: Parameters<typeof Alert.alert>) {
    const [title, message, buttons, options] = asked;
    if (host) host({ title, message, buttons, options });
    else Alert.alert(...asked);
  },
};

/** The dialog host takes over the asking while it is mounted. */
export function registerDialogHost(next: Host): () => void {
  host = next;
  return () => {
    if (host === next) host = null;
  };
}
