/**
 * A step that has not answered in time, named so the person can be told which.
 * The apply button spun for good on a CV whose upload never left the phone
 * (no request reached storage): every step on that path now has a limit.
 */
export class TimedOut extends Error {
  constructor(readonly step: string, readonly ms: number) {
    super(`${step}: no answer after ${Math.round(ms / 1000)} s`);
    this.name = 'TimedOut';
  }
}

/** What `pending` answers, or TimedOut once `ms` have passed. The step left running is not cancelled. */
export function withTimeout<T>(pending: Promise<T>, ms: number, step: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const late = setTimeout(() => reject(new TimedOut(step, ms)), ms);
    pending.then(
      (value) => {
        clearTimeout(late);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(late);
        reject(error);
      },
    );
  });
}
