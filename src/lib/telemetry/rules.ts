/**
 * When something is wrong enough to tell a person.
 *
 * Pure: signals in, verdicts out. The watcher (api/cron/ops-watch) gathers the
 * signals from the database in one call and applies these; the tests apply
 * them to hand-built signals. Every threshold lives here and in
 * docs/alerts.md, which says why each number is what it is.
 *
 * Two rules keep this from becoming noise:
 *
 *   An absolute floor on every rate. At this platform's traffic one failed
 *   application out of one attempt is a 100% failure rate and means nothing;
 *   five out of eight means the flow is broken.
 *
 *   Symptoms over causes. "Listings are past their end date and still live"
 *   is what a reader of the board would notice, and it fires whatever the
 *   reason the expiry stopped — a missing key, a renamed route, a plan limit.
 *
 * Every rule returns a verdict whether or not it fires, so the watcher can
 * close an alert as well as open one.
 */

export type Severity = 'warning' | 'critical';

export type Verdict = {
  rule: string;
  firing: boolean;
  severity: Severity;
  summary: string;
  value: Record<string, string | number | null>;
};

export type Signals = {
  at?: string;
  errors?: {
    server_15m?: number;
    server_1h?: number;
    client_1h?: number;
    client_baseline_1h?: number;
    new_in_release?: { fingerprint: string; area: string; event: string; release: string; count: number }[];
  };
  failures_1h?: Record<string, number>;
  auth?: { system_15m?: number; refused_15m?: number };
  applications_1h?: number;
  email?: { sent_1h?: number; failed_1h?: number; stuck?: number; oldest_stuck_minutes?: number | null };
  listings_past_expiry?: number;
  scheduled?: { job: string; last_success_at: string | null; last_status: string | null }[] | null;
  db_cron?: { job: string; failures_24h: number; last_status: string | null }[] | null;
  db?: {
    bytes?: number;
    connections?: number;
    max_connections?: number;
    long_running?: number;
    oldest_xact_seconds?: number;
  };
  storage?: { bytes?: number };
};

export type Limits = {
  /** Plan limits, from OPS_DB_LIMIT_MB / OPS_STORAGE_LIMIT_MB. Supabase Free: 500 MB and 1 GB. */
  dbBytes: number;
  storageBytes: number;
};

export const DEFAULT_LIMITS: Limits = {
  dbBytes: 500 * 1024 * 1024,
  storageBytes: 1024 * 1024 * 1024,
};

/**
 * How long each scheduled job may go without a successful run before it is
 * late: its schedule plus room for one missed or failed run. Keyed by the name
 * a job records itself under; a job not listed here gets a day and two hours.
 */
export const SCHEDULE_ALLOWANCE_MINUTES: Record<string, number> = {
  'expire-jobs': 26 * 60,
  'daily-digest': 26 * 60,
  'email-retry': 3 * 60,
  'job-alerts': 8 * 24 * 60,
  'new-jobs': 26 * 60,
  maintenance: 3 * 60,
  lifecycle: 3 * 60,
};

const n = (value: number | null | undefined) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

function verdict(rule: string, firing: boolean, severity: Severity, summary: string, value: Verdict['value'] = {}): Verdict {
  return { rule, firing, severity, summary, value };
}

/** Auth areas and the application flow have rules of their own. */
function isOwnRule(area: string) {
  return area === 'apply' || area.startsWith('auth.');
}

