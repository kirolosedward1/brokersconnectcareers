'use client';

import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

export type Theme = 'light' | 'dark' | 'system';

/**
 * The key the inline boot script in the root layout reads. Both must agree, so
 * it is defined once and exported.
 */
export const THEME_STORAGE_KEY = 'bc-theme';

/**
 * Apply a choice to the document.
 *
 * Every choice is stored, including `system`. No stored value means light —
 * the site's default is light rather than "whatever the OS says", so
 * following the OS has to be a positive choice with a value of its own.
 */
export function applyTheme(theme: Theme) {
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  document.documentElement.classList.toggle('dark', dark);

  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Private mode, or storage disabled. The class is already set, so the
    // choice holds for this page; it just will not survive a reload.
  }
}

const OPTIONS: { value: Theme; icon: typeof Sun; key: 'light' | 'dark' | 'system' }[] = [
  { value: 'light', icon: Sun, key: 'light' },
  { value: 'system', icon: Monitor, key: 'system' },
  { value: 'dark', icon: Moon, key: 'dark' },
];

/**
 * Three states, not a switch.
 *
 * The site is light by default. Dark and "follow my system" are both there,
 * but neither happens unless somebody asks for it — a reader who has never
 * touched this gets light, whatever their OS is set to.
 *
 * Renders nothing until mounted, because the server cannot know what the
 * browser stored and rendering the wrong state first is worse than a beat of
 * empty space the same size.
 */
export function ThemeToggle() {
  const t = useTranslations('theme');
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(THEME_STORAGE_KEY);
    } catch {
      /* unreadable storage reads as "no choice made" */
    }
    // Absent or unrecognised reads as light, matching the boot script.
    setTheme(stored === 'dark' || stored === 'system' ? stored : 'light');
  }, []);

  // Track the OS while the reader is on `system`, so a machine that flips at
  // sunset flips the page with it.
  useEffect(() => {
    if (theme !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [theme]);

  if (theme === null) {
    return <div className="size-9" aria-hidden />;
  }

  return (
    <div
      role="radiogroup"
      aria-label={t('label')}
      className="flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5"
    >
      {OPTIONS.map(({ value, icon: Icon, key }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          aria-label={t(key)}
          title={t(key)}
          onClick={() => {
            setTheme(value);
            applyTheme(value);
          }}
          className={cn(
            'grid size-7 place-items-center rounded-md transition-colors',
            theme === value
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          <Icon className="size-3.5" aria-hidden />
        </button>
      ))}
    </div>
  );
}
