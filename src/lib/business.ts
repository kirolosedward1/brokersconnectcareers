/**
 * Who runs Brokers Connect, as the legal documents already say it.
 *
 * Only what content/legal publishes — the operator's name and how to reach it
 * — kept in one place so the footer, the app and the documents cannot say
 * different things; scripts/legal.test.mjs fails if a document stops naming
 * them. Where it is (Dubai, United Arab Emirates) is words, so it lives in the
 * catalogue (`footer.operatedBy`). A street address and a registration number
 * belong here too once the owner supplies them: nothing here is guessed.
 *
 * Pure, with no imports, so the app reads it through `@/` like the other
 * shared modules.
 */
export const OPERATOR = {
  name: 'Top Suite Digital Marketing',
  email: 'info@topsuite.net',
  phone: '+971507071591',
} as const;
