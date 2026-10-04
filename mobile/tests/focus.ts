import { TextInput } from 'react-native';

/**
 * Which fields were given the keyboard, by their VoiceOver names, in order —
 * React Native's stand-in focuses nothing. Its `focus` is one mock shared by
 * every stand-in, so it is reset rather than restored.
 */
export function watchFocus() {
  const focused: string[] = [];
  const focus = jest
    .spyOn(TextInput.prototype as unknown as { focus: () => void }, 'focus')
    .mockImplementation(function (this: { props: { accessibilityLabel?: string } }) {
      focused.push(this.props.accessibilityLabel ?? '');
    });
  return { focused, undo: () => focus.mockReset() };
}
