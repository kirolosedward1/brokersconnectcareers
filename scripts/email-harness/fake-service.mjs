/**
 * deliver() as service.ts behaves, over globalThis.__mail: a key is claimed
 * once; under a retry the leased row's own key is handed back to it, and a
 * new key is a new row. The provider's answer is mail.provider(spec).
 */
export async function deliver(spec) {
  const mail = globalThis.__mail;
  const retry = mail.retry;
  const existing = mail.rows.get(spec.dedupeKey);
  let row;
  if (existing) {
    if (retry && retry.key === spec.dedupeKey) row = existing;
    else return 'skipped';
  } else {
    row = { key: spec.dedupeKey, to: spec.to, status: 'queued' };
    mail.rows.set(spec.dedupeKey, row);
  }
  const outcome = mail.provider(spec);
  row.status = outcome;
  mail.sends.push({ key: spec.dedupeKey, to: spec.to, outcome, text: spec.envelope.text });
  return outcome;
}
