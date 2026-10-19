import type { Icon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

/** A titled group of fields: numbered (or icon) badge, title, one-line help, two-column grid. */
export function FormSection({
  step,
  icon: Glyph,
  title,
  subtitle,
  columns = 2,
  children,
}: {
  /** The number in the blue circle ("1. Account Information"). */
  step?: number;
  icon?: Icon;
  title: string;
  subtitle?: string;
  columns?: 1 | 2;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-divider bg-surface shadow-sm">
      <header className="flex items-center gap-4 rounded-t-xl border-b border-divider bg-table-head px-5 py-4 sm:px-6">
        <span
          aria-hidden
          className={`flex size-10 shrink-0 items-center justify-center text-sm font-bold shadow-sm ${Glyph ? 'rounded-lg bg-info-soft text-info' : 'rounded-full bg-action text-on-action'}`}
        >
          {Glyph ? <Glyph weight="fill" className="size-5" /> : step}
        </span>
        <div>
          <h2 className="text-xl font-bold text-heading">
            {step && Glyph ? `${step}. ` : ''}
            {title}
          </h2>
          {subtitle ? <p className="text-sm text-muted">{subtitle}</p> : null}
        </div>
      </header>
      <div className={`grid gap-5 p-5 sm:p-6 ${columns === 2 ? 'sm:grid-cols-2' : ''}`}>
        {children}
      </div>
    </section>
  );
}

/** A label, the control (children), and the help, error and count lines under it. */
export function FormField({
  label,
  htmlFor,
  required,
  hint,
  error,
  counter,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  hint?: string;
  error?: string;
  /** "98/2000". */
  counter?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-semibold text-heading">
        {label}
        {required ? <span className="text-danger"> *</span> : null}
      </label>
      {children}
      <div className="flex justify-between gap-2 text-sm">
        <p className={error ? 'font-medium text-danger' : 'text-muted'}>{error ?? hint}</p>
        {counter ? <p className="text-muted">{counter}</p> : null}
      </div>
    </div>
  );
}
