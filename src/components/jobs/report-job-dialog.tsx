"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/field";
import { Dialog } from "@/components/ui/dialog";
import { REPORT_REASONS } from "@/lib/taxonomy";
import { reportJob } from "@/lib/actions/jobs";

/**
 * Reporting needs an account now, so this has a signed-out state: a link to
 * sign in that comes back to the listing, rather than a form that accepts the
 * report and then refuses it.
 *
 * The keyboard behaviour that used to live here — the focus trap, Escape, the
 * return of focus to whatever opened it — moved into ui/Dialog, because it was
 * the only correct modal in the product and anything else needing one would
 * have grown a second, worse copy of it.
 */
export function ReportJobDialog({
  jobId,
  signedIn,
  jobSlug,
}: {
  jobId: string;
  signedIn: boolean;
  jobSlug: string;
}) {
  const t = useTranslations("jobs");
  const tReason = useTranslations("reportReason");
  const tCommon = useTranslations("common");

  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await reportJob({
        jobId,
        reason: form.get("reason"),
        detail: String(form.get("detail") ?? ""),
      });
      if (result.ok) {
        setSent(true);
        setError(null);
      } else {
        setError(
          result.error === "already_reported"
            ? t("alreadyReported")
            : result.error === "rate_limit"
              ? t("reportRateLimit")
              : tCommon("errorBody"),
        );
      }
    });
  }

  if (sent) {
    return <p className="text-sm text-success">{tCommon("saveSuccess")}</p>;
  }

  if (!signedIn) {
    return (
      <Button asChild variant="ghost">
        <a href={`/sign-in?next=${encodeURIComponent(`/jobs/${jobSlug}`)}`}>
          <Flag />
          {t("report")}
        </a>
      </Button>
    );
  }

  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        <Flag />
        {t("report")}
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        label={t("report")}
        closeLabel={tCommon("close")}
      >
        <form onSubmit={onSubmit} className="space-y-4">
          <h2 className="text-lg font-semibold">{t("report")}</h2>

          <Field label={t("reportReasonLabel")} htmlFor="reason">
            <Select
              id="reason"
              name="reason"
              required
              defaultValue="fake_listing"
            >
              {REPORT_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {tReason(reason)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={tCommon("optional")} htmlFor="detail">
            <Textarea id="detail" name="detail" maxLength={1000} />
          </Field>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              {tCommon("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {tCommon("submit")}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
