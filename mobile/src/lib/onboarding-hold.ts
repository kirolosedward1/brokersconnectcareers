import { useSyncExternalStore } from 'react';

/**
 * A screen making the account itself, so the session gate does not send the
 * person to onboarding meanwhile: the apply screen, when somebody with no
 * account signs up with Apple or Google from inside it — the application is
 * sent first, with the profile it needs made there, and the rest of
 * onboarding follows it (v1.1). Released when that screen is done or left;
 * a session still without a profile then goes to onboarding as any other.
 */
let holds = 0;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

/** Hold the gate; the function returned lets go (once, however often it is called). */
export function holdOnboarding(): () => void {
  holds += 1;
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds -= 1;
    emit();
  };
}

export function useOnboardingHeld(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => holds > 0,
  );
}
