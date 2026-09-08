/**
 * Bucket names, and nothing else.
 *
 * Separate from storage.ts because that module is `server-only` — it mints
 * signed URLs with the service role — while these three strings are needed on
 * both sides: a browser uploads a CV, a logo and a verification document
 * straight into the bucket, and the server reads back out of it.
 *
 * Before this file the client half worked around the boundary by writing the
 * names as literals at each upload site, which is three copies of a name that
 * has to match the schema exactly.
 */
export const CV_BUCKET = 'cvs';
export const COMPANY_DOCS_BUCKET = 'company-documents';
export const COMPANY_LOGOS_BUCKET = 'company-logos';
