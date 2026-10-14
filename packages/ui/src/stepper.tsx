import { Check } from '@phosphor-icons/react';

export interface StepItem {
  id: string;
  label: string;
}
/** Progress is announced without making incomplete steps look finished. */
export function Stepper({
  steps,
  current,
  label = 'Setup progress',
  variant = 'list',
}: {
  steps: StepItem[];
  current: string;
  label?: string;
  /** `wizard`: numbered circles on one line with the label below, as in the multi-step forms. */
  variant?: 'list' | 'wizard';
}) {
  const index = steps.findIndex((step) => step.id === current);
  if (variant === 'wizard')
    return (
      <ol aria-label={label} className="flex">
        {steps.map((step, number) => {
          const done = number < index;
          return (
            <li
              key={step.id}
              aria-current={step.id === current ? 'step' : undefined}
              className="relative flex flex-1 flex-col items-center gap-2 text-center text-sm"
            >
              {number > 0 ? (
                <span
                  aria-hidden="true"
                  className={`absolute top-4 right-1/2 h-0.5 w-full ${number <= index ? 'bg-action' : 'bg-border'}`}
                />
              ) : null}
              <span
                aria-hidden="true"
                className={`relative z-10 flex size-8 items-center justify-center rounded-full border-2 text-sm font-semibold ${number <= index ? 'border-action bg-action text-on-action' : 'border-border bg-surface text-muted'}`}
              >
                {done ? <Check weight="bold" className="size-4" /> : number + 1}
              </span>
              <span className={number === index ? 'font-semibold text-heading' : 'text-muted'}>
                {step.label}
                {done ? <span className="sr-only">, completed</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
    );
  return (
    <ol aria-label={label} className="flex flex-wrap gap-4">
      {steps.map((step, number) => (
        <li
          key={step.id}
          aria-current={step.id === current ? 'step' : undefined}
          className="flex items-center gap-2 text-sm"
        >
          <span
            aria-hidden="true"
            className={`flex h-8 w-8 items-center justify-center rounded-full ${number <= index ? 'bg-action text-on-action' : 'bg-disabled text-muted'}`}
          >
            {number < index ? '✓' : number + 1}
          </span>
          <span className={step.id === current ? 'font-semibold text-heading' : 'text-muted'}>
            {step.label}
            {number < index ? <span className="sr-only">, completed</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}
