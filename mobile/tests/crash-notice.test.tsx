import { Alert, Share } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { CrashNotice } from '~/components/navigation/crash-notice';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { readLastCrash } from '~/lib/crash-log';
import { ThemeProvider } from '~/theme/provider';

/*
  After the app closed on an error of its own: a notice at the top of Home —
  not an alert as the app starts, which Apple asks apps not to show — that
  sends the details on or is put away, and stays until it is answered.
*/

const ar = catalogues.ar;
const crash = { message: 'undefined is not a function', stack: 'at x', fatal: true, at: '2026-10-01T10:00:00.000Z', version: '1.0.0' };

beforeEach(async () => {
  await AsyncStorage.clear();
});

async function draw() {
  render(
    <ThemeProvider>
      <I18nProvider>
        <CrashNotice />
      </I18nProvider>
    </ThemeProvider>,
  );
  await act(async () => {});
}

it('says nothing after a launch that followed no crash', async () => {
  await draw();
  expect(screen.queryByTestId('crash-notice')).toBeNull();
});

it('says so in the page, not in an alert, and is put away with "Not now"', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  try {
    await AsyncStorage.setItem('bc.last-crash.v1', JSON.stringify(crash));
    await draw();
    expect(screen.getByText(ar.app.crash.title)).toBeTruthy();
    expect(alert).not.toHaveBeenCalled();
    // Still kept until it is answered: a launch that never passes Home does not lose it.
    expect(await readLastCrash()).not.toBeNull();

    fireEvent.press(screen.getByRole('button', { name: ar.app.crash.dismiss }));
    await act(async () => {});
    expect(screen.queryByTestId('crash-notice')).toBeNull();
    expect(await readLastCrash()).toBeNull();
  } finally {
    alert.mockRestore();
  }
});

it('hands the details to the share sheet', async () => {
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction, activityType: undefined });
  try {
    await AsyncStorage.setItem('bc.last-crash.v1', JSON.stringify(crash));
    await draw();
    fireEvent.press(screen.getByRole('button', { name: ar.app.crash.send }));
    await act(async () => {});
    expect(share).toHaveBeenCalledWith({ message: expect.stringContaining(crash.message) });
    expect(screen.queryByTestId('crash-notice')).toBeNull();
    expect(await readLastCrash()).toBeNull();
  } finally {
    share.mockRestore();
  }
});
