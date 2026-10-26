/**
 * The admin user guide, as data.
 *
 * The sentences live here rather than in the message catalogue: the console
 * layout ships the whole `admin` namespace to every signed-in page, and a
 * guide of this length would ride along on screens that never open it. Chrome
 * — the page title, the search box, the empty state — stays in messages, and
 * is the only part those pages download.
 *
 * Both languages are written out. Arabic is what the console serves today;
 * English is here so the page still reads when that locale is published.
 */

export type LocaleText = { ar: string; en: string };

export type HelpTone = 'default' | 'outline' | 'primary' | 'success' | 'warning' | 'destructive' | 'accent';

export type HelpField = {
  label: LocaleText;
  detail: LocaleText;
};

export type HelpStatus = {
  label: LocaleText;
  detail?: LocaleText;
  tone: HelpTone;
};

export type HelpFeature = {
  /** Stable fragment for /admin/help#<id>. */
  id: string;
  title: LocaleText;
  /** What it does, in a sentence or two. */
  summary: LocaleText;
  /** The console page this feature lives on, when it has one. */
  href?: string;
  steps?: LocaleText[];
  fields?: HelpField[];
  statuses?: HelpStatus[];
  tips?: LocaleText[];
};

export type HelpSection = {
  id: string;
  title: LocaleText;
  lede: LocaleText;
  features: HelpFeature[];
};

export function text(ar: string, en: string): LocaleText {
  return { ar, en };
}
