import { useMemo } from 'react';
import { useIsFetching, useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { useLocale } from 'use-intl';
import type { JobFilters } from '@/lib/job-filters';
import type { JobListItem } from '@/lib/job-list';
import { localized } from '@/lib/locale';
import type { JobBoardResponse } from '@/lib/mobile-api/reads';
import { normaliseArabic, stripDefiniteArticle } from '@/lib/search/arabic';
import type { DistrictRow, JobTrack, SearchAliasRow } from '@/lib/supabase/database.types';
import { JOB_TRACKS } from '@/lib/taxonomy';
import { useHiddenCompanies, withoutHidden } from '~/features/moderation/hidden-companies';
import { useHiddenJobs, withoutHiddenJobs } from '~/features/moderation/hidden-jobs';
import { useDistricts } from '~/features/taxonomy';
import { catalogues } from '~/i18n/provider';
import { supabase } from '~/lib/supabase';

/**
 * What the filter sheet offers under its search field as the reader types:
 * the areas, the tracks, and the titles and companies of listings the board
 * has already shown, whose names hold what was typed. An area or a track is
 * a filter, more exact than the same words searched for; a title or a
 * company is the words themselves, spelled as the listings spell them.
 *
 * Matched the way the website's search reads Arabic (src/lib/search/arabic.ts):
 * أ إ آ as ا, ى as ي, ة as ه, no harakat or tatweel, Arabic-Indic digits as
 * Western — so «القاهره» finds «القاهرة الجديدة» and «اكتوبر» finds «أكتوبر».
 * Nothing is asked of the server for the listings: they are the ones already
 * read, so a suggestion never names a listing the reader could not have seen.
 */

/** Fewer letters than this match nearly everything. */
export const MIN_LETTERS = 2;
/** As many as fit above the keyboard on a small phone. */
const SHOWN = 6;
/** Of one kind, while another kind has something to offer too. */
const PER_KIND = 3;

/** Where the match is in the text shown: [start, end) in its UTF-16 units, harakat on its last letter included. */
export type Span = { start: number; end: number };

type Base = {
  key: string;
  /** What the row says, in the reader's language. */
  label: string;
  /** The name the match was found in: the label, or its other-language name or an alias, shown beneath it. */
  matched: string;
  span: Span;
};

export type SearchSuggestion =
  | (Base & { kind: 'district'; slug: string })
  | (Base & { kind: 'track'; track: JobTrack })
  | (Base & { kind: 'title' | 'company'; words: string });

/** The order the kinds are listed in: the filters first, then the words. */
const KINDS: SearchSuggestion['kind'][] = ['district', 'track', 'title', 'company'];

/**
 * Text folded the website's way, one character at a time, with where each
 * folded letter came from — so a match found in the folded text can be
 * highlighted in the text as written, harakat and all.
 */
type Folded = { text: string; from: number[] };

function fold(input: string): Folded {
  let text = '';
  const from: number[] = [];
  let index = 0;
  for (const character of input) {
    if (/\s/.test(character)) {
      // Runs of space are one space, and none at the start.
      if (text && !text.endsWith(' ')) {
        text += ' ';
        from.push(index);
      }
    } else {
      const folded = normaliseArabic(character);
      text += folded;
      for (let unit = 0; unit < folded.length; unit++) from.push(index);
    }
    index += character.length;
  }
  if (text.endsWith(' ')) {
    text = text.slice(0, -1);
    from.pop();
  }
  return { text, from };
}

/** How many letters (not spaces) the reader has typed, folded. */
export function typedLetters(typed: string): number {
  return fold(typed).text.replace(/ /g, '').length;
}

/** The start of a word, or of the word behind its article (ال, وال, بال, لل…). */
function atWordStart(text: string, at: number): boolean {
  if (at === 0 || text[at - 1] === ' ') return true;
  return /(?:^| )(?:[وفبك]?ال|لل)$/.test(text.slice(0, at));
}

/** How good a match is: the name's own start, a word's start, inside a word. Lower is better. */
type Found = { at: number; length: number; quality: number };

function find(name: Folded, needles: string[]): Found | null {
  for (const needle of needles) {
    let first: Found | null = null;
    for (let at = name.text.indexOf(needle); at !== -1; at = name.text.indexOf(needle, at + 1)) {
      const quality = at === 0 ? 0 : atWordStart(name.text, at) ? 1 : 2;
      if (quality < 2) return { at, length: needle.length, quality };
      first ??= { at, length: needle.length, quality };
    }
    if (first) return first;
  }
  return null;
}

/** The match, as a stretch of the text as written. */
function spanOf(original: string, name: Folded, found: Found): Span {
  const start = name.from[found.at];
  const last = name.from[found.at + found.length - 1];
  let end = last + String.fromCodePoint(original.codePointAt(last) ?? 0).length;
  // The marks over the last letter matched (a shadda, a fatha) go with it.
  while (end < original.length) {
    const character = String.fromCodePoint(original.codePointAt(end) ?? 0);
    if (/\s/.test(character) || normaliseArabic(character) !== '') break;
    end += character.length;
  }
  return { start, end };
}

/** The same text without its spaces, each letter still knowing where it came from: «اوفبلان» typed is «أوف بلان». */
function compact(folded: Folded): Folded {
  let text = '';
  const from: number[] = [];
  for (let index = 0; index < folded.text.length; index++) {
    if (folded.text[index] === ' ') continue;
    text += folded.text[index];
    from.push(folded.from[index]);
  }
  return { text, from };
}

/**
 * The first of `names` the typed words are found in, best match first. Words
 * run together or split apart («اوفبلان», «أوف بلان», «off plan», «offplan»)
 * still find the name, a step below a match as spelled.
 */
function bestOf(names: string[], needles: string[]): { name: string; span: Span; quality: number } | null {
  let best: { name: string; span: Span; quality: number } | null = null;
  const tight = [...new Set(needles.map((needle) => needle.replace(/ /g, '')))].filter((needle) => needle.length >= MIN_LETTERS);
  for (const name of names) {
    if (!name.trim()) continue;
    const folded = fold(name);
    let found = find(folded, needles);
    let within = folded;
    if (!found) {
      within = compact(folded);
      const loose = find(within, tight);
      found = loose ? { ...loose, quality: Math.min(loose.quality + 1, 2) } : null;
    }
    if (found && (!best || found.quality < best.quality)) best = { name, span: spanOf(name, within, found), quality: found.quality };
    if (best?.quality === 0) break;
  }
  return best;
}

export type SuggestionSources = {
  locale: string;
  districts: readonly Pick<DistrictRow, 'id' | 'slug' | 'name_ar' | 'name_en'>[];
  aliases: readonly Pick<SearchAliasRow, 'alias' | 'district_id' | 'track'>[];
  /** The listings already read, without what this phone hides. */
  listings: readonly JobListItem[];
};

/**
 * Up to six suggestions for what is typed (two letters at least), the
 * filters first: up to three of a kind while another kind has some to offer,
 * then whatever is left, each kind's best matches first — a name that starts
 * with the words, then a word that does, then the words inside a word.
 */
export function suggestionsFor(typed: string, { locale, districts, aliases, listings }: SuggestionSources): SearchSuggestion[] {
  const query = fold(typed).text;
  if (query.replace(/ /g, '').length < MIN_LETTERS) return [];
  // «التجمع» typed finds «تجمع» written too: the article is no part of the name.
  const stripped = stripDefiniteArticle(query);
  const needles = stripped !== query && stripped.length >= MIN_LETTERS ? [query, stripped] : [query];

  const found: (SearchSuggestion & { quality: number })[] = [];
  const places = districtMatches(needles, { locale, districts, aliases });
  const kinds = trackMatches(needles, { locale, aliases });
  found.push(...places, ...kinds);

  // A title or a company once, however many listings carry it.
  const said = new Set<string>();
  const companies = new Set<string>();
  for (const job of listings) {
    for (const title of [job.title_ar, job.title_en]) {
      if (!title?.trim()) continue;
      const key = fold(title).text;
      if (said.has(key)) continue;
      const match = bestOf([title], needles);
      if (!match) continue;
      said.add(key);
      found.push({ kind: 'title', key: `title:${key}`, words: title.trim(), label: title.trim(), matched: title.trim(), span: match.span, quality: match.quality });
    }
    if (companies.has(job.company.id)) continue;
    const name = bestOf([localized(locale, job.company.name_ar, job.company.name_en), (locale === 'en' ? job.company.name_ar : job.company.name_en) ?? ''], needles);
    if (!name) continue;
    companies.add(job.company.id);
    const words = name.name.trim();
    found.push({ kind: 'company', key: `company:${job.company.id}`, words, label: words, matched: words, span: name.span, quality: name.quality });
  }

  // Several words that name nothing together («اوفبلان تجمع»): what each names alone.
  if (!found.length && query.includes(' ')) {
    for (const word of wordsOf(query)) {
      for (const suggestion of [...districtMatches([word], { locale, districts, aliases }), ...trackMatches([word], { locale, aliases })]) {
        if (!found.some((other) => other.key === suggestion.key)) found.push(suggestion);
      }
    }
  }

  // Best first within each kind, the shorter name first between equals: it is the nearer one to what was typed.
  const ranked = found
    .map((suggestion, index) => ({ suggestion, index }))
    .sort(
      (a, b) =>
        a.suggestion.quality - b.suggestion.quality ||
        a.suggestion.matched.length - b.suggestion.matched.length ||
        a.index - b.index,
    )
    .map(({ suggestion }) => suggestion);

  const picked = new Set<(typeof found)[number]>();
  const taken = new Map<string, number>();
  for (const suggestion of ranked) {
    if (picked.size >= SHOWN) break;
    const count = taken.get(suggestion.kind) ?? 0;
    if (count >= PER_KIND) continue;
    picked.add(suggestion);
    taken.set(suggestion.kind, count + 1);
  }
  for (const suggestion of ranked) {
    if (picked.size >= SHOWN) break;
    picked.add(suggestion);
  }

  return [...picked]
    .sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || ranked.indexOf(a) - ranked.indexOf(b))
    .map(({ quality: _quality, ...suggestion }) => suggestion as SearchSuggestion);
}

