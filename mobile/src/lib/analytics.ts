import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { cleanProps, type AnalyticsEvent, type EventProps } from '@/lib/analytics/events';

/**
 * The product's funnel events, from the phone — the website's vocabulary
 * (src/lib/analytics/events.ts), checked by its own `cleanProps`, so an event
 * that is not written there, or a property outside its vocabulary, is never
 * sent from here either.
 *
 * The four funnels the v1.1 brief measures:
 *   link → listing → apply      arrived_from_share, job_viewed, apply_clicked,
 *                               application_started, application_completed
 *   sign up → profile 60%       account_signed_up / candidate_signed_up,
 *                               candidate_onboarding_completed, profile_completeness_reached
 *   employer post → applicant   job_submitted, applicant_opened
 *   reveal → WhatsApp           agent_contact_revealed, agent_contact_clicked
 *
 * Where they go is not decided here: analytics is off in every environment
 * (docs/privacy), so nothing is sent until a sink is set (`setAnalyticsSink`).
 * A person who turns analytics off on this phone (Account → Privacy) sends
 * nothing, sink or not.
 */
type Sink = (event: AnalyticsEvent, props: Record<string, string | number | boolean>) => void;

let sink: Sink | null = null;

export function setAnalyticsSink(next: Sink | null) {
  sink = next;
}

const OPT_OUT_KEY = 'bc.analytics-off.v1';
let optedOut = false;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded) return;
  loaded = true;
  AsyncStorage.getItem(OPT_OUT_KEY)
    .then((stored) => {
      if (stored === '1') setOptOut(true, false);
    })
    .catch(() => {});
}

function setOptOut(value: boolean, persist: boolean) {
  if (value !== optedOut) {
    optedOut = value;
    listeners.forEach((listener) => listener());
  }
  if (persist) AsyncStorage.setItem(OPT_OUT_KEY, value ? '1' : '0').catch(() => {});
}

/** Turn this phone's analytics off or back on; kept on the phone. */
export function setAnalyticsOptOut(value: boolean) {
  loaded = true;
  setOptOut(value, true);
}

export function useAnalyticsOptOut(): boolean {
  return useSyncExternalStore(
    (listener) => {
      load();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => optedOut,
  );
}

/** Records one event, when there is somewhere to record it and the person has not said no. Never throws. */
export function track<E extends AnalyticsEvent>(event: E, props: EventProps<E>) {
  load();
  if (!sink || optedOut) return;
  const clean = cleanProps(event, props);
  if (!clean) return;
  try {
    sink(event, clean as Record<string, string | number | boolean>);
  } catch {
    // A sink that fails is never the screen's problem.
  }
}

/** For tests: back to a fresh phone. */
export function resetAnalyticsForTests() {
  sink = null;
  optedOut = false;
  loaded = false;
}
