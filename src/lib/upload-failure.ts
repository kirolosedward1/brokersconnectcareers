/**
 * Why a file the browser sent straight to Storage did not go in.
 *
 * The CV, the agent's CV and a company's papers are uploaded from the browser
 * before the server action that records them, and every one of those uploads
 * answered any refusal with "we couldn't complete that, try again". Storage
 * says more than that, and most of what it says has a different remedy:
 *
 *   too_large  the bucket's own size limit — a smaller file, not a retry
 *   file_type  the bucket's MIME list — a PDF or Word file, not a retry
 *   network    no answer at all (a lift, a tunnel) — a retry is right
 *   denied     refused by policy: usually a session that lapsed while the
 *              form was open, which a sign-in fixes and a retry never will
 *   failed     anything else; "try again" is the honest answer
 *
 * Read from the error's shape rather than its class, so this needs no import
 * from supabase-js: storage-js reports HTTP status in `status`, the API's own
 * code in `code` (EntityTooLarge, InvalidMimeType, …) and, for older
 * gateways, a status-like string in `statusCode`. A failure with no response
 * is a StorageUnknownError carrying none of them.
 *
 * Pure, so scripts/form-draft.test.mjs can load it.
 */
export type UploadFailure = 'too_large' | 'file_type' | 'network' | 'denied' | 'failed';

type StorageErrorShape = {
  name?: unknown;
  message?: unknown;
  status?: unknown;
  statusCode?: unknown;
  code?: unknown;
};

export function uploadFailure(error: unknown): UploadFailure {
  if (!error || typeof error !== 'object') return 'failed';
  const shape = error as StorageErrorShape;
  const message = typeof shape.message === 'string' ? shape.message.toLowerCase() : '';
  const code = typeof shape.code === 'string' ? shape.code.toLowerCase() : '';
  const status = Number(shape.status) || Number(shape.statusCode) || 0;
  const statusCode = Number(shape.statusCode) || 0;

  if (status === 413 || statusCode === 413 || code === 'entitytoolarge' || /maximum allowed size|too large/.test(message)) {
    return 'too_large';
  }
  if (
    status === 415 ||
    statusCode === 415 ||
    code === 'invalidmimetype' ||
    /mime type|mimetype/.test(message)
  ) {
    return 'file_type';
  }
  if (
    [401, 403].includes(status) ||
    [401, 403].includes(statusCode) ||
    ['accessdenied', 'invalidjwt', 'unauthorized'].includes(code) ||
    /jwt|row-level security|unauthorized|access denied/.test(message)
  ) {
    return 'denied';
  }
  if (shape.name === 'StorageUnknownError' || (!status && /fetch|network|load failed|timed? ?out/.test(message))) {
    return 'network';
  }
  return 'failed';
}
