import { Card, Skeleton } from '@firmivra/ui';
import { useId, type ReactNode } from 'react';

/** The numbered white card of each step (1 Select Recipient ... 5 Review & Send). */
export function Panel({
  step,
  title,
  subtitle,
  testId,
  grow,
  children,
}: {
  step: number;
  title: string;
  subtitle: string;
  testId: string;
  /** Fills its column's height (Message & Settings, Review & Send). */
  grow?: boolean;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <Card
      aria-labelledby={headingId}
      data-testid={testId}
      className={`flex min-w-0 flex-col gap-4 p-4! ${grow ? 'flex-1' : ''}`}
    >
      <header className="flex items-start gap-4">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-info-soft text-xl font-bold text-info"
        >
          {step}
        </span>
        <div className="min-w-0">
          <h2 id={headingId} className="font-display text-xl font-bold text-heading">
            {title}
          </h2>
          <p className="mt-0.5 text-sm text-muted">{subtitle}</p>
        </div>
      </header>
      {children}
    </Card>
  );
}

/** A field's bold label with the red star (required) or "(optional)". */
export function FieldLabel({
  id,
  htmlFor,
  required,
  optional,
  children,
}: {
  id?: string;
  htmlFor?: string;
  required?: boolean;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <label id={id} htmlFor={htmlFor} className="text-sm font-bold text-heading">
      {children}
      {required ? <span className="text-danger"> *</span> : null}
      {optional ? <span className="font-normal text-text"> (optional)</span> : null}
    </label>
  );
}

/** A field's error line. */
export function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return children ? (
    <p id={id} className="text-xs text-danger">
      {children}
    </p>
  ) : null;
}

/** The quiet line a frame shows when there is nothing to choose or the data did not load. */
export function QuietLine({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted">{children}</p>;
}

export const UNAVAILABLE = 'Could not load this right now. Try again in a moment.';

const ROWS = ['first', 'second', 'third', 'fourth'];

/** Placeholder rows while a frame loads. */
export function Loading({ rows = 2 }: { rows?: number }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-3">
      <span className="sr-only">Loading…</span>
      {ROWS.slice(0, rows).map((row) => (
        <Skeleton key={row} className="h-11" />
      ))}
    </div>
  );
}

/** The same box as the kit's Input, for the controls built here (message, dates). */
export const controlBox =
  'w-full min-w-0 rounded-control border bg-surface px-3 py-2 text-base text-text placeholder:text-muted focus:outline-2 focus:outline-accent-500';
