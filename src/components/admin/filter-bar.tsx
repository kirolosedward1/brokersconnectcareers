'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

type Option = { value: string; label: string; href: string };

type SelectFilter = {
  kind: 'select';
  key: string;
  label: string;
  /** Set when a value other than "all" is active. */
  valueLabel?: string;
  all: Option;
  options: Option[];
};

type GroupedFilter = {
  kind: 'grouped';
  key: string;
  label: string;
  valueLabel?: string;
  all: Option;
  groups: { id: string; label: string; options: Option[] }[];
  searchPlaceholder: string;
  empty: string;
};

type ToggleFilter = {
  kind: 'toggle';
  key: string;
  label: string;
  pressed: boolean;
  href: string;
};

export type BarFilter = SelectFilter | GroupedFilter | ToggleFilter;

export type FilterChip = { key: string; label: string; href: string; remove: string };

/**
 * The row under the status tabs: a few labelled controls, the search, and
 * the filters that are on, each of them a link so the URL stays the state.
 */
export function FilterBar({
  filters,
  chips,
  clearHref,
  clearLabel,
  children,
}: {
  filters: BarFilter[];
  chips: FilterChip[];
  clearHref: string;
  clearLabel: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        {filters.length ? (
          <div className="flex flex-wrap items-center gap-2">
            {filters.map((filter) =>
              filter.kind === 'toggle' ? (
                <Toggle key={filter.key} filter={filter} />
              ) : (
                <MenuFilter key={filter.key} filter={filter} />
              ),
            )}
          </div>
        ) : null}
        {children ? <div className="order-first w-full min-w-0 lg:order-none lg:ms-auto lg:w-80">{children}</div> : null}
      </div>
      {chips.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((chip) => (
            <Link
              key={chip.key}
              href={chip.href}
              className="inline-flex min-h-8 items-center gap-1 rounded-full border border-border bg-card ps-2.5 pe-1.5 text-xs hover:bg-muted"
            >
              <span>{chip.label}</span>
              <X aria-hidden className="size-3" />
              <span className="sr-only">{chip.remove}</span>
            </Link>
          ))}
          <Link href={clearHref} className="inline-flex min-h-8 items-center px-1 text-xs font-medium text-primary hover:underline">
            {clearLabel}
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function Toggle({ filter }: { filter: ToggleFilter }) {
  return (
    <Link
      href={filter.href}
      role="switch"
      aria-checked={filter.pressed}
      className="inline-flex h-11 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm hover:bg-muted"
    >
      <span
        aria-hidden
        className={cn('relative h-5 w-9 shrink-0 rounded-full transition-colors', filter.pressed ? 'bg-primary' : 'bg-muted')}
      >
        <span
          className={cn(
            'absolute top-0.5 size-4 rounded-full bg-card shadow-sm',
            filter.pressed ? 'end-0.5' : 'start-0.5',
          )}
        />
      </span>
      {filter.label}
    </Link>
  );
}

function MenuFilter({ filter }: { filter: SelectFilter | GroupedFilter }) {
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [needle, setNeedle] = useState('');
  const searchable = filter.kind === 'grouped';

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const groups = useMemo(() => {
    if (filter.kind !== 'grouped') return [];
    const q = needle.trim().toLowerCase();
    return filter.groups
      .map((group) => ({
        ...group,
        options: q ? group.options.filter((option) => option.label.toLowerCase().includes(q)) : group.options,
      }))
      .filter((group) => group.options.length > 0);
  }, [filter, needle]);

  const shown = filter.valueLabel ? `${filter.label}: ${filter.valueLabel}` : filter.label;

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        className={cn(
          'inline-flex h-11 max-w-full items-center gap-1.5 rounded-lg border bg-card px-3 text-sm',
          filter.valueLabel ? 'border-primary/50' : 'border-border',
        )}
        aria-expanded={open}
        aria-controls={menuId}
        aria-haspopup="listbox"
        onClick={() => {
          setNeedle('');
          setOpen((value) => !value);
        }}
      >
        <span className="truncate">{shown}</span>
        <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </button>
      {open ? (
        <div
          id={menuId}
          role="listbox"
          aria-label={filter.label}
          className="absolute start-0 z-30 mt-1 w-[min(18rem,calc(100vw-2rem))] rounded-lg border border-border bg-card p-1 shadow-lg"
        >
          {searchable ? (
            <input
              type="search"
              value={needle}
              placeholder={filter.searchPlaceholder}
              aria-label={filter.searchPlaceholder}
              onChange={(event) => setNeedle(event.target.value)}
              className="mb-1 h-10 w-full rounded-md border border-input bg-background px-2.5 text-sm"
            />
          ) : null}
          <div className="max-h-72 overflow-y-auto">
            <OptionLink option={filter.all} active={!filter.valueLabel} onPick={() => setOpen(false)} />
            {filter.kind === 'select'
              ? filter.options.map((option) => (
                  <OptionLink key={option.value} option={option} active={option.label === filter.valueLabel} onPick={() => setOpen(false)} />
                ))
              : groups.length
                ? groups.map((group) => (
                    <div key={group.id} className="mt-1">
                      <p className="px-2 py-1 text-xs text-muted-foreground">{group.label}</p>
                      {group.options.map((option) => (
                        <OptionLink
                          key={option.value}
                          option={option}
                          active={option.label === filter.valueLabel}
                          onPick={() => setOpen(false)}
                        />
                      ))}
                    </div>
                  ))
                : <p className="px-2 py-3 text-sm text-muted-foreground">{filter.empty}</p>}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function OptionLink({ option, active, onPick }: { option: Option; active: boolean; onPick: () => void }) {
  return (
    <Link
      href={option.href}
      role="option"
      aria-selected={active}
      className={cn(
        'flex min-h-11 items-center rounded-md px-2 text-sm hover:bg-muted',
        active && 'bg-muted font-medium',
      )}
      onClick={onPick}
    >
      {option.label}
    </Link>
  );
}
