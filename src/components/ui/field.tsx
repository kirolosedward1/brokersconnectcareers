'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

const control =
  'w-full rounded-lg border border-input bg-card px-3.5 py-2 text-sm ' +
  'transition-colors placeholder:text-muted-foreground hover:border-muted-foreground ' +
  'focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-60';

/**
 * What a Field tells the control inside it.
 *
 * A field's hint and its error were paragraphs that sat under the control and
 * belonged to nothing. The apply form moves focus to the first invalid field
 * so that a screen reader announces "the label and its error together" — and
 * it announced the label only, because nothing tied the error to the input.
 * A sighted reader saw a red line under the phone number; a blind one heard
 * "WhatsApp number, edit text" and no reason the form had refused.
 *
 * So the Field says which paragraph describes its control and whether that
 * paragraph is an error, and Input, Select and Textarea pick it up without
 * each call site having to wire ids by hand. A control that is not one of the
 * three — a native file input — reads the same ids from `fieldMessageId`.
 *
 * Client-only, which costs nothing: every module that renders a Field is
 * already a client component.
 */
type FieldState = { describedBy?: string; invalid: boolean };

const FieldContext = React.createContext<FieldState | null>(null);

type Described = {
  'aria-describedby'?: string;
  'aria-invalid'?: React.AriaAttributes['aria-invalid'];
};

function useFieldProps<P extends Described>(props: P): P {
  const field = React.useContext(FieldContext);
  if (!field) return props;

  const describedBy =
    [props['aria-describedby'], field.describedBy].filter(Boolean).join(' ') || undefined;

  return {
    ...props,
    'aria-describedby': describedBy,
    // An explicit value from the caller wins; otherwise the field decides.
    'aria-invalid': props['aria-invalid'] ?? (field.invalid ? true : undefined),
  };
}

/** `size` is the height, not the HTML attribute — see Select below for why. */
export const Input = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> & { size?: 'sm' | 'md' }
>(({ className, size = 'md', ...rest }, ref) => {
  const props = useFieldProps(rest);
  return (
    <input
      ref={ref}
      className={cn(control, size === 'sm' ? 'h-8 py-0 text-xs' : 'h-11', className)}
      {...props}
    />
  );
});
Input.displayName = 'Input';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...rest }, ref) => {
  const props = useFieldProps(rest);
  return <textarea ref={ref} className={cn(control, 'min-h-24 leading-relaxed', className)} {...props} />;
});
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
>(({ className, children, size = 'md', ...rest }, ref) => {
  const props = useFieldProps(rest);
  return (
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
  );
});
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

/**
 * The id of the paragraph a Field renders under its control: the error when
 * there is one, otherwise the hint. For the controls that are not Input,
 * Select or Textarea and so cannot pick it up on their own.
 */
export function fieldMessageId(
  htmlFor: string,
  { hint, error }: { hint?: React.ReactNode; error?: React.ReactNode },
) {
  return error ? `${htmlFor}-error` : hint ? `${htmlFor}-hint` : undefined;
}

/** Label, control, then the hint or the error — in the order forms want them. */
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
  const fallback = React.useId();
  const base = htmlFor ?? fallback;
  const messageId = fieldMessageId(base, { hint, error });
  const invalid = Boolean(error);

  const state = React.useMemo(() => ({ describedBy: messageId, invalid }), [messageId, invalid]);

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      <FieldContext.Provider value={state}>{children}</FieldContext.Provider>
      {/* Under the control, not between it and its label. Above, a hint pushed
          its own input down by a line, so two fields side by side — one with a
          hint, one without — never shared a baseline, and every form that
          wanted columns had to stack instead. Below, the label stays attached
          to what it labels and the controls in a row line up. An error takes
          the hint's place rather than stacking under it: once something is
          wrong, what is wrong is the help. */}
      {error ? (
        <p id={`${base}-error`} className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${base}-hint`} className="text-xs leading-relaxed text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
