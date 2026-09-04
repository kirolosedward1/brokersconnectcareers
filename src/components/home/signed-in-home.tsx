import { getTranslations } from "next-intl/server";
import {
  ArrowRight,
  Briefcase,
  MapPin,
  Search,
  Send,
  Users,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { localized, type Locale } from "@/i18n/routing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { JobCard } from "@/components/jobs/job-card";
import { buildLandingSlug, JOB_TRACKS } from "@/lib/taxonomy";
import { formatNumber } from "@/lib/utils";
import type { DistrictRow } from "@/lib/supabase/database.types";
import type { JobListItem } from "@/lib/queries/jobs";

/**
 * Home for a signed-in reader.
 *
 * No pitch: the marketing landing is for people who have not decided yet, and
 * repeating it to somebody with an account is asking them to be convinced of
 * something they already bought. This is a launchpad — where they left off,
 * and what is new in the market.
 *
 * It is not a second dashboard either. The numbers and the work live under
 * /dashboard and /employer; this page links there and then gets out of the
 * way. Two screens competing to be the place you check is how both stop being
 * checked.
 *
 * An employer gets a strip of their own before the market feed. A page of
 * jobs to apply for is the wrong first screen for somebody who posts them,
 * but the feed still earns its place below — it is what their listings are
 * competing against.
 */
export async function SignedInHome({
  locale,
  name,
  role,
  districts,
  jobs,
  total,
}: {
  locale: Locale;
  name: string;
  role: "candidate" | "employer" | "admin";
  districts: DistrictRow[];
  jobs: JobListItem[];
  total: number;
}) {
  const t = await getTranslations("home");
  const tJobs = await getTranslations("jobs");
  const tTrack = await getTranslations("track");
  const tNav = await getTranslations("nav");
  const tFilters = await getTranslations("filters");

  const featured = jobs.filter((job) => job.is_featured).slice(0, 2);
  const latest = jobs.filter((job) => !featured.includes(job)).slice(0, 6);
  const openSeats = jobs.reduce((sum, job) => sum + job.seats, 0);

  const hiring = role === "employer" || role === "admin";
  const action = locale === "ar" ? "/jobs" : `/${locale}/jobs`;
  const n = (value: number) => formatNumber(value, locale);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t("welcome", { name })}</h1>
          <p className="mt-1 text-muted-foreground">{t("welcomeLede")}</p>
        </div>

        <Button asChild variant="outline">
          <Link href={hiring ? "/employer" : "/dashboard"}>
            {hiring ? tNav("employerArea") : tNav("dashboard")}
            <ArrowRight className="rtl-flip" />
          </Link>
        </Button>
      </header>

      {/* A search bar for the people who search. An employer is not looking for
          a job to apply to — they get their own strip instead, and the market
          feed below it stays, because what else is running is worth knowing
          when you are writing a listing. A plain GET form, so it works before
          any JavaScript loads. */}
      {hiring ? null : (
        <form
          action={action}
          className="mt-6 rounded-2xl border border-border bg-card p-2 shadow-sm"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute inset-y-0 start-4 my-auto size-4 text-muted-foreground"
                aria-hidden
              />
              <input
                type="search"
                name="q"
                placeholder={t("searchPlaceholder")}
                aria-label={t("searchPlaceholder")}
                className="h-12 w-full rounded-xl border-0 bg-transparent px-4 ps-11 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary"
              />
            </div>

            <div className="relative sm:w-52">
              <MapPin
                className="pointer-events-none absolute inset-y-0 start-4 my-auto size-4 text-muted-foreground"
                aria-hidden
              />
              <select
                name="district"
                aria-label={t("byDistrict")}
                defaultValue=""
                className="h-12 w-full appearance-none rounded-xl border-0 bg-muted px-4 ps-11 text-base outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <option value="">{tFilters("any")}</option>
                {districts.slice(0, 12).map((district) => (
                  <option key={district.id} value={district.slug}>
                    {localized(locale, district.name_ar, district.name_en)}
                  </option>
                ))}
              </select>
            </div>

            <Button
              type="submit"
              size="lg"
              className="h-12 shrink-0 rounded-xl px-8"
            >
              {t("searchButton")}
            </Button>
          </div>
        </form>
      )}

      {hiring ? (
        <section className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-primary/20 bg-primary/[0.04] p-4">
          <p className="me-auto text-sm font-medium">{t("hiringStrip")}</p>
          <Button asChild size="sm" variant="outline">
            <Link href="/employer/jobs">
              <Briefcase /> {t("hiringJobs")}
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/employer/jobs/new">
              <Send /> {tNav("postJob")}
            </Link>
          </Button>
        </section>
      ) : null}

      {/* The market, in one line rather than a run of dot-separated
          fragments — two labelled figures read as facts; "15 · وظيفة · 138"
          reads as a fragment of something else. */}
      <section className="mt-10" aria-labelledby="market-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="market-heading" className="text-lg font-semibold">
            {t("latestJobs")}
          </h2>

          <dl className="flex items-center gap-4 text-sm text-muted-foreground">
            <div className="inline-flex items-center gap-1.5">
              <Briefcase className="size-3.5" aria-hidden />
              <dt className="sr-only">{t("statJobs")}</dt>
              <dd className="numeral font-semibold text-foreground">
                {n(total)}
              </dd>
              <span>{t("statJobs")}</span>
            </div>
            <div className="inline-flex items-center gap-1.5">
              <Users className="size-3.5" aria-hidden />
              <dt className="sr-only">{t("statSeats")}</dt>
              <dd className="numeral font-semibold text-foreground">
                {n(openSeats)}
              </dd>
              <span>{t("statSeats")}</span>
            </div>
          </dl>
        </div>

        {featured.length ? (
          <>
            <h3 className="mt-6 text-sm font-medium text-muted-foreground">
              {t("featuredJobs")}
            </h3>
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {featured.map((job) => (
                <li key={job.id}>
                  <JobCard job={job} locale={locale} />
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {latest.length ? (
          <>
            {featured.length ? (
              <h3 className="mt-8 text-sm font-medium text-muted-foreground">
                {t("newestJobs")}
              </h3>
            ) : null}
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {latest.map((job) => (
                <li key={job.id}>
                  <JobCard job={job} locale={locale} />
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-4 rounded-xl border border-dashed border-border py-12 text-center text-muted-foreground">
            {tJobs("empty")}
          </p>
        )}

        <div className="mt-6 text-center">
          <Button asChild variant="outline">
            <Link href="/jobs">
              {t("browseAll")}
              <ArrowRight className="rtl-flip" />
            </Link>
          </Button>
        </div>
      </section>

      <section
        className="mt-14 grid gap-10 sm:grid-cols-2"
        aria-label={t("byTrack")}
      >
        <div>
          <h2 className="text-sm font-medium text-muted-foreground">
            {t("byTrack")}
          </h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {JOB_TRACKS.map((track) => (
              <li key={track}>
                <Link href={{ pathname: "/jobs", query: { track } }}>
                  <Badge variant="outline" size="lg">
                    {tTrack(track)}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="text-sm font-medium text-muted-foreground">
            {t("byDistrict")}
          </h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {districts.slice(0, 10).map((district) => (
              <li key={district.id}>
                <Link
                  href={`/jobs/${buildLandingSlug("primary", district.slug)}`}
                >
                  <Badge variant="outline" size="lg">
                    {localized(locale, district.name_ar, district.name_en)}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
