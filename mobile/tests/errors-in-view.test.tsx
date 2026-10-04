import { useRef } from 'react';
import { AccessibilityInfo, Pressable, ScrollView, Text, View } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useErrorsInView } from '~/lib/use-errors-in-view';

/*
  A form's button is at its bottom and each error under its field, higher up:
  on a small phone, or with the keyboard up, out of sight, so that pressing
  the button seemed to do nothing — and iOS reads no error out by itself. The
  first error on the page is brought into view, its label showing, and said.
*/

type Placed = { props: { testID?: string } };

/** Where each field sits in the form, as the phone would measure it. */
const AT: Record<string, number> = { name: 120, phone: 480 };

const announce = AccessibilityInfo.announceForAccessibilityWithOptions as jest.Mock;
let scrollTo: jest.SpyInstance;

beforeEach(() => {
  announce.mockClear();
  const content = { the: 'content' };
  jest.spyOn(ScrollView.prototype as unknown as { getInnerViewRef: () => unknown }, 'getInnerViewRef').mockReturnValue(content);
  jest
    .spyOn(View.prototype as unknown as { measureLayout: (...args: unknown[]) => void }, 'measureLayout')
    .mockImplementation(function (this: Placed, relativeTo: unknown, onSuccess: unknown) {
      if (relativeTo === content) (onSuccess as (x: number, y: number) => void)(0, AT[this.props.testID ?? ''] ?? 0);
    });
  // React Native's stand-in already holds a mock here, shared by every scroll view: its calls are cleared, not replaced.
  scrollTo = jest.spyOn(ScrollView.prototype as unknown as { scrollTo: (...args: unknown[]) => void }, 'scrollTo');
  scrollTo.mockClear();
});

afterEach(() => jest.restoreAllMocks());

function Form({ errors, above }: { errors: Record<string, string>; above?: number }) {
  const scroll = useRef<ScrollView>(null);
  const form = useErrorsInView(scroll, ['name', 'phone'], { above });
  return (
    <ScrollView ref={scroll}>
      <View ref={form.place('name')} testID="name">
        <Text>name</Text>
      </View>
      <View ref={form.place('phone')} testID="phone">
        <Text>phone</Text>
      </View>
      <Pressable accessibilityRole="button" onPress={() => form.show(errors)}>
        <Text>send</Text>
      </Pressable>
    </ScrollView>
  );
}

describe('errors brought into view', () => {
  it('scrolls to the field with the error, its label in sight, and says the error', async () => {
    render(<Form errors={{ phone: 'the number is not a phone number' }} />);
    fireEvent.press(screen.getByRole('button', { name: 'send' }));
    expect(announce).toHaveBeenCalledWith('the number is not a phone number', { queue: true });
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ y: 480 - 16, animated: true }));
  });

  it('goes to the first on the page when there are several, whatever order they were found in', async () => {
    render(<Form errors={{ phone: 'the number is not a phone number', name: 'a name is needed' }} />);
    fireEvent.press(screen.getByRole('button', { name: 'send' }));
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ y: 120 - 16, animated: true }));
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('a name is needed', { queue: true });
  });

  it('keeps the field clear of a status bar the page is drawn under', async () => {
    render(<Form errors={{ phone: 'the number is not a phone number' }} above={59} />);
    fireEvent.press(screen.getByRole('button', { name: 'send' }));
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ y: 480 - 16 - 59, animated: true }));
  });

  it("says the form's own refusal, which sits by the button already, without moving the page", async () => {
    render(<Form errors={{ form: 'something went wrong' }} />);
    fireEvent.press(screen.getByRole('button', { name: 'send' }));
    expect(announce).toHaveBeenCalledWith('something went wrong', { queue: true });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('does nothing when there is nothing wrong', () => {
    render(<Form errors={{ name: '' }} />);
    fireEvent.press(screen.getByRole('button', { name: 'send' }));
    expect(announce).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
