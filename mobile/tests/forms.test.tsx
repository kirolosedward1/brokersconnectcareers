import { useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Keyboard, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Field } from '~/components/ui/field';
import { PasswordField } from '~/components/ui/password-field';
import { Select } from '~/components/ui/select';
import { TextField } from '~/components/ui/text-field';
import { TextLink } from '~/components/ui/text-link';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { useErrorFeedback } from '~/lib/haptics';
import { useErrorsInView } from '~/lib/use-errors-in-view';
import { ThemeProvider } from '~/theme/provider';
import { hitTarget, palette } from '~/theme/tokens';

/*
  A form, as a finger and VoiceOver meet it: a field with an error looks it
  and says it wherever the reader is; a password can be seen before it is
  sent; the keyboard can always be put away, and moves on from one line to
  the next; a refused form is felt as well as read; and a link on a line of
  its own is a target a finger can find.
*/

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

const ar = catalogues.ar;
const light = palette.light;
const notify = Haptics.notificationAsync as jest.Mock;
const click = Haptics.selectionAsync as jest.Mock;

beforeEach(() => {
  notify.mockClear();
  click.mockClear();
});

const metrics = { frame: { x: 0, y: 0, width: 440, height: 956 }, insets: { top: 62, bottom: 34, left: 0, right: 0 } };

