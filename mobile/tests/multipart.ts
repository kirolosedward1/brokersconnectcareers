/**
 * What a form looks like on the wire from a phone.
 *
 * The app's fetch is Expo's (expo/src/winter replaces the global one), and it
 * turns a FormData into bytes itself, with rules of its own: a text value, a
 * Blob, or an object that reads its own bytes — anything else throws. The tests'
 * stand-in fetch (tests/server.ts) sends nothing anywhere, so a form it accepted
 * could still be one the phone cannot send; photos and logos were exactly that.
 * A test hands the form the app sent to this, and reads the request the website
 * would receive.
 */
import { convertFormDataAsync } from 'expo/src/winter/fetch/convertFormData';

/**
 * React Native's FormData as Expo patches it on the phone: each part kept as
 * given. The real patch, which jest-expo replaces with a no-op for every test.
 */
export function phoneFormData(): typeof FormData {
  const NativeFormData = jest.requireActual('react-native/Libraries/Network/FormData').default;
  const { installFormDataPatch } = jest.requireActual('expo/src/winter/FormData') as typeof import('expo/src/winter/FormData');
  installFormDataPatch(NativeFormData);
  return NativeFormData;
}

export async function sentBody(form: unknown): Promise<string> {
  const { body } = await convertFormDataAsync(form as FormData, 'boundary');
  return new TextDecoder().decode(body);
}