type Ranked = SearchSuggestion & { quality: number };

/** The places a needle names, by any of their names or aliases. */
function districtMatches(
  needles: string[],
  { locale, districts, aliases }: Pick<SuggestionSources, 'locale' | 'districts' | 'aliases'>,
): Ranked[] {
  const found: Ranked[] = [];
  for (const district of districts) {
    const label = localized(locale, district.name_ar, district.name_en);
    const other = locale === 'en' ? district.name_ar : district.name_en;
    const also = aliases.filter((alias) => alias.district_id === district.id).map((alias) => alias.alias);
    const match = bestOf([label, other ?? '', ...also], needles);
    if (match) found.push({ kind: 'district', key: `district:${district.slug}`, slug: district.slug, label, matched: match.name, span: match.span, quality: match.quality });
  }
  return found;
}

/** The tracks a needle names, in either language or by an alias. */
function trackMatches(needles: string[], { locale, aliases }: Pick<SuggestionSources, 'locale' | 'aliases'>): Ranked[] {
  const found: Ranked[] = [];
  for (const track of JOB_TRACKS) {
    const label = (locale === 'en' ? catalogues.en : catalogues.ar).track[track];
    const other = (locale === 'en' ? catalogues.ar : catalogues.en).track[track];
    const also = aliases.filter((alias) => alias.track === track).map((alias) => alias.alias);
    const match = bestOf([label, other, ...also], needles);
    if (match) found.push({ kind: 'track', key: `track:${track}`, track, label, matched: match.name, span: match.span, quality: match.quality });
  }
  return found;
}

