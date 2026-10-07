import { createHiddenStore, type HiddenEntry } from './hidden-store';

/**
 * Companies the reader has hidden on this phone.
 *
 * The App Store asks an app where people publish to let a reader block whoever
 * is abusing it; on a job board that is a company whose listings they never
 * want to see again. Hidden here, the company's listings leave the board, the
 * home screen and "roles like this", and it leaves the directory — on this
 * phone, signed in or not, until the reader takes it back — from Account →
 * "Hidden on this phone", or from the company's own page, which says it is
 * hidden. Reporting it (reportTarget) is what reaches the team; hiding is
 * the reader's own relief in the meantime.
 *
 * Kept on the device: a list of company ids, nobody else's business, and
 * nothing the server needs in order to answer anyone else.
 */
const companies = createHiddenStore('bc.hidden-companies.v1');

export const hideCompany = companies.hide;
export const unhideCompany = companies.unhide;

/** The hidden company ids, kept current wherever they change. */
export function useHiddenCompanies(): ReadonlySet<string> {
  return companies.useHidden();
}

/** The hidden companies with the names they had, for Account → "Hidden on this phone". */
export function useHiddenCompanyEntries(): readonly HiddenEntry[] {
  return companies.useEntries();
}

/**
 * Whether the phone has said which companies are hidden. The app waits for
 * it before drawing anything (the root layout): a cold start draws the board
 * kept from the last run at once, and a hidden company's listings showed on
 * it until this small read came back.
 */
export function useHiddenCompaniesLoaded(): boolean {
  return companies.useLoaded();
}

/** A list without the listings of hidden companies. */
export function withoutHidden<T extends { company: { id: string } }>(items: T[], ids: ReadonlySet<string>): T[] {
  return ids.size ? items.filter((item) => !ids.has(item.company.id)) : items;
}
