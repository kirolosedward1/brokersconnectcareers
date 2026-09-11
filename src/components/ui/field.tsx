import * as React from 'react';
import { cn } from '@/lib/utils';

const control =
  'w-full rounded-xl border border-input bg-card px-3.5 py-2 text-sm shadow-xs ' +
  'transition-colors placeholder:text-muted-foreground hover:border-border ' +
  'focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-60';

/** `size` is the height, not the HTML attribute — see Select below for why. */
export const Input = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> & { size?: 'sm' | 'md' }
>(({ className, size = 'md', ...props }, ref) => (
  <input
    ref={ref}
    className={cn(control, size === 'sm' ? 'h-8 py-0 text-xs' : 'h-11', className)}
    {...props}
  />
));
Input.displayName = 'Input';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(control, 'min-h-24 leading-relaxed', className)} {...props} />
));
Textarea.displayName = 'Textarea';

/**
 * A select, in one of two heights.
 *
 * `sm` exists because shrinking one by hand does not work: the shared control
 * padding is `py-2`, so `h-8` leaves sixteen pixels of content box for a
 * twenty-pixel line, and the browser answers by squeezing the option text into
 * an unreadable sliver at the edge of an otherwise empty pill — which is
 * exactly what the applicant card's "move to" control had been showing.
 *
 * The inline-end padding is the other half. A native select draws its own
 * chevron at the inline end — the left, in Arabic — and the shared `px-3.5` is
 * not enough room for it, so the text runs underneath.
 *
 * `size` shadows the HTML attribute of the same name, which is why it is
 * omitted from the inherited props. Nothing here wants the attribute: it sets
 * how many options a listbox shows at once, and every select in this app is a
 * dropdown.
 */
export const Select = React.forwardRef<
  HTMLSelectElement,
  Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> & { size?: 'sm' | 'md' }
>(({ className, children, size = 'md', ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      control,
      'cursor-pointer pe-9',
      size === 'sm' ? 'h-8 py-0 text-xs' : 'h-11',
      className,
    )}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = 'Select';

export function Label({
  className,
  hint,
  children,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement> & { hint?: React.ReactNode }) {
  return (
    <label className={cn('flex flex-col gap-1', className)} {...props}>
      <span className="text-sm font-medium">{children}</span>
      {hint ? <span className="text-xs font-normal text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

/** Label + control + optional hint and error, in the order forms want them. */
export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