/** The words of a folded query, each with and without its article, long enough to mean something. */
function wordsOf(query: string): string[] {
  const words: string[] = [];
  for (const word of query.split(' ')) {
    if (word.length < MIN_LETTERS) continue;
    words.push(word);
    const bare = stripDefiniteArticle(word);
    if (bare !== word && bare.length >= MIN_LETTERS) words.push(bare);
  }
  return words;
}

/** «هل تقصد»: a track and a place, each named by its own words in what was typed. */
export type DidYouMean = { track: JobTrack; slug: string; label: string };

/**
 * One track and one place named by different words of the query —
 * «اوفبلان تجمع» is «بيع أوف بلان · التجمع الخامس» — the best of each.
 * Null for a query of one word, or one that names fewer than both.
 */
export function didYouMean(typed: string, sources: Pick<SuggestionSources, 'locale' | 'districts' | 'aliases'>): DidYouMean | null {
  const query = fold(typed).text;
  const words = query.split(' ').filter((word) => word.length >= MIN_LETTERS);
  if (words.length < 2) return null;
  let best: { track: Ranked & { kind: 'track' }; place: Ranked & { kind: 'district' }; quality: number } | null = null;
  for (const [index, trackWord] of words.entries()) {
    const kinds = trackMatches(wordsOf(trackWord), sources) as (Ranked & { kind: 'track' })[];
    if (!kinds.length) continue;
    const rest = words.filter((_, other) => other !== index).join(' ');
    const places = [...districtMatches([rest], sources), ...wordsOf(rest).flatMap((word) => districtMatches([word], sources))] as (Ranked & { kind: 'district' })[];
    for (const track of kinds) {
      for (const place of places) {
        const quality = track.quality + place.quality;
        if (!best || quality < best.quality) best = { track, place, quality };
      }
    }
  }
  return best ? { track: best.track.track, slug: best.place.slug, label: `${best.track.label} · ${best.place.label}` } : null;
}

