'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { ChevronDown, Info, Mail, Search, SearchX, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  filterHelp,
  matchRanges,
  queryTokens,
  type LocalizedFeature,
  type LocalizedSection,
} from '@/lib/admin/help/search';

/**
 * The admin user guide.
 *
 * A sticky contents list on a wide screen, a scrolling row of the same
 * sections on a phone, and a search box that narrows both as it is typed.
 * Anchors are the section and feature ids, so a link to one opens it.
 */
export function HelpCenter({
  sections,
  supportEmail,
}: {
  sections: LocalizedSection[];
  supportEmail: string;
}) {
  const t = useTranslations('admin');
  const searchId = useId();
  const [query, setQuery] = useState('');
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const [active, setActive] = useState(sections[0]?.id ?? '');

  const filtered = useMemo(() => filterHelp(sections, query), [sections, query]);
  const searching = queryTokens(query).length > 0;
  const count = filtered.reduce((sum, section) => sum + section.features.length, 0);

  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.replace(/^#/, ''));
    if (!id) return;
    setOpened((prev) => new Set(prev).add(id));
    const timer = window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ block: 'start' });
    }, 60);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const nodes = filtered
      .map((section) => document.getElementById(section.id))
      .filter((node): node is HTMLElement => node !== null);
    if (!nodes.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: '-30% 0px -55% 0px', threshold: [0, 0.2, 0.6] },
    );
    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
  }, [filtered]);

  function go(id: string) {
    setOpened((prev) => new Set(prev).add(id));
    const url = new URL(window.location.href);
    url.hash = id;
    window.history.replaceState(null, '', url);
    window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 40);
  }

  function onOpenChange(id: string, open: boolean) {
    if (searching) return;
    setOpened((prev) => {
      const has = prev.has(id);
      if (open === has) return prev;
      const next = new Set(prev);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  return (
    <div className="space-y-5">
      <div className="sticky top-14 z-10 -mx-4 border-b border-border bg-muted px-4 py-3 sm:-mx-6 sm:px-6 lg:mx-0 lg:rounded-xl lg:border lg:bg-card lg:px-4 lg:py-4 lg:shadow-xs">
        <form role="search" onSubmit={(event) => event.preventDefault()}>
          <label htmlFor={searchId} className="relative block">
            <span className="sr-only">{t('helpSearchLabel')}</span>
            <Search aria-hidden className="pointer-events-none absolute start-3.5 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
            <input
              id={searchId}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('helpSearchPlaceholder')}
              autoComplete="off"
              className="h-12 w-full rounded-xl border border-input bg-card ps-11 pe-12 text-base text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label={t('helpClearSearch')}
                className="absolute end-1.5 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" aria-hidden />
              </button>
            ) : null}
          </label>
        </form>
        <p aria-live="polite" className="mt-2 min-h-5 text-xs text-muted-foreground">
          {searching ? t('helpResults', { count }) : ''}
        </p>
        <nav aria-label={t('helpToc')} className="-mx-4 mt-1 flex gap-2 overflow-x-auto px-4 pb-1 lg:hidden">
          {filtered.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              onClick={(event) => {
                event.preventDefault();
                go(section.id);
              }}
              aria-current={active === section.id ? 'true' : undefined}
              className={cn(
                'inline-flex h-9 shrink-0 items-center rounded-full border px-3 text-xs font-medium whitespace-nowrap',
                active === section.id
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-card text-muted-foreground',
              )}
            >
              {section.title}
            </a>
          ))}
        </nav>
      </div>

      <div className="lg:grid lg:grid-cols-[16.5rem_minmax(0,1fr)] lg:items-start lg:gap-8">
        <nav aria-label={t('helpToc')} className="sticky top-36 hidden max-h-[calc(100dvh-10rem)] overflow-y-auto pe-1 lg:block">
          <p className="px-3 pb-2 text-xs font-medium text-muted-foreground">{t('helpToc')}</p>
          <ul className="space-y-0.5">
            {filtered.map((section, index) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  onClick={(event) => {
                    event.preventDefault();
                    go(section.id);
                  }}
                  aria-current={active === section.id ? 'true' : undefined}
                  className={cn(
                    'flex items-baseline gap-2 rounded-lg px-3 py-2 text-sm',
                    active === section.id
                      ? 'bg-primary/[0.08] font-semibold text-primary'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <span className="numeral w-5 shrink-0 text-xs">{index + 1}</span>
                  <span className="min-w-0">{section.title}</span>
                </a>
                {active === section.id || searching ? (
                  <ul className="mb-1 ms-5 space-y-0.5 border-s border-border ps-2">
                    {section.features.map((feature) => (
                      <li key={feature.id}>
                        <a
                          href={`#${feature.id}`}
                          onClick={(event) => {
                            event.preventDefault();
                            go(feature.id);
                          }}
                          className="block rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          {feature.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-10">
          {filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card px-6 py-16 text-center">
              <SearchX aria-hidden className="mx-auto size-8 text-muted-foreground" />
              <p className="mt-3 text-base font-semibold">{t('helpEmptyTitle')}</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t('helpEmptyBody')}</p>
              <button
                type="button"
                onClick={() => setQuery('')}
                className="mt-4 inline-flex h-10 items-center rounded-lg px-3 text-sm font-medium text-primary hover:bg-primary/10"
              >
                {t('helpClearSearch')}
              </button>
            </div>
          ) : (
            filtered.map((section, index) => (
              <section key={section.id} aria-labelledby={`${section.id}-title`} className="scroll-mt-40 space-y-3">
                <header id={section.id} className="scroll-mt-40">
                  <p className="numeral text-xs font-semibold text-primary">{String(index + 1).padStart(2, '0')}</p>
                  <h2 id={`${section.id}-title`} className="text-lg font-bold leading-snug">
                    <Highlight text={section.title} query={query} />
                  </h2>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    <Highlight text={section.lede} query={query} />
                  </p>
                </header>
                <div className="space-y-3">
                  {section.features.map((feature, featureIndex) => (
                    <FeatureCard
                      key={feature.id}
                      feature={feature}
                      index={featureIndex + 1}
                      query={query}
                      open={searching || opened.has(feature.id)}
                      onOpenChange={onOpenChange}
                      stepsLabel={t('helpSteps')}
                      fieldsLabel={t('helpFields')}
                      statusesLabel={t('helpStatuses')}
                      tipsLabel={t('helpTips')}
                      openLabel={t('helpOpen')}
                    />
                  ))}
                </div>
              </section>
            ))
          )}

          <aside className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
            <Mail aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
            <div className="min-w-0">
              <p className="text-sm font-semibold">{t('helpContactLead')}</p>
              <a href={`mailto:${supportEmail}`} className="mt-0.5 inline-block text-sm text-primary hover:underline">
                {supportEmail}
              </a>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function FeatureCard({
  feature,
  index,
  query,
  open,
  onOpenChange,
  stepsLabel,
  fieldsLabel,
  statusesLabel,
  tipsLabel,
  openLabel,
}: {
  feature: LocalizedFeature;
  index: number;
  query: string;
  open: boolean;
  onOpenChange: (id: string, open: boolean) => void;
  stepsLabel: string;
  fieldsLabel: string;
  statusesLabel: string;
  tipsLabel: string;
  openLabel: string;
}) {
  return (
    <details
      id={feature.id}
      open={open}
      onToggle={(event) => onOpenChange(feature.id, event.currentTarget.open)}
      className="group scroll-mt-44 rounded-lg border border-border bg-card open:border-primary/40"
    >
      <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3.5 [&::-webkit-details-marker]:hidden">
        <span className="numeral mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-muted text-xs font-semibold text-muted-foreground group-open:bg-primary/10 group-open:text-primary">
          {index}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold leading-6">
            <Highlight text={feature.title} query={query} />
          </span>
          <span className="mt-0.5 block text-sm leading-relaxed text-muted-foreground group-open:hidden">
            <Highlight text={feature.summary} query={query} />
          </span>
        </span>
        <ChevronDown aria-hidden className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-5 border-t border-border px-4 py-4 sm:px-5">
        <p className="text-sm leading-relaxed">
          <Highlight text={feature.summary} query={query} />
        </p>

        {feature.steps.length ? (
          <div>
            <h3 className="mb-2 text-xs font-semibold text-muted-foreground">{stepsLabel}</h3>
            <ol className="space-y-2.5">
              {feature.steps.map((step, stepIndex) => (
                <li key={stepIndex} className="flex items-start gap-3 text-sm leading-relaxed">
                  <span className="numeral grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                    {stepIndex + 1}
                  </span>
                  <span className="pt-0.5">
                    <Highlight text={step} query={query} />
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        {feature.fields.length ? (
          <div>
            <h3 className="mb-2 text-xs font-semibold text-muted-foreground">{fieldsLabel}</h3>
            <dl className="divide-y divide-border overflow-hidden rounded-lg border border-border">
              {feature.fields.map((field) => (
                <div key={field.label} className="grid gap-0.5 px-3 py-2.5 sm:grid-cols-[minmax(8rem,14rem)_minmax(0,1fr)] sm:gap-4">
                  <dt className="text-sm font-medium">
                    <Highlight text={field.label} query={query} />
                  </dt>
                  <dd className="text-sm leading-relaxed text-muted-foreground">
                    <Highlight text={field.detail} query={query} />
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}

        {feature.statuses.length ? (
          <div>
            <h3 className="mb-2 text-xs font-semibold text-muted-foreground">{statusesLabel}</h3>
            <ul className="grid gap-2 sm:grid-cols-2">
              {feature.statuses.map((status) => (
                <li key={status.label} className="flex items-start gap-2 rounded-lg border border-border px-2.5 py-2">
                  <Badge variant={status.tone} className="mt-0.5 h-auto max-w-full shrink whitespace-normal text-start leading-5">
                    <Highlight text={status.label} query={query} />
                  </Badge>
                  {status.detail ? (
                    <span className="min-w-0 text-xs leading-5 text-muted-foreground">
                      <Highlight text={status.detail} query={query} />
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {feature.tips.length ? (
          <div>
            <h3 className="mb-2 text-xs font-semibold text-muted-foreground">{tipsLabel}</h3>
            <ul className="space-y-2">
              {feature.tips.map((tip) => (
                <li key={tip} className="flex items-start gap-2 rounded-lg bg-muted/80 px-3 py-2.5 text-sm leading-relaxed text-muted-foreground">
                  <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span>
                    <Highlight text={tip} query={query} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {feature.href ? (
          <p>
            <Link href={feature.href} className="inline-flex h-9 items-center text-sm font-medium text-primary hover:underline">
              {openLabel}
            </Link>
          </p>
        ) : null}
      </div>
    </details>
  );
}

function Highlight({ text, query }: { text: string; query: string }) {
  const ranges = matchRanges(text, query);
  if (!ranges.length) return text;
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  ranges.forEach(([start, end], index) => {
    if (cursor < start) nodes.push(text.slice(cursor, start));
    nodes.push(
      <mark key={index} className="rounded-sm bg-warning-muted px-0.5 text-inherit">
        {text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  });
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}
