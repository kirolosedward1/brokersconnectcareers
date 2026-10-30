/**
 * Interview times are chosen and shown in Cairo time (decided for v1.1), and
 * stored as instants. Egypt keeps summer time, so a day's offset is asked of
 * the time zone database rather than assumed, as cairoDayStart does on the
 * website; asked at noon, which no clock change in Egypt ever crosses.
 */

const dayParts = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' });

/** The Cairo calendar day an instant falls on, as YYYY-MM-DD. */
export function cairoDay(at: Date): string {
  const parts = dayParts.formatToParts(at);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Cairo's offset from UTC on a calendar day, as ±HH:MM. */
function cairoOffset(day: string): string {
  const noon = new Date(`${day}T12:00:00Z`);
  const name =
    new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', timeZoneName: 'longOffset' })
      .formatToParts(noon)
      .find((part) => part.type === 'timeZoneName')?.value ?? 'GMT+02:00';
  // "GMT+03:00" from the engine's own Intl, "GMT+3" from the polyfill the app ships.
  const match = /GMT([+-])(\d{1,2})(?::?(\d{2}))?/.exec(name);
  return match ? `${match[1]}${match[2]!.padStart(2, '0')}:${match[3] ?? '00'}` : '+02:00';
}

/** The instant a Cairo wall-clock time is, as an ISO string with Cairo's offset ("2026-11-02T11:00:00+02:00"). */
export function cairoInstant(day: string, time: string): string {
  return `${day}T${time}:00${cairoOffset(day)}`;
}

/** The next `count` Cairo days, today first. */
export function nextCairoDays(now: Date, count = 14): string[] {
  const today = new Date(`${cairoDay(now)}T12:00:00Z`);
  return Array.from({ length: count }, (_, index) => {
    const day = new Date(today);
    day.setUTCDate(today.getUTCDate() + index);
    return day.toISOString().slice(0, 10);
  });
}

/** Half-hour times through the working day, 09:00 to 21:00. */
export const INTERVIEW_TIMES: readonly string[] = Array.from({ length: 25 }, (_, index) => {
  const minutes = 9 * 60 + index * 30;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
});