export function evaluate(signals: Signals, limits: Limits = DEFAULT_LIMITS, now = Date.now()): Verdict[] {
  const out: Verdict[] = [];

  // --- server errors --------------------------------------------------------
  {
    const recent = n(signals.errors?.server_15m);
    const firing = recent >= 5;
    out.push(
      verdict(
        'server-errors',
        firing,
        recent >= 25 ? 'critical' : 'warning',
        `${recent} server error${recent === 1 ? '' : 's'} in the last 15 minutes`,
        { server_15m: recent, server_1h: n(signals.errors?.server_1h) },
      ),
    );
  }

  // --- a failure that arrived with the latest release -----------------------
  {
    const fresh = (signals.errors?.new_in_release ?? []).filter((row) => n(row.count) >= 3);
    const top = fresh.sort((a, b) => n(b.count) - n(a.count))[0];
    out.push(
      verdict(
        'new-error-after-release',
        Boolean(top),
        'warning',
        top
          ? `New error since release ${top.release}: ${top.area} / ${top.event} (${top.count}×)`
          : 'No new error since the latest release',
        top ? { fingerprint: top.fingerprint, release: top.release, count: top.count, others: fresh.length - 1 } : {},
      ),
    );
  }

  // --- browser errors, against the platform's own normal --------------------
  {
    const recent = n(signals.errors?.client_1h);
    const baseline = n(signals.errors?.client_baseline_1h);
    const threshold = Math.max(40, Math.ceil(baseline * 8));
    out.push(
      verdict(
        'client-errors',
        recent >= threshold,
        'warning',
        `${recent} browser errors in the last hour (normal is about ${baseline.toFixed(1)})`,
        { client_1h: recent, baseline_1h: Number(baseline.toFixed(2)), threshold },
      ),
    );
  }

  // --- sign-in and sign-up ----------------------------------------------------
  {
    const system = n(signals.auth?.system_15m);
    out.push(
      verdict(
        'auth-failing',
        system >= 5,
        system >= 20 ? 'critical' : 'warning',
        `${system} sign-in or sign-up attempts failed on the platform's side in 15 minutes`,
        { system_15m: system },
      ),
    );

    const refused = n(signals.auth?.refused_15m);
    out.push(
      verdict(
        'auth-refusals-spike',
        refused >= 60,
        'warning',
        `${refused} sign-ins refused for wrong credentials in 15 minutes`,
        { refused_15m: refused },
      ),
    );
  }

  // --- applications: the mutation the product exists for -------------------
  {
    const failed = n(signals.failures_1h?.apply);
    const succeeded = n(signals.applications_1h);
    const ratio = failed / Math.max(1, failed + succeeded);
    const critical = failed >= 5 && ratio >= 0.5;
    out.push(
      verdict(
        'applications-failing',
        critical || (failed >= 3 && ratio >= 0.2),
        critical ? 'critical' : 'warning',
        `${failed} applications refused and ${succeeded} recorded in the last hour`,
        { failed_1h: failed, succeeded_1h: succeeded, failure_ratio: Number(ratio.toFixed(2)) },
      ),
    );
  }

  // --- the other flows that must work ----------------------------------------
  {
    const areas = Object.entries(signals.failures_1h ?? {})
      .filter(([area, count]) => !isOwnRule(area) && n(count) >= 10)
      .sort((a, b) => n(b[1]) - n(a[1]));
    out.push(
      verdict(
        'flow-failures',
        areas.length > 0,
        'warning',
        areas.length
          ? `Repeated failures in the last hour: ${areas.slice(0, 4).map(([area, count]) => `${area} ${count}`).join(', ')}`
          : 'No flow failing repeatedly',
        Object.fromEntries(areas.slice(0, 6)),
      ),
    );
  }

  // --- email ------------------------------------------------------------------
  {
    const sent = n(signals.email?.sent_1h);
    const failed = n(signals.email?.failed_1h);
    const ratio = failed / Math.max(1, sent + failed);
    const critical = failed >= 5 && sent === 0;
    out.push(
      verdict(
        'email-failing',
        critical || (failed >= 3 && ratio >= 0.25),
        critical ? 'critical' : 'warning',
        `${failed} emails failed and ${sent} sent in the last hour`,
        { failed_1h: failed, sent_1h: sent, failure_ratio: Number(ratio.toFixed(2)) },
      ),
    );

    const stuck = n(signals.email?.stuck);
    const oldest = n(signals.email?.oldest_stuck_minutes);
    out.push(
      verdict(
        'email-queue-stuck',
        stuck >= 1 && oldest >= 180,
        stuck >= 20 || oldest >= 720 ? 'critical' : 'warning',
        `${stuck} emails waiting to send, the oldest for ${Math.round(oldest)} minutes`,
        { stuck, oldest_minutes: Math.round(oldest) },
      ),
    );
  }

  // --- scheduled work, by its symptoms and by its records ---------------------
  {
    const past = n(signals.listings_past_expiry);
    out.push(
      verdict(
        'listings-not-expiring',
        past >= 1,
        'warning',
        `${past} listings still live more than two hours past their end date`,
        { listings: past },
      ),
    );

    const late = (signals.scheduled ?? [])
      .map((row) => {
        const allowance = SCHEDULE_ALLOWANCE_MINUTES[row.job] ?? 26 * 60;
        const last = row.last_success_at ? Date.parse(row.last_success_at) : Number.NaN;
        const minutes = Number.isNaN(last) ? null : Math.round((now - last) / 60_000);
        return { job: row.job, minutes, late: minutes === null || minutes > allowance };
      })
      .filter((row) => row.late);
    out.push(
      verdict(
        'scheduled-job-late',
        late.length > 0,
        'warning',
        late.length
          ? `Scheduled work overdue: ${late.map((row) => (row.minutes === null ? `${row.job} (never succeeded)` : `${row.job} (${Math.round(row.minutes / 60)}h)`)).join(', ')}`
          : 'Every scheduled job ran on time',
        Object.fromEntries(late.map((row) => [row.job, row.minutes])),
      ),
    );

    const dbCron = (signals.db_cron ?? []).filter((row) => n(row.failures_24h) >= 2 || row.last_status === 'failed');
    out.push(
      verdict(
        'database-jobs-failing',
        dbCron.length > 0,
        'warning',
        dbCron.length
          ? `Database-scheduled jobs failing: ${dbCron.map((row) => `${row.job} (${row.failures_24h} in 24h)`).join(', ')}`
          : 'Database-scheduled jobs healthy',
        Object.fromEntries(dbCron.map((row) => [row.job, row.failures_24h])),
      ),
    );
  }

  // --- the database and storage -------------------------------------------------
  {
    const connections = n(signals.db?.connections);
    const max = Math.max(1, n(signals.db?.max_connections) || 60);
    const connRatio = connections / max;
    const bytes = n(signals.db?.bytes);
    const bytesRatio = bytes / Math.max(1, limits.dbBytes);
    const longRunning = n(signals.db?.long_running);
    const oldestXact = n(signals.db?.oldest_xact_seconds);

    const critical = connRatio >= 0.9 || bytesRatio >= 0.95;
    const warning = connRatio >= 0.75 || bytesRatio >= 0.8 || longRunning >= 3 || oldestXact >= 600;
    out.push(
      verdict(
        'database-pressure',
        critical || warning,
        critical ? 'critical' : 'warning',
        `Database: ${connections}/${max} connections, ${(bytes / 1048576).toFixed(0)} MB of ${(limits.dbBytes / 1048576).toFixed(0)} MB, ${longRunning} long-running queries`,
        {
          connections,
          max_connections: max,
          size_mb: Math.round(bytes / 1048576),
          size_ratio: Number(bytesRatio.toFixed(3)),
          long_running: longRunning,
          oldest_xact_seconds: Math.round(oldestXact),
        },
      ),
    );

    const storage = n(signals.storage?.bytes);
    const storageRatio = storage / Math.max(1, limits.storageBytes);
    out.push(
      verdict(
        'storage-pressure',
        storageRatio >= 0.8,
        storageRatio >= 0.95 ? 'critical' : 'warning',
        `Storage: ${(storage / 1048576).toFixed(0)} MB of ${(limits.storageBytes / 1048576).toFixed(0)} MB`,
        { size_mb: Math.round(storage / 1048576), size_ratio: Number(storageRatio.toFixed(3)) },
      ),
    );
  }

  return out;
}

/**
 * What to do with a verdict, given the alert already open for its rule.
 *
 * Mirrors ops_alert_transition() in the database, which is what decides in
 * production (atomically, so two watcher runs cannot both notify); this copy
 * exists so the policy can be tested without a database and read in one place.
 */
export type Transition = 'open' | 'escalate' | 'remind' | 'resolve' | 'none';

export const REMIND_AFTER_MINUTES: Record<Severity, number> = { critical: 6 * 60, warning: 24 * 60 };

export function transitionFor(
  firing: boolean,
  severity: Severity,
  open: { severity: Severity; last_notified_at: string | null } | null,
  now = Date.now(),
): Transition {
  if (!firing) return open ? 'resolve' : 'none';
  if (!open) return 'open';
  if (open.severity === 'warning' && severity === 'critical') return 'escalate';
  const last = open.last_notified_at ? Date.parse(open.last_notified_at) : 0;
  return now - last >= REMIND_AFTER_MINUTES[severity] * 60_000 ? 'remind' : 'none';
}
