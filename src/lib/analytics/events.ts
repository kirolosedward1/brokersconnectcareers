/**
 * The analytics vocabulary: every event this product records, what may travel
 * with it, and whether it is also counted first-party.
 *
 * One table, read by three places — the browser before sending, the metrics
 * route on arrival, and the tests — so an event that is not written here does
 * not exist, and a property that is not written here is refused.
 *
 * Naming: `object_action`, snake_case, action in the past tense — the thing
 * already happened. Properties are closed vocabularies, booleans and small
 * counts. Never free text, never an id, never a URL: anything shaped like a
 * person is refused by `cleanProps`, whatever the declaration says.
 *
 * `metric: true` means the event is also added to the first-party daily
 * counter (see /api/metrics and record_product_metric), for the steps the
 * database cannot see — searches, views, starts, clicks. Conversions are not
 * counted there: the rows they create are the count.
 */
import { JOB_TRACKS } from '@/lib/taxonomy';
import { looksPersonal } from '@/lib/analytics/redact';

/** Who did it, as the server saw them. `pending` is signed in, not onboarded. */
export const ROLES = ['visitor', 'pending', 'candidate', 'employer', 'admin'] as const;
export type AnalyticsRole = (typeof ROLES)[number];

/** Where a reader was before a listing — the half of search → view a page view cannot see. */
export const JOB_VIEW_SOURCES = [
  'search', // the board with a query or a filter
  'board', // the board as it is
  'home',
  'landing', // a track-and-district page
  'similar', // another listing
  'share', // a forwarded link, ?src=share
  'company',
  'saved',
  'dashboard',
  'search_engine',
  'external',
  'direct',
  'other',
] as const;

export const FILTERS = [
  'keyword',
  'track',
  'district',
  'governorate',
  'company_type',
  'leads',
  'salary',
  'experience',
  'employment_type',
  'availability',
  'years',
] as const;

export const SURFACES = ['jobs', 'directory'] as const;
export const RESULTS = ['none', 'some'] as const;
/** A search narrowed to one track, none, or several. */
export const SEARCH_TRACKS = [...JOB_TRACKS, 'any', 'multi'] as const;

type Spec =
  | { readonly kind: 'enum'; readonly values: readonly string[]; readonly optional?: true }
  | { readonly kind: 'bool'; readonly optional?: true }
  | { readonly kind: 'count'; readonly max: number; readonly optional?: true }
  | { readonly kind: 'slug'; readonly optional?: true };

const oneOf = <const V extends readonly string[]>(values: V) => ({ kind: 'enum', values }) as const;
const bool = () => ({ kind: 'bool' }) as const;
const count = (max: number) => ({ kind: 'count', max }) as const;
/** A taxonomy slug — a district, say. Validated by shape, then by the database. */
const slug = () => ({ kind: 'slug' }) as const;
const optional = <const S extends Spec>(spec: S) => ({ ...spec, optional: true as const });

const role = oneOf(ROLES);

export const EVENTS = {
  // — Candidate funnel ------------------------------------------------------
  /** The board showed results for a query or at least one filter. */
  job_searched: {
    props: {
      role,
      results: oneOf(RESULTS),
      filters: count(40),
      query: bool(),
      track: oneOf(SEARCH_TRACKS),
      district: slug(), // a district slug, `any` or `multi`
    },
    metric: true,
  },
  /** A filter was switched on — not off, not cleared. */
  filter_used: { props: { role, surface: oneOf(SURFACES), filter: oneOf(FILTERS) }, metric: true },
  /** An open listing was read by somebody outside the company that posted it. Once per listing per tab. */
  job_viewed: { props: { role, from: oneOf(JOB_VIEW_SOURCES) }, metric: true },
  /** Apply was pressed. A visitor pressing it meets the sign-in wall next. */
  apply_clicked: { props: { role }, metric: true },
  /** The apply form was shown to a candidate who can use it. Once per listing per tab. */
  application_started: { props: {}, metric: true },
  /** The server wrote the application. Never on the click. */
  application_completed: { props: { src: optional(oneOf(['share'] as const)) }, metric: false },
  /** The server saved the listing to the candidate's list. */
  job_saved: { props: { surface: oneOf(['card', 'detail'] as const) }, metric: false },
  /** An account was created at the consultant door (not a repeat of an existing address). */
  candidate_signed_up: { props: {}, metric: false },
  /** An account was created at the employer door. */
  employer_signed_up: { props: {}, metric: false },
  /** An account was created at the general door; its role is chosen at onboarding. */
  account_signed_up: { props: {}, metric: false },
  /** The profile row was created as a candidate — the first time, not a resubmit. */
  candidate_onboarding_completed: { props: {}, metric: false },

  // — Employer funnel -------------------------------------------------------
  /** The profile row and the company were created as an employer. */
  employer_onboarding_completed: { props: {}, metric: false },
  /** The company now has a description and a logo — the checklist's first step. */
  company_profile_completed: { props: {}, metric: false },
  /** The company's first verification document was recorded. */
  verification_started: { props: {}, metric: false },
  /** The new-listing wizard was opened by somebody with a company. Once per tab. */
  job_creation_started: { props: {}, metric: true },
  /** A listing entered the review queue. Publication is the moderator's, and is counted from the row. */
  job_submitted: { props: {}, metric: false },

  // — Consultant directory --------------------------------------------------
  directory_viewed: { props: { role, access: oneOf(['full', 'anonymous'] as const) }, metric: true },
  directory_searched: {
    props: { role, results: oneOf(RESULTS), filters: count(40), track: oneOf(SEARCH_TRACKS), district: slug() },
    metric: true,
  },
  /** Never the slug: it is the consultant's name. */
  agent_profile_viewed: { props: { role, access: oneOf(['unlocked', 'locked'] as const) }, metric: true },
  /** The contact button was pressed. Never the number, never the link. */
  agent_contact_clicked: { props: { method: oneOf(['whatsapp'] as const) }, metric: true },

  // — Kept from before this vocabulary ------------------------------------
  arrived_from_share: { props: {}, metric: false },
  homepage_job_browse_location: { props: { value: slug() }, metric: false },
  homepage_job_browse_category: { props: { value: slug() }, metric: false },
  homepage_job_browse_company_type: { props: { value: slug() }, metric: false },
} as const satisfies Record<string, { props: Record<string, Spec>; metric: boolean }>;

