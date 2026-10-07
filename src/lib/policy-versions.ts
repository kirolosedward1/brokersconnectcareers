/**
 * The versions of the Terms of use and the Privacy policy a person agrees to:
 * each document's `updated:` date, as content/legal/{terms,privacy}.ar.md
 * (and their English texts) say it. Recorded with every acceptance
 * (policy_acceptances, migration 336), and looked for there to decide
 * whether somebody has agreed to what is published now.
 *
 * Written here rather than read from the files at request time. Vercel ships a
 * function with the files Next saw it read, and Next sees a read only where it
 * can work out the file's name: the onboarding page, which records the
 * agreement, and every page under the two layouts that ask for it again, were
 * built without the documents, so a read there failed — onboarding threw
 * after the profile was made, and the notice never showed. A constant cannot
 * go missing. scripts/legal.test.mjs fails when it and the documents disagree,
 * so changing a date in a document means changing it here, which is what
 * asks everybody to agree again.
 *
 * Pure, with no imports, so the app can read it too.
 */
export const POLICY_VERSIONS = {
  terms: '2026-10-01',
  privacy: '2026-10-01',
} as const;
