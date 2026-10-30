import { didYouMean, suggestionsFor } from '~/features/jobs/suggestions';

/*
  What the Search screen offers as letters are typed (v1.1): the words
  folded the way the website reads Arabic, run together or split apart, in
  either language — and «هل تقصد» a track and a place, each named by its own
  words of the query.
*/

const districts = [
  { id: 1, slug: 'new-cairo', name_ar: 'التجمع الخامس', name_en: 'Fifth Settlement' },
  { id: 2, slug: 'sheikh-zayed', name_ar: 'الشيخ زايد', name_en: 'Sheikh Zayed' },
];
const sources = { locale: 'ar', districts, aliases: [], listings: [] };

describe('«هل تقصد»', () => {
  it('reads «اوفبلان تجمع» as off-plan sales in the Fifth Settlement', () => {
    expect(didYouMean('اوفبلان تجمع', sources)).toEqual({ track: 'primary', slug: 'new-cairo', label: 'بيع أوف بلان · التجمع الخامس' });
  });

  it('takes the words in either order, with the article or without', () => {
    expect(didYouMean('التجمع أوف بلان', sources)?.slug).toBe('new-cairo');
    expect(didYouMean('ريسيل زايد', sources)).toEqual({ track: 'resale', slug: 'sheikh-zayed', label: 'ريسيل · الشيخ زايد' });
  });

  it('says nothing for one word, or words that name only one of the two', () => {
    expect(didYouMean('اوفبلان', sources)).toBeNull();
    expect(didYouMean('اوفبلان مدير', sources)).toBeNull();
  });
});

describe('a suggestion', () => {
  it('finds a name whatever the spaces: «اوفبلان» is «أوف بلان», and the hamza is no matter', () => {
    const found = suggestionsFor('اوفبلان', sources);
    expect(found.map((suggestion) => suggestion.key)).toContain('track:primary');
  });

  it("finds a track by its English name", () => {
    expect(suggestionsFor('resale', sources).map((suggestion) => suggestion.key)).toContain('track:resale');
  });

  it('offers what each word names alone when the words name nothing together', () => {
    const keys = suggestionsFor('اوفبلان تجمع', sources).map((suggestion) => suggestion.key);
    expect(keys).toEqual(expect.arrayContaining(['district:new-cairo', 'track:primary']));
  });
});