/**
 * The board a suggestion asks for. An area or a track is added to the filters
 * already chosen, and the words that found it are let go: kept, they would
 * narrow the board to listings that also say them. A title or a company is
 * searched for, as written.
 */
export function withSuggestion(filters: JobFilters, suggestion: SearchSuggestion): JobFilters {
  switch (suggestion.kind) {
    case 'district':
      return {
        ...filters,
        q: '',
        districtSlugs: filters.districtSlugs.includes(suggestion.slug) ? filters.districtSlugs : [...filters.districtSlugs, suggestion.slug],
      };
    case 'track':
      return { ...filters, q: '', tracks: filters.tracks.includes(suggestion.track) ? filters.tracks : [...filters.tracks, suggestion.track] };
    case 'title':
    case 'company':
      return { ...filters, q: suggestion.words.slice(0, 120) };
  }
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * The other names of the places and tracks (migration 68): "Tagamoa" and
 * "Fifth Settlement" for New Cairo, «ريسيل» for resale — the names the
 * website's search already reads them by. Public like the taxonomy, kept a
 * day like it (and across restarts with it: query.ts keeps 'taxonomy' reads),
 * and asked only once the reader starts typing. A failed read suggests from
 * the names alone.
 */
function useSearchAliases(enabled: boolean) {
  return useQuery({
    queryKey: ['taxonomy', 'search_aliases'],
    queryFn: async () => {
      const { data, error } = await supabase.from('search_aliases').select('alias, district_id, track');
      if (error) throw error;
      return (data ?? []) as Pick<SearchAliasRow, 'alias' | 'district_id' | 'track'>[];
    },
    enabled,
    staleTime: DAY,
    gcTime: DAY,
  });
}

/** Every listing the board's reads hold now, each once — any filters, any page. */
function listingsRead(client: QueryClient): JobListItem[] {
  const seen = new Set<string>();
  const jobs: JobListItem[] = [];
  for (const [, data] of client.getQueriesData<InfiniteData<JobBoardResponse>>({ queryKey: ['jobs', 'board'] })) {
    for (const page of data?.pages ?? []) {
      for (const job of page.jobs) {
        if (seen.has(job.id)) continue;
        seen.add(job.id);
        jobs.push(job);
      }
    }
  }
  return jobs;
}

/** A track and a place for what is typed, when two of its words name them (the Search screen's «هل تقصد»). */
export function useDidYouMean(typed: string): DidYouMean | null {
  const locale = useLocale();
  const enough = typedLetters(typed) >= MIN_LETTERS;
  const districts = useDistricts().data;
  const aliases = useSearchAliases(enough).data;
  return useMemo(
    () => (enough ? didYouMean(typed, { locale, districts: districts ?? [], aliases: aliases ?? [] }) : null),
    [enough, typed, locale, districts, aliases],
  );
}

/** The suggestions for what is typed in the filter sheet's search field. */
export function useSearchSuggestions(typed: string): SearchSuggestion[] {
  const locale = useLocale();
  const client = useQueryClient();
  const enough = typedLetters(typed) >= MIN_LETTERS;
  const districts = useDistricts().data;
  const aliases = useSearchAliases(enough).data;
  const hiddenCompanies = useHiddenCompanies();
  const hiddenJobs = useHiddenJobs();

  // The board's reads under way: one landing (the first, on a slow start, with
  // the sheet already open over the skeleton) brings listings to name.
  const boardReads = useIsFetching({ queryKey: ['jobs', 'board'] });

  return useMemo(() => {
    if (!enough) return [];
    // Read again as the words change and as a read of the board lands.
    const listings = withoutHiddenJobs(withoutHidden(listingsRead(client), hiddenCompanies), hiddenJobs);
    return suggestionsFor(typed, { locale, districts: districts ?? [], aliases: aliases ?? [], listings });
    // boardReads: not read here, but its change is the board's cache changing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enough, typed, locale, client, districts, aliases, hiddenCompanies, hiddenJobs, boardReads]);
}
