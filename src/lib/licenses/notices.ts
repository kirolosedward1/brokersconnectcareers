/**
 * The open-source notices, as scripts/licenses.mjs writes them: web.json for
 * the website's packages, app.json for the app's. Generated from what is
 * installed and checked against the lockfiles by `pnpm check`, so neither is
 * edited by hand.
 *
 * Pure and importing nothing, for both sides: the website's /licenses page
 * reads both files, the app's licences screen reads app.json.
 */

/** A package: the licence its package.json declares, the copyright lines its LICENSE file opens with. */
export type PackageNotice = { name: string; version: string; license: string; copyright: string };

/** What is not a line in the package list: the font and the icons, and where each comes from. */
export type AssetNotice = { name: string; license: string; copyright: string; source: string };

/** A licence's full text, as the package named in `source` ships it; empty when none does. */
export type LicenseText = { id: string; source: string; text: string };

export type Notices = { packages: PackageNotice[]; assets: AssetNotice[]; licenses: LicenseText[] };

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Packages grouped by licence, the largest group first, each in name order as listed. */
export function byLicense(packages: readonly PackageNotice[]): { license: string; packages: PackageNotice[] }[] {
  const groups = new Map<string, PackageNotice[]>();
  for (const notice of packages) {
    const group = groups.get(notice.license);
    if (group) group.push(notice);
    else groups.set(notice.license, [notice]);
  }
  return Array.from(groups, ([license, members]) => ({ license, packages: members })).sort(
    (a, b) => b.packages.length - a.packages.length || byText(a.license, b.license),
  );
}

/**
 * Each licence's text once, across lists: the first list's wording, unless
 * only a later list has the text at all.
 */
export function uniqueTexts(...lists: readonly LicenseText[][]): LicenseText[] {
  const texts = new Map<string, LicenseText>();
  for (const list of lists) {
    for (const entry of list) {
      if (!texts.get(entry.id)?.text) texts.set(entry.id, entry);
    }
  }
  return Array.from(texts.values()).sort((a, b) => byText(a.id, b.id));
}

/**
 * A licence expression in pieces, each licence named apart from the words
 * and brackets around it — `MIT AND OFL-1.1` — so a page can link each one
 * to its text.
 */
export function expressionParts(expression: string): { text: string; license: boolean }[] {
  return expression
    .split(/(\s+|[()])/)
    .filter(Boolean)
    .map((text) => ({ text, license: /^[A-Za-z0-9][\w.+-]*$/.test(text) && !/^(?:AND|OR|WITH)$/.test(text) }));
}

/** Where a licence's text sits on a page. */
export function licenseAnchor(id: string): string {
  return `license-${id}`;
}

/** SPDX's copy of a licence, for one whose text no installed package ships. */
export function spdxUrl(id: string): string {
  return `https://spdx.org/licenses/${encodeURIComponent(id)}.html`;
}
