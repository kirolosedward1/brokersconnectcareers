import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { monthNames, MonthField, readMonth } from '~/components/ui/month-field';
import { catalogues, I18nProvider } from '~/i18n/provider';
import { ThemeProvider } from '~/theme/provider';

/*
  A year and a month, picked rather than typed: the field says the month in
  words, and its sheet has the years beside the twelve months, so any month
  is two taps away. A date that may be left empty can be emptied again.
*/

const ar = catalogues.ar;
const metrics = { frame: { x: 0, y: 0, width: 393, height: 852 }, insets: { top: 59, left: 0, right: 0, bottom: 34 } };
const changes: string[] = [];

function Form({ start = '', clearLabel }: { start?: string; clearLabel?: string }) {
  const [value, setValue] = useState(start);
  return (
    <MonthField
      label="بداية"
      value={value}
      clearLabel={clearLabel}
      onChange={(next) => {
        changes.push(next);
        setValue(next);
      }}
    />
  );
}

function draw(props: { start?: string; clearLabel?: string } = {}) {
  changes.length = 0;
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <I18nProvider>
          <Form {...props} />
        </I18nProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );
}

it("names the months as Egypt does, in Arabic, and in English", () => {
  expect(monthNames('ar')).toEqual(['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']);
  expect(monthNames('en')[0]).toBe('January');
});

it('reads only a year and a month', () => {
  expect(readMonth('2024-03')).toEqual({ year: 2024, month: 3 });
  expect(readMonth('٢٠٢٤-٠٣')).toEqual({ year: 2024, month: 3 });
  expect(readMonth('2024-13')).toBeNull();
  expect(readMonth('')).toBeNull();
});

it('says the month in words, or what to do while it is empty', () => {
  draw({ start: '2024-03' });
  expect(screen.getByRole('button', { name: 'بداية: مارس 2024' })).toBeTruthy();
  draw();
  expect(screen.getByRole('button', { name: `بداية: ${ar.app.profile.monthChoose}` })).toBeTruthy();
});

it('is two taps: a year, then a month, which fills the field and closes the sheet', () => {
  draw({ start: '2024-03' });
  fireEvent.press(screen.getByRole('button', { name: 'بداية: مارس 2024' }));
  // The field's own month is the one ticked.
  expect(screen.getByRole('radio', { name: 'مارس 2024' }).props.accessibilityState).toEqual({ checked: true, disabled: false });

  fireEvent.press(screen.getByRole('radio', { name: '2021' }));
  fireEvent.press(screen.getByRole('radio', { name: 'مايو 2021' }));
  expect(changes).toEqual(['2021-05']);
  expect(screen.getByRole('button', { name: 'بداية: مايو 2021' })).toBeTruthy();
  expect(screen.queryByRole('radio', { name: 'مايو 2021' })).toBeNull();
});

it('can be emptied again only where it may be left empty', () => {
  draw({ start: '2024-03' });
  fireEvent.press(screen.getByRole('button', { name: 'بداية: مارس 2024' }));
  expect(screen.queryByRole('button', { name: ar.app.profile.stillThere })).toBeNull();

  draw({ start: '2024-03', clearLabel: ar.app.profile.stillThere });
  fireEvent.press(screen.getByRole('button', { name: 'بداية: مارس 2024' }));
  fireEvent.press(screen.getByRole('button', { name: ar.app.profile.stillThere }));
  expect(changes).toEqual(['']);
  expect(screen.getByRole('button', { name: `بداية: ${ar.app.profile.monthChoose}` })).toBeTruthy();
});
