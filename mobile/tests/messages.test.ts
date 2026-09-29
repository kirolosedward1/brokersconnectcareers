import appAr from '~/i18n/messages/ar.json';
import appEn from '~/i18n/messages/en.json';
import { catalogues } from '~/i18n/provider';

/** Every key path in a catalogue, leaves only. */
function keys(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    keys(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("the app's own strings", () => {
  it('say the same things in Arabic and English', () => {
    expect(keys(appEn).sort()).toEqual(keys(appAr).sort());
  });

  it('are never empty', () => {
    for (const catalogue of [appAr, appEn]) {
      for (const path of keys(catalogue)) {
        const text = path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], catalogue);
        expect(typeof text === 'string' && text.trim().length > 0).toBe(true);
      }
    }
  });

  it("sit under `app`, beside the website's catalogue and never over it", () => {
    expect(Object.keys(catalogues.ar)).toContain('jobs');
    expect(catalogues.ar.app).toBe(appAr);
    expect(catalogues.en.app).toBe(appEn);
  });
});