export type AnalyticsEvent = keyof typeof EVENTS;

type ValueOf<S> = S extends { kind: 'enum'; values: readonly (infer V)[] }
  ? V
  : S extends { kind: 'bool' }
    ? boolean
    : S extends { kind: 'count' }
      ? number
      : string;
type RequiredProps<P> = { [K in keyof P as P[K] extends { optional: true } ? never : K]: ValueOf<P[K]> };
type OptionalProps<P> = { [K in keyof P as P[K] extends { optional: true } ? K : never]?: ValueOf<P[K]> };

export type EventProps<E extends AnalyticsEvent> = RequiredProps<(typeof EVENTS)[E]['props']> &
  OptionalProps<(typeof EVENTS)[E]['props']>;

/** The events the first-party counter accepts — mirrored in record_product_metric(). */
export const METRIC_EVENTS = (Object.keys(EVENTS) as AnalyticsEvent[]).filter((event) => EVENTS[event].metric);

/**
 * Own keys only, so `toString` is not an event. Not `Object.hasOwn`: Safari
 * before 15.4 lacks it, and scripts/compat.mjs holds the line on that.
 */
const has = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);

export function isAnalyticsEvent(value: unknown): value is AnalyticsEvent {
  return typeof value === 'string' && has(EVENTS, value);
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * The properties, exactly as declared, or nothing.
 *
 * All or nothing rather than best effort: an unknown key or a value outside
 * its vocabulary refuses the whole event. Dropping the bad field and sending
 * the rest would record an event that says something the caller did not mean.
 */
export function cleanProps<E extends AnalyticsEvent>(event: E, raw: unknown): EventProps<E> | null {
  const specs: Record<string, Spec> = EVENTS[event]?.props;
  if (!specs) return null;

  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  if (Object.keys(input).some((key) => !has(specs, key))) return null;

  const out: Record<string, string | number | boolean> = {};
  for (const [key, spec] of Object.entries(specs)) {
    const value = input[key];
    if (value === undefined) {
      if (spec.optional) continue;
      return null;
    }
    switch (spec.kind) {
      case 'enum':
        if (typeof value !== 'string' || !spec.values.includes(value)) return null;
        break;
      case 'bool':
        if (typeof value !== 'boolean') return null;
        break;
      case 'count':
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > spec.max) return null;
        break;
      case 'slug':
        if (typeof value !== 'string' || !SLUG.test(value) || looksPersonal(value)) return null;
        break;
    }
    out[key] = value as string | number | boolean;
  }
  return out as EventProps<E>;
}

/**
 * The one string a first-party count is kept under, or null if the event is
 * not counted.
 *
 * Searches keep their shape only when they found nothing — which track, which
 * district, whether words were typed — because a zero is a gap in supply and
 * a result is not news. The words themselves never leave the page.
 */
export function metricDimension(event: AnalyticsEvent, props: Record<string, unknown>): string | null {
  if (!EVENTS[event].metric) return null;
  switch (event) {
    case 'job_searched':
    case 'directory_searched':
      return props.results === 'some' ? 'some' : `none:${props.track}:${props.district}:${props.query ? 1 : 0}`;
    case 'job_viewed':
      return String(props.from);
    case 'filter_used':
      return `${props.surface}:${props.filter}`;
    case 'directory_viewed':
    case 'agent_profile_viewed':
      return String(props.access);
    case 'agent_contact_clicked':
      return String(props.method);
    default:
      return '';
  }
}