function Providers({ children }: { children: ReactNode }) {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <I18nProvider>{children}</I18nProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

/** The colour a field's edge is drawn in: the nearest view around it that has an edge. */
function edgeOf(element: ReturnType<typeof screen.getByLabelText>): unknown {
  let node: typeof element | null = element.parent;
  while (node) {
    const style = StyleSheet.flatten(node.props.style) as { borderColor?: unknown } | undefined;
    if (style?.borderColor !== undefined) return style.borderColor;
    node = node.parent;
  }
  return undefined;
}

describe('a field with an error', () => {
  function Name({ error }: { error?: string }) {
    return (
      <Field label="name" error={error}>
        <TextField accessibilityLabel="name" />
      </Field>
    );
  }

  it("is edged in the error's colour, and in ink again once it is right", () => {
    const view = render(<Name error="required" />, { wrapper: Providers });
    expect(edgeOf(screen.getByLabelText('name'))).toBe(light.destructive);
    view.rerender(<Name />);
    expect(edgeOf(screen.getByLabelText('name'))).toBe(light.input);
  });

  it('is edged as the field being typed in while it has the cursor', () => {
    render(<Name error="required" />, { wrapper: Providers });
    fireEvent(screen.getByLabelText('name'), 'focus');
    expect(edgeOf(screen.getByLabelText('name'))).toBe(light.primary);
    fireEvent(screen.getByLabelText('name'), 'blur');
    expect(edgeOf(screen.getByLabelText('name'))).toBe(light.destructive);
  });

  it('gives VoiceOver the error on the field itself, not only on the words under it', () => {
    render(<Name error="required" />, { wrapper: Providers });
    expect(screen.getByLabelText('name').props.accessibilityHint).toBe('required');
    expect(screen.getByRole('alert', { name: 'required' })).toBeTruthy();
  });

  it('keeps a hint its form gave it', () => {
    render(
      <Field label="name" error="required">
        <TextField accessibilityLabel="name" accessibilityHint="as on your ID" />
      </Field>,
      { wrapper: Providers },
    );
    expect(screen.getByLabelText('name').props.accessibilityHint).toBe('as on your ID');
  });

  it('is a select edged and hinted the same way', () => {
    render(
      <Field label="experience" error="required">
        <Select label="experience" value={null} placeholder="choose" options={[{ value: 'a', label: 'A' }]} onChange={() => {}} />
      </Field>,
      { wrapper: Providers },
    );
    const select = screen.getByRole('button', { name: 'experience: choose' });
    expect(select.props.accessibilityHint).toBe('required');
    expect(StyleSheet.flatten(select.props.style).borderColor).toBe(light.destructive);
  });
});

describe('a select', () => {
  function Experience() {
    const [value, setValue] = useState<string | null>('a');
    return (
      <Select
        label="experience"
        value={value}
        placeholder="choose"
        required
        options={[
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ]}
        onChange={setValue}
      />
    );
  }

  it('says whether its choices are open, and clicks for a new choice only', async () => {
    render(<Experience />, { wrapper: Providers });
    const select = () => screen.getByRole('button', { name: /^experience: / });
    expect(select().props.accessibilityState).toMatchObject({ expanded: false });

    fireEvent.press(select());
    expect(select().props.accessibilityState).toMatchObject({ expanded: true });
    fireEvent.press(screen.getByRole('radio', { name: 'A' }));
    expect(click).not.toHaveBeenCalled();

    // Opened again once the first sheet has gone (src/lib/sheet-gate.ts).
    fireEvent.press(select());
    fireEvent.press(await screen.findByRole('radio', { name: 'B' }, { timeout: 2000 }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(select()).toHaveProp('accessibilityLabel', 'experience: B');
  });
});

describe('a password', () => {
  const password = () => screen.getByLabelText(ar.auth.password);

  it('is hidden, typed left to right, with nothing guessing at it', () => {
    render(<PasswordField accessibilityLabel={ar.auth.password} />, { wrapper: Providers });
    expect(password().props.secureTextEntry).toBe(true);
    expect(password().props.autoCapitalize).toBe('none');
    expect(password().props.autoCorrect).toBe(false);
    expect(StyleSheet.flatten(password().props.style).writingDirection).toBe('ltr');
  });

  it('is shown and hidden again with the eye at its end, which says what it will do', () => {
    render(<PasswordField accessibilityLabel={ar.auth.password} />, { wrapper: Providers });
    fireEvent.press(screen.getByRole('button', { name: ar.app.auth.showPassword }));
    expect(password().props.secureTextEntry).toBe(false);
    fireEvent.press(screen.getByRole('button', { name: ar.app.auth.hidePassword }));
    expect(password().props.secureTextEntry).toBe(true);
  });

  it('is hidden again when the field is left, so it does not stay on the screen', () => {
    const onBlur = jest.fn();
    render(<PasswordField accessibilityLabel={ar.auth.password} onBlur={onBlur} />, { wrapper: Providers });
    fireEvent.press(screen.getByRole('button', { name: ar.app.auth.showPassword }));
    fireEvent(password(), 'blur');
    expect(password().props.secureTextEntry).toBe(true);
    expect(onBlur).toHaveBeenCalled();
  });
});

describe('the keyboard', () => {
  it('says "done" on a line\'s return key, unless the form gives it another word', () => {
    render(
      <>
        <TextField accessibilityLabel="plain" />
        <TextField accessibilityLabel="moves on" returnKeyType="next" />
        <TextField accessibilityLabel="note" multiline />
      </>,
      { wrapper: Providers },
    );
    expect(screen.getByLabelText('plain').props.returnKeyType).toBe('done');
    expect(screen.getByLabelText('moves on').props.returnKeyType).toBe('next');
    // A note's return key starts a new line.
    expect(screen.getByLabelText('note').props.returnKeyType).toBeUndefined();
  });

  it('carries a Done above the phone and number pads, which have no return key, that puts it away', () => {
    const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
    render(
      <>
        <TextField accessibilityLabel="whatsapp" keyboardType="phone-pad" />
        <TextField accessibilityLabel="email" keyboardType="email-address" />
      </>,
      { wrapper: Providers },
    );
    expect(screen.getByLabelText('whatsapp').props.inputAccessoryViewID).toEqual(expect.any(String));
    expect(screen.getByLabelText('email').props.inputAccessoryViewID).toBeUndefined();

    const done = screen.getAllByRole('button', { name: ar.app.keyboard.done });
    expect(done).toHaveLength(1);
    fireEvent.press(done[0]);
    expect(dismiss).toHaveBeenCalled();
    dismiss.mockRestore();
  });
});

describe('a refused form', () => {
  it('is felt when its errors are brought into view, every time it is refused', () => {
    jest.spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions').mockImplementation(() => {});
    function Form() {
      const scroll = useRef<ScrollView>(null);
      const form = useErrorsInView(scroll, ['name']);
      return (
        <ScrollView ref={scroll}>
          <View ref={form.place('name')} />
          <Pressable accessibilityRole="button" onPress={() => form.show({ name: 'required' })}>
            <Text>send</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => form.show({})}>
            <Text>send right</Text>
          </Pressable>
        </ScrollView>
      );
    }
    render(<Form />);
    fireEvent.press(screen.getByRole('button', { name: 'send' }));
    fireEvent.press(screen.getByRole('button', { name: 'send' }));
    expect(notify.mock.calls).toEqual([['error'], ['error']]);

    fireEvent.press(screen.getByRole('button', { name: 'send right' }));
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('is felt as its one message appears or changes, not while it only stays', () => {
    function Message({ error, other }: { error: string | null; other: number }) {
      useErrorFeedback(error);
      return <Text>{`${error ?? ''}${other}`}</Text>;
    }
    const view = render(<Message error={null} other={0} />);
    expect(notify).not.toHaveBeenCalled();
    view.rerender(<Message error="wrong password" other={0} />);
    expect(notify).toHaveBeenCalledTimes(1);
    view.rerender(<Message error="wrong password" other={1} />);
    expect(notify).toHaveBeenCalledTimes(1);
    view.rerender(<Message error="slow down" other={1} />);
    expect(notify).toHaveBeenCalledTimes(2);
    act(() => view.rerender(<Message error={null} other={1} />));
    expect(notify).toHaveBeenCalledTimes(2);
  });
});

describe('a link on a line of its own', () => {
  it('is a link a finger can find: 44 points tall, whatever its words', () => {
    const onPress = jest.fn();
    render(<TextLink label={ar.auth.forgotPassword} onPress={onPress} />, { wrapper: Providers });
    const link = screen.getByRole('link', { name: ar.auth.forgotPassword });
    expect(StyleSheet.flatten(link.props.style).minHeight).toBe(hitTarget);
    fireEvent.press(link);
    expect(onPress).toHaveBeenCalled();
  });
});
